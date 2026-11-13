import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	type CommandFiles,
	createNativeCommandDiscovery,
	nativeCommandScope,
	rememberNativeCommands,
} from '../../../main/agents/native-commands';

vi.mock('../../../main/utils/remote-fs', () => ({
	statRemote: vi.fn(),
	readDirRemote: vi.fn(),
	readFileRemote: vi.fn(),
}));
import { statRemote, readDirRemote, readFileRemote } from '../../../main/utils/remote-fs';

let root: string;
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-commands-'));
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

async function file(relative: string, body = 'Command body') {
	const target = path.join(root, relative);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, body);
	return target;
}
function request(toolType = 'claude-code', account = 'account-a') {
	return {
		toolType,
		cwd: path.join(root, 'project'),
		customEnvVars: {
			[toolType === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']: path.join(root, account),
		},
	};
}
function discovery() {
	return createNativeCommandDiscovery({ layers: () => ({ homeDir: root, env: {} }) });
}
const authored = (result: Awaited<ReturnType<ReturnType<typeof discovery>>>) =>
	result.commands.filter((c) => c.source !== 'builtin');

describe('account scoped native commands', () => {
	it('keeps file priority, hiding and deletion when a native report contains the same names', async () => {
		const context = request();
		const read = discovery();
		const selected = await file(
			'project/.claude/commands/plugin/review.md',
			'Selected project body'
		);
		await file('project/.claude/skills/hidden/SKILL.md', '---\nuser-invocable: false\n---\nHidden');
		rememberNativeCommands(nativeCommandScope(context, { homeDir: root, env: {} }).key, [
			'plugin:review',
			'plugin:other',
			'hidden',
		]);
		const first = await read(context);
		expect(first.commands.find((c) => c.command === '/plugin:review')).toMatchObject({
			source: 'project',
			prompt: 'Selected project body',
		});
		expect(first.commands.some((c) => c.command === '/hidden')).toBe(false);
		expect(first.commands.find((c) => c.command === '/plugin:other')?.source).toBe('reported');
		await fs.unlink(selected);
		expect((await read(context)).commands.some((c) => c.command === '/plugin:review')).toBe(false);
	});

	it('does not let cached native reports bypass a read failure', async () => {
		const context = request();
		const read = discovery();
		rememberNativeCommands(nativeCommandScope(context, { homeDir: root, env: {} }).key, [
			'plugin:review',
		]);
		expect((await read(context)).commands.some((c) => c.command === '/plugin:review')).toBe(true);
		const stat = vi
			.spyOn(fs, 'stat')
			.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
		try {
			expect((await read(context)).warning).toBe('unavailable');
			const cached = await read(context, true);
			expect(cached.warning).toBe('unavailable');
			expect(cached.commands.every((c) => c.source === 'builtin')).toBe(true);
		} finally {
			stat.mockRestore();
		}
	});

	it('isolates reports between SSH hosts and remote account overrides without local reads', async () => {
		const remote = {
			id: 'report-host',
			name: 'Fixture',
			host: 'fixture.invalid',
			port: 22,
			username: 'fixture',
			enabled: true,
		};
		const layers = { homeDir: root, env: {} };
		const read = createNativeCommandDiscovery({
			layers: () => layers,
			remote: (id) => ({ ...remote, id }),
		});
		const context = {
			...request(),
			customEnvVars: { CLAUDE_CONFIG_DIR: '~/account-a' },
			sessionSshRemoteConfig: {
				enabled: true,
				remoteId: remote.id,
				workingDirOverride: '~/project',
			},
		};
		rememberNativeCommands(nativeCommandScope(context, layers, remote).key, ['plugin:remote']);
		expect((await read(context, true)).commands.some((c) => c.command === '/plugin:remote')).toBe(
			true
		);
		expect(
			(
				await read(
					{
						...context,
						sessionSshRemoteConfig: { ...context.sessionSshRemoteConfig, remoteId: 'other-host' },
					},
					true
				)
			).commands.some((c) => c.command === '/plugin:remote')
		).toBe(false);
		expect(
			(
				await read({ ...context, customEnvVars: { CLAUDE_CONFIG_DIR: '~/account-b' } }, true)
			).commands.some((c) => c.command === '/plugin:remote')
		).toBe(false);
	});

	it('executes the discovered Claude project skill body instead of the personal namesake', async () => {
		await file('account-a/skills/deploy/SKILL.md', 'Personal deployment');
		await file('project/.claude/skills/deploy/SKILL.md', 'Project deployment $ARGUMENTS');
		const result = await discovery()(request());
		expect(result.commands.find((c) => c.command === '/deploy')).toEqual({
			command: '/deploy',
			description: 'Project deployment $ARGUMENTS',
			source: 'project',
			prompt: 'Project deployment $ARGUMENTS',
		});
	});

	it('follows the target metadata for remote command directory symlinks', async () => {
		const remote = {
			id: 'linked-host',
			name: 'Fixture',
			host: 'fixture.invalid',
			port: 22,
			username: 'fixture',
			enabled: true,
		};
		vi.mocked(statRemote).mockImplementation(async (target, _remote, _deps, options) => {
			if (target === '~/account/commands')
				return {
					success: true,
					data: { size: 1, mtime: 10, isDirectory: options?.followSymlinks === true },
				};
			if (target === '~/account/commands/linked.md')
				return { success: true, data: { size: 6, mtime: 10, isDirectory: false } };
			return { success: false, error: `Path not found: ${target}` };
		});
		vi.mocked(readDirRemote).mockResolvedValue({
			success: true,
			data: [{ name: 'linked.md', isDirectory: false, isSymlink: false }],
		});
		vi.mocked(readFileRemote).mockResolvedValue({ success: true, data: 'Linked' });
		const read = createNativeCommandDiscovery({
			layers: () => ({ homeDir: root, env: {} }),
			remote: () => remote,
		});
		const result = await read({
			...request(),
			customEnvVars: { CLAUDE_CONFIG_DIR: '~/account' },
			sessionSshRemoteConfig: {
				enabled: true,
				remoteId: remote.id,
				workingDirOverride: '~/project',
			},
		});
		expect(result.warning).toBeUndefined();
		expect(result.commands).toContainEqual({
			command: '/linked',
			description: 'Linked',
			source: 'user',
		});
	});

	it('does not revive a hidden project skill from the user account', async () => {
		await file(
			'project/.codex/skills/private/SKILL.md',
			'---\nuser-invocable: false\n---\nProject reference'
		);
		await file('account-a/skills/private/SKILL.md', 'User command');
		expect(authored(await discovery()(request('codex')))).toEqual([]);
	});

	it('checks metadata without rereading unchanged command bodies', async () => {
		await file('account-a/commands/reused.md');
		const read = discovery();
		await read(request());
		const readSpy = vi.spyOn(fs, 'readFile');
		const listSpy = vi.spyOn(fs, 'readdir');
		try {
			expect(authored(await read(request())).map((c) => c.command)).toEqual(['/reused']);
			expect(readSpy).not.toHaveBeenCalled();
			expect(listSpy).not.toHaveBeenCalled();
		} finally {
			readSpy.mockRestore();
			listSpy.mockRestore();
		}
	});
	it('reads SSH paths remotely, honors the SSH cwd and drops stale commands on failure', async () => {
		const remote = {
			id: 'ssh-a',
			name: 'Fixture',
			host: 'fixture.invalid',
			port: 22,
			username: 'fixture',
			enabled: true,
		};
		vi.mocked(statRemote).mockImplementation(async (file) =>
			file === '~/account/commands'
				? { success: true, data: { size: 1, mtime: 1, isDirectory: true } }
				: file === '~/account/commands/remote.md'
					? { success: true, data: { size: 10, mtime: 1, isDirectory: false } }
					: { success: false, error: `Path not found: ${file}` }
		);
		vi.mocked(readDirRemote).mockResolvedValue({
			success: true,
			data: [{ name: 'remote.md', isDirectory: false, isSymlink: false }],
		});
		vi.mocked(readFileRemote).mockResolvedValue({ success: true, data: 'Remote command' });
		const read = createNativeCommandDiscovery({
			layers: () => ({ homeDir: root, env: {} }),
			remote: () => remote,
		});
		const context = {
			...request(),
			customEnvVars: { CLAUDE_CONFIG_DIR: '~/account' },
			sessionSshRemoteConfig: {
				enabled: true,
				remoteId: remote.id,
				workingDirOverride: '~/remote-project',
			},
		};
		const localRead = vi.spyOn(fs, 'stat');
		try {
			expect(authored(await read(context))).toEqual([
				{ command: '/remote', description: 'Remote command', source: 'user' },
			]);
			expect(localRead).not.toHaveBeenCalled();
			expect(statRemote).toHaveBeenCalledWith(
				'~/remote-project/.claude/skills',
				remote,
				undefined,
				{ followSymlinks: true }
			);
			vi.mocked(statRemote).mockResolvedValue({ success: false, error: 'Permission denied' });
			const failed = await read(context);
			expect(failed.warning).toBe('remote-unavailable');
			expect(authored(failed)).toEqual([]);
			expect(failed.commands.some((c) => c.command === '/help')).toBe(true);
		} finally {
			localRead.mockRestore();
		}
	});
	it('discovers skills and nested commands and respects user-invocable', async () => {
		await file(
			'project/.claude/skills/visible/SKILL.md',
			'---\ndescription: Visible skill\n---\nUse this'
		);
		await file(
			'project/.claude/skills/hidden/SKILL.md',
			'---\nuser-invocable: false\n---\nReference'
		);
		await file('project/.claude/commands/nested/check.md', 'Nested');
		expect(authored(await discovery()(request()))).toEqual([
			{ command: '/nested:check', description: 'Nested', source: 'project', prompt: 'Nested' },
			{ command: '/visible', description: 'Visible skill', source: 'project', prompt: 'Use this' },
		]);
	});

	it.each(['claude-code', 'codex'])(
		'isolates two %s accounts on the same project',
		async (tool) => {
			const dir = tool === 'codex' ? 'prompts' : 'commands';
			await file(`account-a/${dir}/alpha.md`);
			await file(`account-b/${dir}/beta.md`);
			const read = discovery();
			expect(authored(await read(request(tool))).map((c) => c.command)).toEqual(['/alpha']);
			expect(authored(await read(request(tool, 'account-b'))).map((c) => c.command)).toEqual([
				'/beta',
			]);
		}
	);
	it('keeps the cache available and refreshes additions, edits and deletions', async () => {
		const read = discovery();
		const first = await file('account-a/commands/first.md', 'First');
		await read(request());
		await file('account-a/commands/new.md', 'New');
		expect(authored(await read(request(), true)).map((c) => c.command)).toEqual(['/first']);
		expect(authored(await read(request())).map((c) => c.command)).toEqual(['/first', '/new']);
		await fs.writeFile(first, 'Changed description');
		expect(authored(await read(request()))[0].description).toBe('Changed description');
		await fs.unlink(first);
		expect(authored(await read(request())).map((c) => c.command)).toEqual(['/new']);
	});
	it.each([
		['win32', ['/first', '/new']],
		['darwin', ['/first']],
	] as const)(
		'on %s, a local command folder whose stat did not move lists %j',
		async (platform, expected) => {
			// NTFS does not reliably move a folder's modified time when a file is
			// created and reports its size as 0. Simulate that folder stat exactly.
			const dir = path.join(root, 'account-a', 'commands');
			const frozen = new Map<string, { mtime: number; size: number; directory: boolean }>();
			const localFiles: CommandFiles = {
				async stat(target) {
					try {
						const info = await fs.stat(target);
						const value = { mtime: info.mtimeMs, size: info.size, directory: info.isDirectory() };
						if (!info.isDirectory()) return value;
						if (!frozen.has(target)) frozen.set(target, value);
						return frozen.get(target);
					} catch {
						return undefined;
					}
				},
				async list(target) {
					const entries = await fs.readdir(target, { withFileTypes: true });
					return entries.map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
				},
				read: (target) => fs.readFile(target, 'utf8'),
			};
			const read = createNativeCommandDiscovery({
				layers: () => ({ homeDir: root, env: {} }),
				platform,
				localFiles,
			});
			await file('account-a/commands/first.md', 'First');
			await read(request());
			expect(frozen.has(dir)).toBe(true);
			await file('account-a/commands/new.md', 'New');
			expect(authored(await read(request())).map((c) => c.command)).toEqual(expected);
		}
	);
	it.each(['claude-code', 'codex'])(
		'lets project commands override user commands for %s',
		async (tool) => {
			const dir = tool === 'codex' ? 'prompts' : 'commands';
			const config = tool === 'codex' ? '.codex' : '.claude';
			await file(`account-a/${dir}/review.md`, 'User');
			await file(`project/${config}/${dir}/review.md`, 'Project');
			const result = await discovery()(request(tool));
			expect(result.commands.filter((c) => c.command === '/review')).toEqual([
				expect.objectContaining({ command: '/review', source: 'project', description: 'Project' }),
			]);
		}
	);
	it('resolves inherited provider and global account layers through the canonical resolver', async () => {
		await file('account-b/commands/inherited.md');
		const read = createNativeCommandDiscovery({
			layers: () => ({
				homeDir: root,
				env: {},
				agentLevelEnvVars: { CLAUDE_CONFIG_DIR: path.join(root, 'account-b') },
				globalShellEnvVars: { CLAUDE_CONFIG_DIR: path.join(root, 'account-a') },
			}),
		});
		expect(
			authored(await read({ ...request(), customEnvVars: undefined })).map((c) => c.command)
		).toEqual(['/inherited']);
	});
	it('does not use local files when an SSH host is unavailable', async () => {
		await file('account-a/commands/local-only.md');
		const read = createNativeCommandDiscovery({
			layers: () => ({ homeDir: root, env: {} }),
			remote: () => undefined,
		});
		const result = await read({
			...request(),
			sessionSshRemoteConfig: { enabled: true, remoteId: 'missing' },
		});
		expect(result.warning).toBe('remote-unavailable');
		expect(result.commands.length).toBeGreaterThan(0);
		expect(result.commands.every((c) => c.source === 'builtin')).toBe(true);
	});
	it('keeps builtins visible on local read failures', async () => {
		const read = discovery();
		const spy = vi
			.spyOn(fs, 'stat')
			.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
		try {
			const result = await read(request());
			expect(result.warning).toBe('unavailable');
			expect(result.commands.some((c) => c.command === '/help')).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});
});
