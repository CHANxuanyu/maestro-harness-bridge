import fs from 'node:fs/promises';
import path from 'node:path';
import type {
	AboutMeNativeStatus,
	AboutMeApplied,
	AboutMeFileStatus,
	AboutMeTarget,
} from '../shared/aboutMe';

import {
	resolveAgentAccountDir,
	type AgentAccountDirInput,
	type AgentAccountDirLayers,
} from '../shared/agentAccountDir';

export const START = '<!-- maestro:about-me:start -->';
export const END = '<!-- maestro:about-me:end -->';
const startBytes = Buffer.from(START);
const endBytes = Buffer.from(END);
export type Baselines = Record<string, AboutMeApplied>;
export interface InspectedFile {
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

export function desiredBlock(content: string): string | null {
	return content === '' ? null : `${START}\n${content}\n${END}`;
}

export async function inspectFile(target: AboutMeTarget): Promise<InspectedFile> {
	const status: AboutMeFileStatus = {
		path: target.path,
		aliases: [target.path],
		providers: [target.provider],
		agentIds: target.agentIds ?? [],
		...(target.deepseek ? { deepseek: true as const } : {}),
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

export function classify(file: InspectedFile, baselines: Baselines, desired: string | null): void {
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

/** The one local account instruction file this exact spawn configuration reads. */
export function nativeAboutMeTarget(
	agent: AgentAccountDirInput,
	layers: AgentAccountDirLayers
): AboutMeTarget | undefined {
	if (agent.sshRemote || (agent.toolType !== 'claude-code' && agent.toolType !== 'codex'))
		return undefined;
	const directory = resolveAgentAccountDir(agent, layers);
	if (!directory) return undefined;
	return {
		path: path.join(directory, agent.toolType === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md'),
		provider: agent.toolType,
	};
}

/** Read-only startup check, also used by the standalone CLI. Never discovers accounts. */
export async function inspectNativeAboutMe(
	agent: AgentAccountDirInput,
	layers: AgentAccountDirLayers,
	content: string,
	known: Baselines
): Promise<AboutMeNativeStatus> {
	const target = nativeAboutMeTarget(agent, layers);
	if (!target) return { loaded: false };
	const file = await inspectFile(target);
	const status = file.status;
	// A newly supplied alias can name an already owned physical file. Verify
	// saved aliases still point there, without reading any other file's bytes.
	if (status.resolvedPath) {
		for (const [alias, record] of Object.entries(known)) {
			if (record?.resolvedPath !== status.resolvedPath || status.aliases.includes(alias)) continue;
			try {
				if ((await fs.realpath(alias)) === status.resolvedPath) status.aliases.push(alias);
			} catch {
				// Unreadable or vanished aliases cannot establish ownership.
			}
		}
	}
	classify(file, known, desiredBlock(content));
	return {
		loaded:
			status.state === 'synced' &&
			status.currentBlock != null &&
			(target.provider !== 'codex' || status.shadowedBy.length === 0),
		provider: target.provider,
		path: status.path,
		resolvedPath: status.resolvedPath,
		state: status.state,
		shadowedBy: status.shadowedBy,
	};
}
