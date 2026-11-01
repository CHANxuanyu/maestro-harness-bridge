import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNativeInstructionFiles } from '../../../main/agents/native-instructions';
import { getProviderAccountDirs } from '../../../main/agents/provider-account-dirs';
import { prepareDeepSeekPreset } from '../../../main/agents/deepseek-preset';

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }));
vi.mock('../../../main/stores/instances', () => ({ isInitialized: () => false }));
vi.mock('../../../main/utils/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));

let root: string;
let homeDir: string;
let userDataDir: string;
beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-instruction-dirs-')));
	homeDir = path.join(root, 'home');
	userDataDir = path.join(root, 'data');
	await fs.mkdir(homeDir);
	await fs.mkdir(userDataDir);
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
	vi.restoreAllMocks();
});
const options = () => ({
	homeDir,
	userDataDir,
	env: {},
	globalShellEnvVars: {},
	sessions: [],
	agentLevelEnvVars: {},
});

describe('native instruction account discovery', () => {
	it('keeps separate instruction files when Claude accounts share a transcript pool', async () => {
		const first = path.join(homeDir, '.claude');
		const second = path.join(homeDir, '.claude-work');
		await fs.mkdir(path.join(first, 'projects'), { recursive: true });
		await fs.mkdir(second);
		await fs.symlink(
			path.join(first, 'projects'),
			path.join(second, 'projects'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		expect(
			await getProviderAccountDirs('claude-code', {
				homeDir,
				env: {},
				sessions: [],
				agentLevelEnvVars: {},
			})
		).toEqual([first]);
		const files = await getNativeInstructionFiles(options());
		expect(
			files
				.filter((file) => file.provider === 'claude-code')
				.map((file) => file.path)
				.sort()
		).toEqual([path.join(first, 'CLAUDE.md'), path.join(second, 'CLAUDE.md')].sort());
	});
	it('includes configured, provider, global, process and default account paths while excluding SSH-only paths', async () => {
		const local = path.join(root, 'local');
		const remote = path.join(root, 'remote-only');
		const provider = path.join(root, 'provider');
		const global = path.join(root, 'global');
		const files = await getNativeInstructionFiles({
			...options(),
			env: { CLAUDE_CONFIG_DIR: '~/exported', CODEX_HOME: path.join(root, 'codex-exported') },
			globalShellEnvVars: { CLAUDE_CONFIG_DIR: global },
			agentLevelEnvVars: { 'claude-code': { CLAUDE_CONFIG_DIR: provider } },
			sessions: [
				{ toolType: 'claude-code', customEnvVars: { CLAUDE_CONFIG_DIR: local } },
				{
					toolType: 'claude-code',
					customEnvVars: { CLAUDE_CONFIG_DIR: remote },
					sessionSshRemoteConfig: { enabled: true },
				},
			],
		});
		const paths = files.map((file) => file.path);
		for (const dir of [
			local,
			provider,
			global,
			path.join(homeDir, 'exported'),
			path.join(homeDir, '.claude'),
		])
			expect(paths).toContain(path.join(dir, 'CLAUDE.md'));
		expect(paths).toContain(path.join(root, 'codex-exported', 'AGENTS.md'));
		expect(paths).toContain(path.join(homeDir, '.codex', 'AGENTS.md'));
		expect(paths).not.toContain(path.join(remote, 'CLAUDE.md'));
	});
	it('finds factory-created DeepSeek accounts even without a live agent or transcript', async () => {
		const preset = await prepareDeepSeekPreset({ apiKey: 'synthetic-key' }, userDataDir);
		const directory = preset.customEnvVars.CLAUDE_CONFIG_DIR;
		const files = await getNativeInstructionFiles(options());
		expect(files).toContainEqual({
			path: path.join(directory, 'CLAUDE.md'),
			provider: 'claude-code',
		});
		await expect(fs.stat(path.join(directory, 'projects'))).rejects.toMatchObject({
			code: 'ENOENT',
		});
	});
	it('does not create absent account or user-data directories while locating files', async () => {
		await fs.rmdir(userDataDir);
		const files = await getNativeInstructionFiles(options());
		expect(files.map((file) => file.path).sort()).toEqual(
			[path.join(homeDir, '.claude', 'CLAUDE.md'), path.join(homeDir, '.codex', 'AGENTS.md')].sort()
		);
		await expect(fs.stat(userDataDir)).rejects.toMatchObject({ code: 'ENOENT' });
		expect(await fs.readdir(homeDir)).toEqual([]);
	});
});
