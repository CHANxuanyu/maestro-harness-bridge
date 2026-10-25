import {
	test as base,
	expect,
	type ElectronApplication,
	type Page,
	type TestInfo,
} from '@playwright/test';
import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installedCli, prepareCredentials } from './native/real-runtime.cjs';
import { appendTurn } from './native/append-turn.cjs';
import { realPrompt, realExternalTurn } from './native-real';
import { launchElectronApp } from './electron-app';
import { createOmpTurn } from './native/omp-protocol.cjs';
import { createGrokTurn } from './native/grok-protocol.cjs';
import { createOpenCodeTurn } from './native/opencode-protocol.cjs';

const exec = promisify(execFile);
export type Provider = 'claude' | 'codex' | 'opencode' | 'grok' | 'omp';
export interface NativeTool {
	id: string;
	command: string;
	output: string;
	status?: 'completed' | 'failed';
	updates?: string[];
	gates?: string[];
}
export interface NativeScene {
	answer: string;
	tools?: NativeTool[];
	waitForStop?: boolean;
	stopDiagnostic?: boolean;
	toolDelay?: number;
	exitGate?: string;
	approval?: boolean;
}

export class NativeApp {
	readonly root = fs.mkdtempSync(
		path.join(
			process.env.MAESTRO_E2E_TEMP_ROOT || (process.platform === 'darwin' ? '/tmp' : os.tmpdir()),
			'maestro-native-e2e-'
		)
	);
	readonly data = path.join(this.root, 'maestro');
	readonly project = path.join(this.root, 'project');
	readonly claude = path.join(this.root, 'claude');
	readonly codex = path.join(this.root, 'codex');
	readonly omp = path.join(this.root, 'omp', 'agent');
	readonly grok = path.join(this.root, 'grok');
	readonly opencode = path.join(this.root, 'xdg', 'opencode');
	readonly script = path.join(this.root, 'scenario.json');
	app!: ElectronApplication;
	page!: Page;
	private boot = 0;
	readonly real = process.env.MAESTRO_E2E_REAL === '1';
	realCli?: { executable: string; version: string };
	private credentials: Record<string, string> = {};
	private scenes: NativeScene[] = [];
	private sceneIndex = 0;
	externalCount = 0;
	readonly externalProcesses = new Map<ChildProcess, Promise<unknown>>();
	private provider?: Provider;
	readonly control = path.join(this.root, 'control.json');
	constructor(private info: TestInfo) {
		for (const dir of [
			this.data,
			this.project,
			this.claude,
			this.codex,
			this.opencode,
			this.grok,
			this.omp,
		])
			fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(this.data, 'maestro-settings.json'),
			JSON.stringify({
				uiLanguage: 'en',
				typographyPromptSeen: true,
				themePromptSeen: true,
				updatesPromptSeen: true,
				agentPowersPromptSeen: true,
				tourCompleted: true,
				automaticTabNamingEnabled: false,
				sidebarNavigationMode: 'conversations',
				// Provider resume scenarios exclude background synopsis (scenario h).
				// These providers have no verified non-persisting synopsis invocation.
				...(/^(opencode|grok|omp) /.test(info.title) ? { defaultSaveToHistory: false } : {}),
			})
		);
	}
	scriptTurns(turns: NativeScene[]) {
		this.scenes = turns;
		this.sceneIndex = 0;
		fs.writeFileSync(
			this.script,
			JSON.stringify({ turns, synopsis: { answer: 'A native acceptance turn completed.' } })
		);
	}
	get env() {
		return {
			...this.credentials,
			CLAUDE_CONFIG_DIR: this.claude,
			CLAUDE_SECURESTORAGE_CONFIG_DIR: this.claude,
			CODEX_HOME: this.codex,
			GROK_HOME: this.grok,
			PI_CODING_AGENT_DIR: this.omp,
			PI_CONFIG_DIR: path.relative(os.homedir(), path.dirname(this.omp)),
			OMP_PROFILE: '',
			PI_PROFILE: '',
			GROK_AUTH_PATH: path.join(this.grok, 'auth.json'),
			XDG_DATA_HOME: path.dirname(this.opencode),
			XDG_CONFIG_HOME: path.join(this.root, 'xdg-config'),
			XDG_CACHE_HOME: path.join(this.root, 'xdg-cache'),
			XDG_STATE_HOME: path.join(this.root, 'xdg-state'),
			OPENCODE_CONFIG_DIR: path.join(this.root, 'xdg-config', 'opencode'),
			OPENCODE_CONFIG: '',
			OPENCODE_CONFIG_CONTENT: '{}',
			MAESTRO_NATIVE_SCRIPT: this.script,
			MAESTRO_USER_DATA: this.data,
		};
	}
	providerHome(provider: Provider) {
		return {
			claude: this.claude,
			codex: this.codex,
			opencode: this.opencode,
			grok: this.grok,
			omp: this.omp,
		}[provider];
	}
	async start() {
		if (this.real && !this.realCli) {
			this.provider = this.info.title.split(' ')[0].replace(':', '') as Provider;
			this.realCli = installedCli(this.provider, process.env, /^codex [gh]:/.test(this.info.title));
			// Keep the synthetic OMP API key scoped to its own application. Claude's
			// smoke cases must still exercise the read-only OAuth snapshot path.
			const credentialEnv =
				this.provider === 'omp' && process.env.MAESTRO_E2E_SMOKE === '1'
					? { ...process.env, ANTHROPIC_API_KEY: 'synthetic-api-key' }
					: process.env;
			this.credentials = prepareCredentials(
				this.provider,
				this.providerHome(this.provider),
				credentialEnv
			);
			this.info.annotations.push({ type: 'native-cli-version', description: this.realCli.version });
		}
		this.app = await launchElectronApp(path.resolve('dist/main/index.js'), this.data, this.env);
		this.boot++;
		await this.app.context().tracing.start({ screenshots: true, snapshots: true });
		this.page = await this.app.firstWindow();
		await this.page.waitForLoadState('domcontentloaded');
		await expect(
			this.page.getByText('Create your first agent', { exact: true }).or(this.input())
		).toBeVisible();
	}
	async close(failed = false) {
		for (const child of this.externalProcesses.keys())
			if (child.pid && child.exitCode === null) process.kill(-child.pid, 'SIGTERM');
		await Promise.allSettled(this.externalProcesses.values());
		if (failed) {
			await this.page.screenshot({ path: this.info.outputPath(`failure-${this.boot}.png`) });
			await this.app
				.context()
				.tracing.stop({ path: this.info.outputPath(`trace-${this.boot}.zip`) });
		} else await this.app.context().tracing.stop();
		if (failed) {
			// Confirm through the existing quit path so Maestro ends its native
			// children. app.exit() bypasses that shutdown and leaves them running.
			const closed = this.app.waitForEvent('close');
			await this.page.evaluate(() => window.maestro.app.confirmQuit());
			await closed;
		} else await this.app.close();
	}
	async restart() {
		await this.close();
		await this.start();
	}
	async cli(...args: string[]) {
		const result = await exec(
			process.execPath,
			[path.resolve('dist/cli/maestro-cli.js'), ...args, '--json'],
			{ env: { ...process.env, ...this.env } }
		);
		return JSON.parse(result.stdout);
	}
	async createAgent(
		provider: Provider,
		options: { executable?: string; env?: Record<string, string> } = {}
	) {
		this.provider = provider;
		const executable =
			options.executable ??
			(this.real
				? path.resolve('e2e/fixtures/native/real-cli')
				: path.resolve(`e2e/fixtures/native/${provider}`));
		const realEnv = this.real
			? {
					MAESTRO_E2E_CLI: this.realCli!.executable,
					MAESTRO_E2E_CONTROL: this.control,
					MAESTRO_E2E_PROCESS: path.join(this.providerHome(provider), 'fixture-process'),
				}
			: {};
		const result = await this.cli(
			'create-agent',
			`Native ${provider}`,
			'--type',
			provider === 'claude' ? 'claude-code' : provider,
			'--cwd',
			this.project,
			'--custom-path',
			executable,
			'--env',
			`CLAUDE_CONFIG_DIR=${this.claude}`,
			'--env',
			`CODEX_HOME=${this.codex}`,
			'--env',
			`GROK_HOME=${this.grok}`,
			'--env',
			`PI_CODING_AGENT_DIR=${this.omp}`,
			'--env',
			`PI_CONFIG_DIR=${path.relative(os.homedir(), path.dirname(this.omp))}`,
			'--env',
			'OMP_PROFILE=',
			'--env',
			'PI_PROFILE=',
			'--env',
			`GROK_AUTH_PATH=${path.join(this.grok, 'auth.json')}`,
			'--env',
			`XDG_DATA_HOME=${path.dirname(this.opencode)}`,
			'--env',
			`MAESTRO_NATIVE_SCRIPT=${this.script}`,
			...Object.entries({ ...realEnv, ...options.env }).flatMap(([key, value]) => [
				'--env',
				`${key}=${value}`,
			])
		);
		expect(result.success).toBe(true);
		await expect(this.input()).toBeVisible();
		if (this.real) {
			if (provider === 'claude')
				await this.cli('update-agent', result.agentId, '--token-source', 'api');
			await this.cli('tab', 'save-to-history', 'active', 'false', '--agent', result.agentId);
		}
		return result.agentId as string;
	}
	input() {
		return this.page.getByPlaceholder(/^Talking to /);
	}
	outputFile(name: string) {
		return this.info.outputPath(name);
	}
	output() {
		return this.page.getByLabel('Terminal output', { exact: true });
	}
	async expandTools() {
		for (const button of await this.output()
			.getByTitle('Show what the agent did', { exact: true })
			.all())
			await button.click();
		for (const button of await this.output()
			.getByRole('button', { name: /^\d+ tool calls?/ })
			.all()) {
			if ((await button.getAttribute('aria-expanded')) === 'false') await button.click();
		}
		for (const button of (
			await this.output()
				.getByRole('button', { name: /^Show details for / })
				.all()
		).reverse())
			await button.click();
	}
	async send(prompt: string) {
		if (this.real) {
			const scene = this.scenes[this.sceneIndex++];
			if (!scene) throw new Error('No acceptance workload was defined for this send');
			fs.writeFileSync(this.control, JSON.stringify({ exitGate: scene.exitGate }));
			fs.writeFileSync(
				this.script,
				JSON.stringify({ scene, synopsis: { answer: 'A native acceptance turn completed.' } })
			);
			prompt = realPrompt(this, prompt, scene);
		}
		await this.input().fill(prompt);
		await this.input().press('Enter');
	}
	async externalTurn(provider: Provider, prompt: string, scene: NativeScene, id?: string) {
		if (this.real) return realExternalTurn(this, provider, prompt, scene, id);
		if (provider === 'grok' || provider === 'omp') {
			const createTurn = provider === 'grok' ? createGrokTurn : createOmpTurn;
			const turn = createTurn({
				configDir: this.providerHome(provider),
				cwd: this.project,
				id,
				prompt,
			});
			for (const tool of scene.tools ?? []) turn.startTool(tool);
			for (const tool of [...(scene.tools ?? [])].reverse()) turn.finishTool(tool);
			turn.finish(scene.answer);
			return turn;
		}
		if (provider === 'opencode') {
			const turn = createOpenCodeTurn({ configDir: this.opencode, cwd: this.project, id, prompt });
			for (const tool of scene.tools ?? []) turn.startTool(tool);
			for (const tool of [...(scene.tools ?? [])].reverse()) turn.finishTool(tool, tool.status);
			turn.finish(scene.answer);
			return turn;
		}
		return appendTurn(
			{
				provider,
				configDir: this.providerHome(provider),
				cwd: this.project,
				id,
				prompt,
			},
			scene
		);
	}
	async historyEntry(agentId: string, expected: string) {
		const panel = this.page.locator('[data-tour="history-panel"]');
		if (this.real && this.provider === 'claude') {
			await expect
				.poll(
					async () =>
						(
							await this.page.evaluate(
								({ project, agentId }) => window.maestro.history.getAll(project, agentId),
								{ project: this.project, agentId }
							)
						).length
				)
				.toBe(1);
			const [entry] = await this.page.evaluate(
				({ project, agentId }) => window.maestro.history.getAll(project, agentId),
				{ project: this.project, agentId }
			);
			expect(entry.summary.trim()).not.toBe('');
			expect(entry.summary).not.toMatch(/Synopsis failed/i);
			await expect(panel).toContainText(entry.summary);
		} else await expect(panel.getByText(expected, { exact: true }).first()).toBeVisible();
	}
	files(provider: Provider): string[] {
		if (provider === 'opencode') {
			const file = path.join(this.opencode, 'opencode.db');
			return fs.existsSync(file) ? [file] : [];
		}
		const dir = path.join(
			this.providerHome(provider),
			provider === 'claude' ? 'projects' : 'sessions'
		);
		if (!fs.existsSync(dir)) return [];
		return fs
			.readdirSync(dir, { recursive: true })
			.filter((name) =>
				provider === 'grok'
					? String(name).endsWith('chat_history.jsonl')
					: String(name).endsWith('.jsonl')
			)
			.map((name) => path.join(dir, String(name)))
			.sort();
	}
	async oneTranscript(provider: Provider) {
		await expect.poll(() => this.files(provider).length).toBe(1);
		return this.files(provider)[0];
	}
}

export const test = base.extend<{ native: NativeApp }>({
	native: async ({}, use, info) => {
		const native = new NativeApp(info);
		try {
			await native.start();
			await use(native);
		} finally {
			try {
				if (native.app) await native.close(info.status !== info.expectedStatus);
			} finally {
				fs.rmSync(native.root, { recursive: true, force: true });
			}
		}
	},
});
export { expect };
