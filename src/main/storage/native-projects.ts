import fs from 'node:fs/promises';
import path from 'node:path';
import {
	readCodexRollout,
	isCodexRollout,
	preferPlainCodexRollouts,
} from '../../shared/codexRollout';
import { normalizeWorktreePath } from '../../shared/worktreePaths';
import type { NativeProject } from '../../shared/projects';
import { isExpectedSessionReadError } from '../utils/session-read-errors';

/** Bounded metadata discovery. No native writer or transcript-restoration path is used. */
export function createNativeProjectDiscovery(deps: {
	accountDirs: (provider: string) => Promise<string[]>;
	maxFiles?: number;
	maxEntries?: number;
	maxMs?: number;
}) {
	let cached: { expires: number; projects: NativeProject[] } | undefined;
	let pending: Promise<NativeProject[]> | undefined;
	async function scan(): Promise<NativeProject[]> {
		const deadline = Date.now() + (deps.maxMs ?? 1500);
		const maxFiles = deps.maxFiles ?? 1024;
		let remainingEntries = deps.maxEntries ?? 8192;
		const files: Array<{ file: string; provider: string; pool: string; mtime: number }> = [];
		async function walk(
			directory: string,
			provider: string,
			pool: string,
			depth: number
		): Promise<void> {
			if (depth < 0 || files.length >= maxFiles || remainingEntries <= 0 || Date.now() > deadline)
				return;
			try {
				const dir = await fs.opendir(directory);
				for await (const entry of dir) {
					if (--remainingEntries < 0 || files.length >= maxFiles || Date.now() > deadline) break;
					const file = path.join(directory, entry.name);
					if (entry.isDirectory()) await walk(file, provider, pool, depth - 1);
					else if (
						entry.isFile() &&
						(provider === 'codex' ? isCodexRollout(entry.name) : entry.name.endsWith('.jsonl'))
					) {
						const stat = await fs.stat(file);
						files.push({ file, provider, pool, mtime: stat.mtimeMs });
					}
				}
			} catch (error) {
				if (!isExpectedSessionReadError(error)) throw error;
			}
		}
		for (const provider of ['claude-code', 'codex']) {
			for (const account of (await deps.accountDirs(provider)).slice(0, 64)) {
				if (provider === 'claude-code')
					await walk(path.join(account, 'projects'), provider, account, 1);
				else {
					await walk(path.join(account, 'sessions'), provider, account, 4);
					await walk(path.join(account, 'archived_sessions'), provider, account, 4);
				}
			}
		}
		const selected = files.filter((file) => file.provider !== 'codex');
		for (const pool of new Set(
			files.filter((file) => file.provider === 'codex').map((file) => file.pool)
		)) {
			selected.push(
				...preferPlainCodexRollouts(
					files.filter((file) => file.provider === 'codex' && file.pool === pool),
					(file) => path.basename(file.file)
				)
			);
		}
		const projects = new Map<string, NativeProject>();
		const seenFiles = new Set<string>();
		for (const file of selected.sort((a, b) => b.mtime - a.mtime)) {
			if (Date.now() > deadline) break;
			try {
				const physicalFile = await fs.realpath(file.file);
				if (seenFiles.has(physicalFile)) continue;
				seenFiles.add(physicalFile);
				const head = await readCodexRollout(file.file, 256 * 1024, { prefixBytes: 64 * 1024 });
				let cwd: string | undefined;
				for (const line of head.split('\n')) {
					try {
						const row = JSON.parse(line);
						const value =
							file.provider === 'codex'
								? row.type === 'session_meta'
									? row.payload?.cwd
									: undefined
								: row.cwd;
						if (typeof value === 'string' && path.isAbsolute(value)) {
							cwd = value;
							break;
						}
					} catch {
						/* Partial or non-JSON metadata lines are not projects. */
					}
				}
				if (!cwd) continue;
				const physical = await fs.realpath(cwd);
				if (!(await fs.stat(physical)).isDirectory()) continue;
				const key = normalizeWorktreePath(physical);
				const project = projects.get(key) ?? {
					path: physical,
					tools: [],
					lastActivity: 0,
					sessionCount: 0,
				};
				if (!project.tools.includes(file.provider)) project.tools.push(file.provider);
				project.lastActivity = Math.max(project.lastActivity, file.mtime);
				project.sessionCount++;
				projects.set(key, project);
			} catch (error) {
				if (
					!isExpectedSessionReadError(error) &&
					!(error instanceof RangeError) &&
					!(error instanceof SyntaxError) &&
					!(
						error instanceof Error &&
						'code' in error &&
						/^(Z_|ZSTD_|ERR_ZSTD)/.test(String(error.code))
					)
				)
					throw error;
			}
		}
		return [...projects.values()]
			.map((project) => ({ ...project, tools: project.tools.sort() }))
			.sort((a, b) => b.lastActivity - a.lastActivity);
	}
	return async function nativeProjects(): Promise<NativeProject[]> {
		if (!cached || cached.expires < Date.now()) {
			pending ??= scan()
				.then((projects) => {
					cached = { projects, expires: Date.now() + 30000 };
					return projects;
				})
				.finally(() => {
					pending = undefined;
				});
			await pending;
		}
		// A removed directory must not remain a dead link while the metadata cache is warm.
		const present = await Promise.all(
			cached!.projects.map(async (project) => {
				try {
					return (await fs.stat(project.path)).isDirectory();
				} catch {
					return false;
				}
			})
		);
		return cached!.projects
			.filter((_, index) => present[index])
			.map((project) => ({ ...project, tools: [...project.tools] }));
	};
}
