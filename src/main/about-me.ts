import fs from 'node:fs/promises';
import path from 'node:path';
import type Store from 'electron-store';
import type { MaestroSettings } from './stores/types';
import { atomicWriteFile, createKeyedWriteQueue } from './utils/atomic-json-store';
import { estimateTokenCount } from '../shared/formatters';
import type {
	AboutMeApplied,
	AboutMeCommand,
	AboutMeConfirmation,
	AboutMeFileStatus,
	AboutMeResult,
	AboutMeTarget,
} from '../shared/aboutMe';

const START = '<!-- maestro:about-me:start -->';
const END = '<!-- maestro:about-me:end -->';
const startBytes = Buffer.from(START);
const endBytes = Buffer.from(END);
type Baselines = Record<string, AboutMeApplied>;
interface InspectedFile {
	status: AboutMeFileStatus;
	bytes?: Buffer;
	start?: number;
	end?: number;
	mode?: number;
}

function managedSegment(bytes: Buffer): { block: string | null; start: number; end: number } {
	const start = bytes.indexOf(startBytes);
	const end = bytes.indexOf(endBytes);
	if (start === -1 && end === -1) return { block: null, start: bytes.length, end: bytes.length };
	if (
		start === -1 ||
		end < start ||
		bytes.indexOf(startBytes, start + startBytes.length) !== -1 ||
		bytes.indexOf(endBytes, end + endBytes.length) !== -1
	)
		throw new Error('The managed markers are incomplete or repeated');
	const segment = bytes.subarray(start, end + endBytes.length);
	const block = segment.toString('utf8');
	if (!Buffer.from(block).equals(segment))
		throw new Error('The managed segment is not valid UTF-8');
	return { block, start, end: end + endBytes.length };
}

function desiredBlock(content: string): string | null {
	return content === '' ? null : `${START}\n${content}\n${END}`;
}

function isCommand(request: unknown): request is AboutMeCommand {
	if (!request || typeof request !== 'object' || !('action' in request)) return false;
	if (request.action === 'show' || request.action === 'status') return true;
	if (request.action !== 'set' && request.action !== 'apply') return false;
	if (!('content' in request) || typeof request.content !== 'string') return false;
	if (request.content.includes(START) || request.content.includes(END)) return false;
	if (Buffer.from(request.content).toString('utf8') !== request.content) return false;
	if (
		request.action === 'set' ||
		!('confirmations' in request) ||
		request.confirmations === undefined
	)
		return true;
	return (
		Array.isArray(request.confirmations) &&
		request.confirmations.every((item: unknown) => {
			if (!item || typeof item !== 'object') return false;
			const value = item as AboutMeConfirmation;
			return (
				typeof value.path === 'string' &&
				typeof value.resolvedPath === 'string' &&
				(value.block === null || typeof value.block === 'string')
			);
		})
	);
}

async function inspectFile(target: AboutMeTarget): Promise<InspectedFile> {
	const status: AboutMeFileStatus = {
		path: target.path,
		aliases: [target.path],
		providers: [target.provider],
		state: 'error',
		shadowedBy: [],
	};
	try {
		let exists = true;
		try {
			await fs.lstat(target.path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			exists = false;
		}
		// Resolve the file itself when it exists. Renaming over a symlink would
		// replace the user's link instead of updating the instruction target.
		if (exists) status.resolvedPath = await fs.realpath(target.path);
		else {
			try {
				const parent = await fs.realpath(path.dirname(target.path));
				if (!(await fs.stat(parent)).isDirectory())
					throw Object.assign(new Error('Account directory is missing'), { code: 'ENOTDIR' });
				status.resolvedPath = path.join(parent, path.basename(target.path));
			} catch (error) {
				if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
					status.state = 'missing-directory';
					return { status };
				}
				throw error;
			}
		}
		let bytes = Buffer.alloc(0);
		let mode = 0o600;
		if (exists) {
			const stat = await fs.stat(status.resolvedPath);
			if (!stat.isFile()) throw new Error('The instruction path is not a regular file');
			bytes = await fs.readFile(status.resolvedPath);
			mode = stat.mode & 0o777;
		}
		if (target.provider === 'codex') {
			// Official Codex AGENTS.md discovery chooses a nonempty override first:
			// https://developers.openai.com/codex/guides/agents-md (2026-10-31).
			const override = path.join(path.dirname(target.path), 'AGENTS.override.md');
			try {
				if ((await fs.readFile(override, 'utf8')).trim()) status.shadowedBy.push(override);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		}
		try {
			const segment = managedSegment(bytes);
			status.currentBlock = segment.block;
			return { status, bytes, start: segment.start, end: segment.end, mode };
		} catch (error) {
			status.state = 'invalid-block';
			status.error = (error as Error).message;
			return { status };
		}
	} catch (error) {
		status.error = error instanceof Error ? error.message : String(error);
		return { status };
	}
}

function classify(file: InspectedFile, baselines: Baselines, desired: string | null): void {
	const status = file.status;
	if (status.currentBlock === undefined) return;
	const baseline = status.aliases
		.map((alias) => baselines[alias])
		.find((item) => item?.resolvedPath === status.resolvedPath);
	if (baseline) {
		status.state =
			status.currentBlock !== baseline.block
				? 'external-change'
				: status.currentBlock === desired
					? 'synced'
					: 'pending';
	} else {
		// Matching text alone is not consent to own and overwrite this segment.
		status.state = status.currentBlock === null && desired === null ? 'synced' : 'unconfirmed';
	}
}

/** One service for desktop IPC and CLI. No native file is written by set/status. */
export function createAboutMeService(deps: {
	settingsStore: Pick<Store<MaestroSettings>, 'get' | 'set'>;
	getFiles: () => Promise<AboutMeTarget[]>;
	onContentChanged?: (senderWebContentsId?: number) => void;
}) {
	const queue = createKeyedWriteQueue();
	const content = (): string => deps.settingsStore.get('conductorProfile', '') as string;
	const baselines = (): Baselines => deps.settingsStore.get('aboutMeApplied', {}) as Baselines;
	const result = (extra: Partial<AboutMeResult> = {}): AboutMeResult => {
		const value = content();
		return {
			success: true,
			content: value,
			estimatedTokens: estimateTokenCount(value),
			files: [],
			...extra,
		};
	};
	const inspect = async (
		known: Baselines
	): Promise<{ files: InspectedFile[]; targets: AboutMeTarget[] }> => {
		const targets = [
			...(await deps.getFiles()),
			...Object.entries(known).map(([file, record]) => ({ path: file, provider: record.provider })),
		];
		const files = new Map<string, InspectedFile>();
		for (const target of targets) {
			const file = await inspectFile(target);
			const key = file.status.resolvedPath ?? target.path;
			const existing = files.get(key);
			if (!existing) files.set(key, file);
			else {
				existing.status.aliases = [...new Set([...existing.status.aliases, target.path])];
				existing.status.providers = [...new Set([...existing.status.providers, target.provider])];
				existing.status.shadowedBy = [
					...new Set([...existing.status.shadowedBy, ...file.status.shadowedBy]),
				];
			}
		}
		for (const file of files.values()) classify(file, known, desiredBlock(content()));
		return { files: [...files.values()], targets };
	};
	async function run(request: unknown, senderWebContentsId?: number): Promise<AboutMeResult> {
		if (!isCommand(request))
			return result({
				success: false,
				code: 'invalid-request',
				error: 'Invalid About Me command or managed marker in content',
			});
		if (request.action === 'show') return result();
		if (request.action === 'set') {
			try {
				deps.settingsStore.set('conductorProfile', request.content);
				deps.onContentChanged?.(senderWebContentsId);
				return result();
			} catch (error) {
				return result({
					success: false,
					code: 'persistence-failed',
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		const known = { ...baselines() };
		const { files, targets } = await inspect(known);
		if (request.action === 'status') return result({ files: files.map((file) => file.status) });
		const written: string[] = [];
		const response = (extra: Partial<AboutMeResult> = {}) =>
			result({ files: files.map((file) => file.status), written, ...extra });
		if (request.content !== content())
			return response({
				success: false,
				code: 'profile-changed',
				error: 'The profile changed; inspect it again before applying',
			});
		const confirmations = request.confirmations ?? [];
		if (
			confirmations.some(
				(confirmation) => !files.some((file) => file.status.aliases.includes(confirmation.path))
			)
		) {
			return response({
				success: false,
				code: 'invalid-request',
				error: 'A confirmation does not name a discovered instruction file',
			});
		}
		const desired = desiredBlock(request.content);
		for (const file of files) {
			if (file.status.currentBlock === undefined) continue;
			// Re-read just before each write: retain outside edits and reject an
			// external managed edit or link move since the user's status snapshot.
			const fresh = await inspectFile(targets.find((target) => target.path === file.status.path)!);
			fresh.status.aliases = file.status.aliases;
			fresh.status.providers = file.status.providers;
			fresh.status.shadowedBy = file.status.shadowedBy;
			classify(fresh, known, desired);
			Object.assign(file, fresh);
			if (file.status.currentBlock === undefined || file.status.state === 'synced') continue;
			if (request.content !== content())
				return response({
					success: false,
					code: 'profile-changed',
					error: 'The profile changed during apply; inspect remaining files again',
				});
			const approved = confirmations.some(
				(confirmation) =>
					file.status.aliases.includes(confirmation.path) &&
					confirmation.resolvedPath === file.status.resolvedPath &&
					confirmation.block === file.status.currentBlock
			);
			if (file.status.state !== 'pending' && !approved) continue;
			try {
				if (file.status.currentBlock !== desired) {
					const bytes = Buffer.concat([
						file.bytes!.subarray(0, file.start),
						Buffer.from(desired ?? ''),
						file.bytes!.subarray(file.end),
					]);
					await atomicWriteFile(file.status.resolvedPath!, bytes, { mode: file.mode });
					written.push(file.status.resolvedPath!);
				}
				const next = { ...known };
				for (const alias of file.status.aliases) {
					next[alias] = {
						provider: targets.find((target) => target.path === alias)!.provider,
						resolvedPath: file.status.resolvedPath!,
						block: desired,
					};
				}
				// Record ownership only after the atomic file write has succeeded.
				deps.settingsStore.set('aboutMeApplied', next);
				Object.assign(known, next);
				file.status.currentBlock = desired;
				file.status.state = 'synced';
			} catch (error) {
				file.status.state = 'error';
				file.status.error = error instanceof Error ? error.message : String(error);
			}
		}
		const failed = files.filter((file) => file.status.state !== 'synced');
		return failed.length === 0
			? response()
			: response({
					success: false,
					code: failed.some(
						(file) => file.status.currentBlock === undefined || file.status.state === 'error'
					)
						? 'file-error'
						: 'confirmation-required',
					error:
						'Some instruction files were not synchronized; inspect their states before confirming',
				});
	}
	return {
		command: (request: unknown, senderWebContentsId?: number): Promise<AboutMeResult> =>
			queue.enqueue('about-me', async () => {
				try {
					return await run(request, senderWebContentsId);
				} catch (error) {
					return result({
						success: false,
						code: 'file-error',
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}),
	};
}
export type AboutMeService = ReturnType<typeof createAboutMeService>;
