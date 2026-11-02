import type Store from 'electron-store';
import type { MaestroSettings } from './stores/types';
import { atomicWriteFile, createKeyedWriteQueue } from './utils/atomic-json-store';
import { estimateTokenCount } from '../shared/formatters';
import type {
	AboutMeCommand,
	AboutMeConfirmation,
	AboutMeResult,
	AboutMeTarget,
} from '../shared/aboutMe';

import { nativeAboutMePointer } from '../shared/aboutMe';
import type { AgentAccountDirInput, AgentAccountDirLayers } from '../shared/agentAccountDir';
import {
	START,
	END,
	desiredBlock,
	inspectFile,
	classify,
	inspectNativeAboutMe,
	type Baselines,
	type InspectedFile,
} from './about-me-files';
function isCommand(request: unknown): request is AboutMeCommand {
	if (!request || typeof request !== 'object' || !('action' in request)) return false;
	if (request.action === 'show' || request.action === 'status') return true;
	if (request.action === 'native') {
		if (
			!('agent' in request) ||
			!request.agent ||
			typeof request.agent !== 'object' ||
			Array.isArray(request.agent)
		)
			return false;
		const agent = request.agent as Record<string, unknown>;
		return (
			typeof agent.toolType === 'string' &&
			(agent.sshRemote === undefined || typeof agent.sshRemote === 'boolean') &&
			(agent.customEnvVars === undefined ||
				(!!agent.customEnvVars &&
					typeof agent.customEnvVars === 'object' &&
					!Array.isArray(agent.customEnvVars) &&
					Object.values(agent.customEnvVars).every((value) => typeof value === 'string')))
		);
	}
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

/** One service for desktop IPC and CLI. No native file is written by set/status. */
export function createAboutMeService(deps: {
	settingsStore: Pick<Store<MaestroSettings>, 'get' | 'set'>;
	getFiles: () => Promise<AboutMeTarget[]>;
	getAccountDirLayers: (toolType: string) => AgentAccountDirLayers;
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
				existing.status.agentIds = [
					...new Set([...existing.status.agentIds, ...file.status.agentIds]),
				];
				if (file.status.deepseek) existing.status.deepseek = true;
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
		if (request.action === 'native')
			return result({
				native: await inspectNativeAboutMe(
					request.agent,
					deps.getAccountDirLayers(request.agent.toolType),
					content(),
					known
				),
			});
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
			fresh.status.agentIds = file.status.agentIds;
			if (file.status.deepseek) fresh.status.deepseek = true;
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
	const command = (request: unknown, senderWebContentsId?: number): Promise<AboutMeResult> =>
		queue.enqueue('about-me', async () => {
			try {
				return await run(request, senderWebContentsId);
			} catch (error) {
				return result({
					success: false,
					code: 'file-error',
					...(isCommand(request) && request.action === 'native'
						? { native: { loaded: false } }
						: {}),
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});
	return {
		command,
		/** Use the same serialized read as IPC before building a backend prompt. */
		promptProfile: async (agent: AgentAccountDirInput): Promise<string> => {
			const response = await command({ action: 'native', agent });
			return response.success && response.native?.loaded && response.native.provider
				? nativeAboutMePointer(response.native.provider)
				: response.content;
		},
	};
}
export type AboutMeService = ReturnType<typeof createAboutMeService>;
