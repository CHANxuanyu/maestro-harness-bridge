import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAgentAccountDir, type AgentAccountDirLayers } from '../../shared/agentAccountDir';
import { handoffLocation } from '../../shared/aiHandoff';
import {
	nativeBuiltinCommands,
	type NativeCommandContext,
	type NativeCommand,
	type NativeCommandSnapshot,
} from '../../shared/nativeCommands';
import type { SshRemoteConfig } from '../../shared/types';
import { getCodexSkillDirs, getCodexPromptDirs, parseCodexMarkdownDoc } from './codex-config';
import { readDirRemote, readFileRemote, statRemote } from '../utils/remote-fs';
import { buildSshCommand } from '../utils/ssh-command-builder';
import { execFileNoThrow } from '../utils/execFile';

interface CommandStat {
	mtime: number;
	size: number;
	directory: boolean;
}
interface CommandEntry {
	name: string;
	directory: boolean;
}
interface CommandFiles {
	stat(file: string): Promise<CommandStat | undefined>;
	list(dir: string): Promise<CommandEntry[]>;
	read(file: string): Promise<string>;
}
interface Dependencies {
	layers(toolType: string): AgentAccountDirLayers;
	remote?(id: string): SshRemoteConfig | undefined;
}
interface CacheEntry {
	result: NativeCommandSnapshot;
	directories: Map<string, { revision: string; entries: CommandEntry[] }>;
	files: Map<string, { revision: string; content: string }>;
}
const localFiles: CommandFiles = {
	async stat(file) {
		try {
			const info = await fs.stat(file);
			return { mtime: info.mtimeMs, size: info.size, directory: info.isDirectory() };
		} catch (error) {
			if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
				return undefined;
			throw error;
		}
	},
	async list(dir) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		return entries
			.filter((e) => e.isDirectory() || e.isFile() || e.isSymbolicLink())
			.map((e) => ({ name: e.name, directory: e.isDirectory() }));
	},
	read: (file) => fs.readFile(file, 'utf8'),
};
function remoteFiles(remote: SshRemoteConfig): CommandFiles {
	return {
		async stat(file) {
			const result = await statRemote(file, remote);
			if (!result.success || !result.data) {
				if (result.error?.startsWith('Path not found:')) return undefined;
				throw new Error('Remote stat unavailable');
			}
			return {
				mtime: result.data.mtime,
				size: result.data.size,
				directory: result.data.isDirectory,
			};
		},
		async list(dir) {
			const result = await readDirRemote(dir, remote);
			if (!result.success || !result.data) throw new Error('Remote directory unavailable');
			return result.data.map((e) => ({ name: e.name, directory: e.isDirectory }));
		},
		async read(file) {
			const result = await readFileRemote(file, remote);
			if (!result.success || result.data === undefined) throw new Error('Remote file unavailable');
			return result.data;
		},
	};
}

/** Read-only discovery. Cached reads never touch the filesystem or launch a provider. */
export function createNativeCommandDiscovery(deps: Dependencies) {
	const cache = new Map<string, CacheEntry>();
	const pending = new Map<string, Promise<NativeCommandSnapshot>>();
	return async (
		context: NativeCommandContext,
		cachedOnly = false
	): Promise<NativeCommandSnapshot> => {
		const fallback: NativeCommandSnapshot = { commands: nativeBuiltinCommands(context.toolType) };
		if (!['claude-code', 'codex'].includes(context.toolType)) return fallback;
		const ssh = context.sessionSshRemoteConfig;
		const warning = ssh?.enabled ? 'remote-unavailable' : 'unavailable';
		try {
			const { cwd } = handoffLocation(context);
			const remote = ssh?.enabled ? deps.remote?.(ssh.remoteId!) : undefined;
			if (ssh?.enabled && !remote) return { ...fallback, warning };
			let account = resolveAgentAccountDir(
				{ ...context, sshRemote: !!ssh?.enabled },
				deps.layers(context.toolType)
			);
			const key = JSON.stringify([context.toolType, cwd, account, remote ?? null]);
			const previous = cache.get(key);
			if (cachedOnly) return previous?.result ?? fallback;
			const inFlight = pending.get(key);
			if (inFlight) return inFlight;
			const scan = async (): Promise<NativeCommandSnapshot> => {
				if (remote && !account) {
					const variable = context.toolType === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
					const defaultDir = context.toolType === 'codex' ? '.codex' : '.claude';
					const command = await buildSshCommand(remote, {
						command: 'sh',
						args: ['-c', `printf '%s' "\${${variable}:-$HOME/${defaultDir}}"`],
						cwd,
						env: remote.remoteEnv,
					});
					const result = await execFileNoThrow(command.command, command.args, undefined, {
						timeout: 10000,
					});
					if (result.exitCode !== 0 || !result.stdout.trim())
						throw new Error('Remote account unavailable');
					account = result.stdout.trim();
				}
				if (!account) throw new Error('Account unavailable');
				const io = remote ? remoteFiles(remote) : localFiles;
				const paths = remote ? path.posix : path;
				const next: CacheEntry = { result: fallback, directories: new Map(), files: new Map() };
				const commands = new Map<string, NativeCommand>();
				const claimed = new Set<string>();
				let entriesSeen = 0;
				let bytesSeen = 0;
				const list = async (dir: string): Promise<CommandEntry[]> => {
					const stat = await io.stat(dir);
					if (!stat) return [];
					if (!stat.directory) throw new Error('Command directory is not a directory');
					const revision = `${stat.mtime}:${stat.size}`;
					const saved = previous?.directories.get(dir);
					const entries = saved?.revision === revision ? saved.entries : await io.list(dir);
					entriesSeen += entries.length;
					if (entriesSeen > 2048) throw new Error('Command directory limit reached');
					next.directories.set(dir, { revision, entries });
					return [...entries].sort((a, b) => a.name.localeCompare(b.name));
				};
				const add = async (file: string, name: string, source: 'project' | 'user') => {
					if (claimed.has(name)) return;
					const stat = await io.stat(file);
					if (!stat || stat.directory) return;
					bytesSeen += stat.size;
					if (stat.size > 256 * 1024 || bytesSeen > 2 * 1024 * 1024)
						throw new Error('Command file limit reached');
					const revision = `${stat.mtime}:${stat.size}`;
					const saved = previous?.files.get(file);
					const content = saved?.revision === revision ? saved.content : await io.read(file);
					next.files.set(file, { revision, content });
					const doc = parseCodexMarkdownDoc(content);
					claimed.add(name);
					if (!doc.userInvocable || !doc.body) return;
					commands.set(name, {
						command: `/${name}`,
						description:
							doc.description ||
							doc.body
								.split('\n')
								.find((l) => l.trim())
								?.replace(/^#+\s*/, '')
								.slice(0, 100) ||
							'',
						source,
						...(context.toolType === 'codex' ? { prompt: doc.body } : {}),
					});
				};
				const markdown = async (
					dir: string,
					source: 'project' | 'user',
					prefix = '',
					depth = 0
				): Promise<void> => {
					if (depth > 8) throw new Error('Command nesting limit reached');
					for (const entry of await list(dir)) {
						if (entry.name.startsWith('.')) continue;
						const name = prefix + entry.name;
						if (entry.directory && context.toolType === 'claude-code')
							await markdown(paths.join(dir, entry.name), source, `${name}:`, depth + 1);
						else if (entry.name.endsWith('.md'))
							await add(paths.join(dir, entry.name), name.slice(0, -3), source);
					}
				};
				const skillDirs =
					context.toolType === 'codex'
						? getCodexSkillDirs(cwd, { CODEX_HOME: account }, paths)
						: [paths.join(cwd, '.claude', 'skills'), paths.join(account, 'skills')];
				const commandDirs =
					context.toolType === 'codex'
						? getCodexPromptDirs(cwd, { CODEX_HOME: account }, paths)
						: [paths.join(cwd, '.claude', 'commands'), paths.join(account, 'commands')];
				for (const [index, source] of [
					[0, 'project'],
					[1, 'user'],
				] as const) {
					const skills = skillDirs[index];
					for (const entry of await list(skills)) {
						if (entry.name.startsWith('.')) continue;
						const skill = paths.join(skills, entry.name, 'SKILL.md');
						await add(skill, entry.name, source);
						if (context.toolType === 'claude-code' && !commands.has(entry.name))
							await add(paths.join(skills, entry.name, 'skill.md'), entry.name, source);
					}
					await markdown(commandDirs[index], source);
				}
				for (const cmd of fallback.commands)
					if (!commands.has(cmd.command.slice(1))) commands.set(cmd.command.slice(1), cmd);
				next.result = {
					commands: [...commands.values()].sort((a, b) => a.command.localeCompare(b.command)),
				};
				cache.delete(key);
				cache.set(key, next);
				while (cache.size > 64) cache.delete(cache.keys().next().value!);
				return next.result;
			};
			const work = scan()
				.catch(() => {
					const result = { ...fallback, warning } as NativeCommandSnapshot;
					// A failed remote read must never continue offering the last host's custom commands.
					cache.delete(key);
					return result;
				})
				.finally(() => pending.delete(key));
			pending.set(key, work);
			return work;
		} catch {
			return { ...fallback, warning };
		}
	};
}
