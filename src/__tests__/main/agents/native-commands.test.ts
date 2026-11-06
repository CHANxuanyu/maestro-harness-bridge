import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeCommandDiscovery } from '../../../main/agents/native-commands';

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
			expect(statRemote).toHaveBeenCalledWith('~/remote-project/.claude/skills', remote);
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
			{ command: '/nested:check', description: 'Nested', source: 'project' },
			{ command: '/visible', description: 'Visible skill', source: 'project' },
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
