import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const isolation = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => isolation.root } }));
vi.mock('electron-store', () => ({
	default: class {
		get(_key: string, fallback: unknown) {
			return fallback;
		}
		set() {}
	},
}));
vi.mock('../../../main/utils/logger', () => ({
	logger: { info() {}, warn() {}, error() {}, debug() {} },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException() {} }));
vi.mock('../../../main/agents/provider-account-dirs', () => ({
	getProviderAccountDirs: async () => [],
}));
import { ClaudeSessionStorage } from '../../../main/storage/claude-session-storage';
import { CodexSessionStorage } from '../../../main/storage/codex-session-storage';
import { discoverProjectHistory } from '../../../main/storage/project-history';
import { encodeClaudeProjectPath } from '../../../shared/pathUtils';
let project: string;
let worktree: string;
let account: string;
const id = '11111111-2222-4333-8444-555555555555';
const git = (...args: string[]) =>
	execFileSync('git', args, {
		cwd: project,
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
		stdio: 'pipe',
	});
beforeEach(async () => {
	isolation.root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-history-')));
	project = path.join(isolation.root, 'repo');
	account = path.join(isolation.root, 'account');
	await fs.mkdir(project);
	git('init');
	git(
		'-c',
		'user.name=Fixture',
		'-c',
		'user.email=fixture@example.test',
		'commit',
		'--allow-empty',
		'-m',
		'fixture'
	);
	worktree = path.join(project, '.claude', 'worktrees', 'x');
	git('worktree', 'add', '-b', 'fixture-x', worktree);
	const dir = path.join(account, 'projects', encodeClaudeProjectPath(worktree));
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		path.join(dir, `${id}.jsonl`),
		JSON.stringify({
			type: 'user',
			uuid: id,
			cwd: worktree,
			message: { role: 'user', content: 'Worktree question' },
		}) + '\n'
	);
	const codexDir = path.join(account, 'sessions', '2026', '11', '03');
	await fs.mkdir(codexDir, { recursive: true });
	await fs.writeFile(
		path.join(codexDir, `rollout-2026-11-03T00-00-00-${id}.jsonl`),
		[
			{ type: 'session_meta', payload: { id, cwd: worktree } },
			{
				type: 'message',
				role: 'user',
				content: [{ type: 'input_text', text: 'Worktree question' }],
			},
		]
			.map((row) => JSON.stringify(row))
			.join('\n')
	);
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(isolation.root, { recursive: true, force: true });
});
it.each(['claude', 'codex'])(
	'includes %s worktree history with the recorded cwd and identity',
	async (provider) => {
		const storage = provider === 'claude' ? new ClaudeSessionStorage() : new CodexSessionStorage();
		const sessions = await storage.listSessions(project, undefined, account);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			projectPath: worktree,
			worktree: { path: worktree, branch: 'fixture-x' },
		});
		expect(
			(
				await storage.readSessionMessages(sessions[0].projectPath, id, {
					configDir: account,
					readOnly: true,
				})
			).messages[0].content
		).toBe('Worktree question');
	}
);

it.each(
	['claude', 'codex'].flatMap((provider) =>
		[false, true].flatMap((missing) =>
			[false, true].map((nested) => ({ provider, missing, nested }))
		)
	)
)(
	'finds unregistered $provider desktop history, missing=$missing, nested=$nested',
	async ({ provider, missing, nested }) => {
		git('worktree', 'remove', '--force', worktree);
		const cwd = nested ? path.join(worktree, 'packages', 'app') : worktree;
		if (!missing) await fs.mkdir(cwd, { recursive: true });
		const file =
			provider === 'claude'
				? path.join(account, 'projects', encodeClaudeProjectPath(cwd), `${id}.jsonl`)
				: path.join(
						account,
						'sessions',
						'2026',
						'11',
						'03',
						`rollout-2026-11-03T00-00-00-${id}.jsonl`
					);
		if (provider === 'claude' && nested) {
			await fs.mkdir(path.dirname(file), { recursive: true });
			await fs.rename(
				path.join(account, 'projects', encodeClaudeProjectPath(worktree), `${id}.jsonl`),
				file
			);
		}
		const content = (await fs.readFile(file, 'utf8')).replaceAll(
			JSON.stringify(worktree),
			JSON.stringify(cwd)
		);
		await fs.writeFile(file, content);
		const storage = provider === 'claude' ? new ClaudeSessionStorage() : new CodexSessionStorage();
		const sessions = await storage.listSessions(project, undefined, account);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			projectPath: cwd,
			worktree: { path: worktree, name: 'x', missing },
		});
		expect((await storage.listSessionsPaginated(project, { configDir: account })).sessions).toEqual(
			sessions
		);
		for (const scope of [project, cwd]) {
			expect(
				(await storage.readSessionMessages(scope, id, { configDir: account, readOnly: true }))
					.messages[0].content
			).toBe('Worktree question');
		}
		const { nativeSessionResumeCwd } = await import('../../../main/storage/local-project-paths');
		if (missing) {
			await expect(nativeSessionResumeCwd(storage, project, id, account)).rejects.toThrow(
				'Worktree is gone or unavailable. This conversation is read-only.'
			);
		} else expect(await nativeSessionResumeCwd(storage, project, id, account)).toBe(cwd);
		expect(await fs.readFile(file, 'utf8')).toBe(content);
	}
);

it.each(['claude', 'codex'])(
	'excludes %s transcript cwd paths that merely share the project prefix',
	async (provider) => {
		for (const cwd of [path.join(`${project}-other`, '.claude', 'worktrees', 'x')]) {
			// Put the misleading cwd in an otherwise plausible transcript folder.
			const file =
				provider === 'claude'
					? path.join(account, 'projects', encodeClaudeProjectPath(worktree), 'wrong.jsonl')
					: path.join(account, 'sessions', '2026', '11', '03', 'wrong.jsonl');
			await fs.writeFile(
				file,
				provider === 'claude'
					? JSON.stringify({ type: 'user', cwd, message: { content: 'Wrong project' } })
					: JSON.stringify({ type: 'session_meta', payload: { id: 'wrong', cwd } }) +
							'\n' +
							JSON.stringify({ type: 'message', role: 'user', content: 'Wrong project' })
			);
			const storage =
				provider === 'claude' ? new ClaudeSessionStorage() : new CodexSessionStorage();
			expect(
				(await storage.listSessions(project, undefined, account)).map((s) => s.sessionId)
			).toEqual([id]);
		}
	}
);

it('does not read an unrelated Claude cwd from a plausible archived worktree folder', async () => {
	const dir = path.join(
		account,
		'projects',
		encodeClaudeProjectPath(path.join(worktree, 'nested'))
	);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		path.join(dir, 'wrong.jsonl'),
		JSON.stringify({
			type: 'user',
			cwd: path.join(`${project}-other`, '.claude', 'worktrees', 'x'),
			message: { content: 'Other project must stay excluded' },
		})
	);
	await expect(
		new ClaudeSessionStorage().readSessionMessages(project, 'wrong', {
			configDir: account,
			readOnly: true,
		})
	).rejects.toThrow(/ENOENT/);
});
it('gives an exact-cwd owner precedence across duplicate scopes and keeps deleted worktrees readable', async () => {
	const storage = new ClaudeSessionStorage();
	const owners = [
		{ id: 'main', toolType: 'claude-code', cwd: project },
		{ id: 'exact', toolType: 'claude-code', cwd: worktree, projectRoot: project },
	];
	const result = await discoverProjectHistory(
		[
			{ projectKey: 'main', projectPath: project, ownerIds: ['main'] },
			{ projectKey: 'exact', projectPath: worktree, ownerIds: ['exact'] },
		],
		{
			storages: [storage],
			owners,
			accountDirs: async () => [account],
			ownerAccountDir: () => account,
			remote: () => undefined,
			onError: (error) => {
				throw error;
			},
		}
	);
	expect(result.conversations).toHaveLength(1);
	expect(result.conversations[0]).toMatchObject({ ownerId: 'exact', projectPath: worktree });
	await fs.rm(worktree, { recursive: true, force: true });
	expect((await storage.listSessions(project, undefined, account))[0]).toMatchObject({
		worktree: { path: worktree, missing: true },
	});
	expect(
		(await storage.readSessionMessages(worktree, id, { configDir: account, readOnly: true }))
			.messages[0].content
	).toBe('Worktree question');
});

it('resumes in the transcript cwd and refuses sending after its worktree is removed', async () => {
	const { nativeSessionResumeCwd } = await import('../../../main/storage/local-project-paths');
	const storage = new ClaudeSessionStorage();
	expect(await nativeSessionResumeCwd(storage, project, id, account)).toBe(worktree);
	await fs.rm(worktree, { recursive: true, force: true });
	await expect(nativeSessionResumeCwd(storage, project, id, account)).rejects.toThrow(
		'Worktree is gone'
	);
	expect(
		(await storage.readSessionMessages(worktree, id, { configDir: account, readOnly: true }))
			.messages
	).toHaveLength(1);
});

it('finds an external linked worktree and rejects a misleading encoded-folder candidate', async () => {
	const external = path.join(isolation.root, 'external-worktree');
	git('worktree', 'add', '-b', 'external-branch', external);
	const dir = path.join(account, 'projects', encodeClaudeProjectPath(external));
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		path.join(dir, 'external.jsonl'),
		JSON.stringify({ type: 'user', cwd: external, message: { content: 'External worktree' } })
	);
	const wrong = path.join(account, 'projects', encodeClaudeProjectPath(worktree), 'wrong.jsonl');
	await fs.writeFile(
		wrong,
		JSON.stringify({
			type: 'user',
			cwd: path.join(isolation.root, 'unrelated'),
			message: { content: 'Wrong repository' },
		})
	);
	const result = await new ClaudeSessionStorage().listSessions(project, undefined, account);
	expect(result.map((entry) => entry.sessionId).sort()).toEqual(['external', id].sort());
	expect(result.find((entry) => entry.sessionId === 'external')).toMatchObject({
		projectPath: external,
		worktree: { branch: 'external-branch' },
	});
});

it('caches Git registry queries across repeated Claude and Codex refreshes', async () => {
	const remoteGit = await import('../../../main/utils/remote-git');
	const query = vi.spyOn(remoteGit, 'execGitReadOnly');
	const claude = new ClaudeSessionStorage();
	const codex = new CodexSessionStorage();
	await claude.listSessions(project, undefined, account);
	await codex.listSessions(project, undefined, account);
	const calls = query.mock.calls.length;
	expect(calls).toBe(2);
	await claude.listSessions(project, undefined, account);
	await codex.listSessions(project, undefined, account);
	expect(query).toHaveBeenCalledTimes(calls);
});

it('reads a worktree conversation through the main project CLI read path', async () => {
	const result = await new ClaudeSessionStorage().readSessionMessages(project, id, {
		configDir: account,
		readOnly: true,
	});
	expect(result.messages[0].content).toBe('Worktree question');
});

it('keeps main-repository history under its own scope when another worktree scope sorts first', async () => {
	const mainDir = path.join(account, 'projects', encodeClaudeProjectPath(project));
	await fs.mkdir(mainDir, { recursive: true });
	await fs.writeFile(
		path.join(mainDir, 'main-native.jsonl'),
		JSON.stringify({ type: 'user', cwd: project, message: { content: 'Main question' } })
	);
	const owners = [
		{ id: 'main', toolType: 'claude-code', cwd: project },
		{ id: 'exact', toolType: 'claude-code', cwd: worktree },
	];
	const result = await discoverProjectHistory(
		[
			{ projectKey: 'main', projectPath: project, ownerIds: ['main'] },
			{ projectKey: 'exact', projectPath: worktree, ownerIds: ['exact'] },
		],
		{
			storages: [new ClaudeSessionStorage()],
			owners,
			accountDirs: async () => [account],
			ownerAccountDir: () => account,
			remote: () => undefined,
			onError: (error) => {
				throw error;
			},
		}
	);
	expect(result.conversations).toHaveLength(2);
	expect(
		result.conversations.find((entry) => entry.nativeSessionId === 'main-native')
	).toMatchObject({ projectKey: 'main', ownerId: 'main', projectPath: project });
});

it.each(['claude', 'codex'])(
	'retains %s worktree identity when listing the exact worktree project',
	async (provider) => {
		const storage = provider === 'claude' ? new ClaudeSessionStorage() : new CodexSessionStorage();
		expect((await storage.listSessions(worktree, undefined, account))[0]).toMatchObject({
			worktree: { path: worktree, branch: 'fixture-x' },
		});
	}
);
