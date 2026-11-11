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
import { createCopilotTurn } from './native/copilot-protocol.cjs';
import { createOmpTurn } from './native/omp-protocol.cjs';
import { createGrokTurn } from './native/grok-protocol.cjs';
import { createOpenCodeTurn, openCodeSchemaReady } from './native/opencode-protocol.cjs';
import { createNativeTempDir } from './native/temp-root.cjs';

const exec = promisify(execFile);
export type Provider = 'claude' | 'codex' | 'opencode' | 'grok' | 'omp' | 'copilot';
export interface NativeTool {
	itemId?: string;
	name?: string;
	input?: Record<string, unknown>;
	id: string;
	command: string;
	output: string;
	status?: 'completed' | 'failed';
	updates?: string[];
	gates?: string[];
}
export interface NativeScene {
	codexExecEvents?: Record<string, unknown>[];
	writes?: Record<string, string>;
	answer: string;
	effort?: string;
	tools?: NativeTool[];
	waitForStop?: boolean;
	stopDiagnostic?: boolean;
	toolDelay?: number;
	exitGate?: string;
	approval?: boolean;
	authFailure?: boolean;
	quotaFailure?: boolean;
}

export class NativeApp {
	readonly root = createNativeTempDir('maestro-native-e2e-');
	readonly syntheticHome = path.join(this.root, 'synthetic-home');
	readonly data = path.join(this.root, 'maestro');
	readonly project = path.join(this.root, 'project');
	readonly claude = path.join(this.root, 'claude');
	readonly codex = path.join(this.root, 'codex');
	readonly copilot = path.join(this.root, 'copilot');
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
	private realProviders = new Map<
		Provider,
		{ executable: string; version: string; credentials: Record<string, string> }
	>();
	private scenes: NativeScene[] = [];
	private sceneIndex = 0;
	externalCount = 0;
	readonly externalProcesses = new Map<ChildProcess, Promise<unknown>>();
	private provider?: Provider;
	readonly control = path.join(this.root, 'control.json');
	constructor(
		private info: TestInfo,
		private options: { providerCli?: boolean; inheritCodexHome?: boolean } = {}
	) {
		for (const dir of [
			this.data,
			this.project,
			this.claude,
			this.codex,
			this.opencode,
			this.grok,
			this.omp,
			this.copilot,
			this.syntheticHome,
		])
			fs.mkdirSync(dir, { recursive: true });
		const productFile = path.resolve('dist/maestro-product.json');
		const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
		const product = fs.existsSync(productFile)
			? JSON.parse(fs.readFileSync(productFile, 'utf8'))
			: { productName: pkg.build.productName, productId: pkg.build.appId };
		fs.writeFileSync(path.join(this.data, 'maestro-product.json'), JSON.stringify(product));
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
				...(/^(opencode|grok|omp|copilot) /.test(info.title)
					? { defaultSaveToHistory: false }
					: {}),
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
			...(this.options.inheritCodexHome ? {} : { CODEX_HOME: this.codex }),
			COPILOT_HOME: this.copilot,
			COPILOT_AUTO_UPDATE: 'false',
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
			copilot: this.copilot,
		}[provider];
	}
	realCliFor(provider: Provider) {
		const cached = this.realProviders.get(provider);
		if (cached) return cached;
		const cli = installedCli(provider, process.env, /^codex [gh]:/.test(this.info.title));
		// Only this provider receives its synthetic smoke credential. Real runs
		// retain the existing read-only credential snapshot into temporary dirs.
		const credentialEnv =
			provider === 'omp' && process.env.MAESTRO_E2E_SMOKE === '1'
				? { ...process.env, ANTHROPIC_API_KEY: 'synthetic-api-key' }
				: provider === 'copilot' && process.env.MAESTRO_E2E_SMOKE === '1'
					? { ...process.env, COPILOT_GITHUB_TOKEN: 'synthetic-api-key' }
					: process.env;
		const credentials = prepareCredentials(provider, this.providerHome(provider), credentialEnv);
		const result = { ...cli, credentials };
		this.realProviders.set(provider, result);
		this.credentials = { ...this.credentials, ...credentials };
		this.info.annotations.push({ type: 'native-cli-version', description: cli.version });
		return result;
	}
	async start(homeDir?: string) {
		if (this.real && this.options.providerCli !== false && !this.realCli) {
			this.provider = this.info.title.split(' ')[0].replace(':', '') as Provider;
			this.realCli = this.realCliFor(this.provider);
		}
		// A history-boundary case needs a synthetic default account as well as the selected one.
		// Scope HOME to this child process so the test never seeds the user's default directory.
		// Synthetic runs never see the real home: a provider's store there, such as an
		// OpenCode database from the desktop app, would be read instead of the fixture's.
		const home = homeDir ?? (this.real ? undefined : this.syntheticHome);
		this.app = await launchElectronApp(path.resolve('dist/main/index.js'), this.data, {
			...this.env,
			...(home ? { HOME: home } : {}),
		});
		this.boot++;
		await this.app.context().tracing.start({ screenshots: true, snapshots: true });
		this.page = await this.app.firstWindow();
		await this.page.waitForLoadState('domcontentloaded');
		await expect(
			this.page
				.getByText('Create your first agent', { exact: true })
				.or(this.page.getByRole('button', { name: 'Open project folder', exact: true }))
				.or(this.input())
		).toBeVisible();
	}
	async close(failed = false) {
		for (const child of this.externalProcesses.keys())
			if (child.pid && child.exitCode === null) process.kill(-child.pid, 'SIGTERM');
		await Promise.allSettled(this.externalProcesses.values());
		// The final answer can precede native writer shutdown. A normal close
		// must not open a busy-agent confirmation that the test cannot answer.
		if (!failed) await expect(this.page.getByTestId('stop-turn-button')).toHaveCount(0);
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
	async restart(homeDir?: string) {
		await this.close();
		await this.start(homeDir);
	}
	async cli(...args: string[]) {
		return this.cliWithEnv({}, ...args);
	}
	async cliWithEnv(env: Record<string, string>, ...args: string[]) {
		return this.runCli(env, [...args, '--json']);
	}
	/** `dispatch` always prints JSON and has no `--json` flag. */
	async dispatchWithEnv(env: Record<string, string>, ...args: string[]) {
		return this.runCli(env, ['dispatch', ...args]);
	}
	private async runCli(env: Record<string, string>, args: string[]) {
		const result = await exec(
			process.execPath,
			[path.resolve('dist/cli/maestro-cli.js'), ...args],
			{
				env: { ...process.env, ...this.env, ...env },
			}
		).catch((error: Error & { stdout?: string; stderr?: string }) => {
			throw new Error(
				`${error.message}\nstdout:\n${error.stdout ?? ''}\nstderr:\n${error.stderr ?? ''}`,
				{ cause: error }
			);
		});
		return JSON.parse(result.stdout);
	}
	async createAgent(
		provider: Provider,
		options: { executable?: string; env?: Record<string, string>; preset?: 'deepseek' } = {}
	) {
		this.provider = provider;
		const executable =
			options.executable ??
			(this.real
				? path.resolve('e2e/fixtures/native/real-cli')
				: path.resolve(`e2e/fixtures/native/${provider}`));
		const providerCli = this.real ? this.realCliFor(provider) : undefined;
		const realEnv = providerCli
			? {
					...(options.preset ? {} : providerCli.credentials),
					MAESTRO_E2E_CLI: providerCli.executable,
					MAESTRO_E2E_CONTROL: this.control,
					MAESTRO_E2E_PROCESS: path.join(this.providerHome(provider), 'fixture-process'),
				}
			: {};
		const presetKey =
			this.real && process.env.MAESTRO_E2E_SMOKE !== '1'
				? process.env.DEEPSEEK_API_KEY
				: 'synthetic-deepseek-key';
		if (options.preset && !presetKey)
			throw new Error('DeepSeek acceptance requires DEEPSEEK_API_KEY');
		const result = await this.cliWithEnv(
			options.preset ? { DEEPSEEK_E2E_KEY: presetKey! } : {},
			'create-agent',
			`Native ${options.preset ?? provider}`,
			'--type',
			provider === 'claude' ? 'claude-code' : provider === 'copilot' ? 'copilot-cli' : provider,
			'--cwd',
			this.project,
			'--custom-path',
			executable,
			...(options.preset
				? ['--preset', options.preset, '--api-key-env', 'DEEPSEEK_E2E_KEY']
				: ['--env', `CLAUDE_CONFIG_DIR=${this.claude}`]),
			'--env',
			`CODEX_HOME=${this.codex}`,
			'--env',
			`COPILOT_HOME=${this.copilot}`,
			'--env',
			'COPILOT_AUTO_UPDATE=false',
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
		return this.page.getByPlaceholder(/^(Talking to |Message )/);
	}
	/**
	 * Open the Right Bar (files, history, Auto Run) the way a user does: it
	 * starts collapsed, and the header's "Show right panel" button is the
	 * visible way in. Collapsed, the bar's own toggle sits off screen.
	 */
	async openRightBar() {
		const show = this.page.getByTitle(/^Show right panel/);
		if (await show.count()) await show.click();
		await expect(this.page.locator('[data-tour="history-tab"]')).toBeVisible();
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
	async send(prompt: string, options: { expectRefusal?: string | RegExp } = {}) {
		if (options.expectRefusal && this.real && !this.provider)
			throw new Error('A refused real send requires a selected provider');
		const invocation =
			options.expectRefusal && this.real
				? path.join(this.providerHome(this.provider!), 'fixture-process')
				: undefined;
		const before =
			invocation && fs.existsSync(invocation) ? fs.readFileSync(invocation, 'utf8') : undefined;
		if (this.real && !options.expectRefusal) {
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
		if (options.expectRefusal) {
			await expect(this.output().getByText(options.expectRefusal)).toBeVisible();
			if (invocation)
				expect(fs.existsSync(invocation) ? fs.readFileSync(invocation, 'utf8') : undefined).toEqual(
					before
				);
		}
	}
	async externalTurn(provider: Provider, prompt: string, scene: NativeScene, id?: string) {
		if (this.real) return realExternalTurn(this, provider, prompt, scene, id);
		if (provider === 'copilot') {
			const turn = createCopilotTurn({ configDir: this.copilot, cwd: this.project, id, prompt });
			for (const tool of scene.tools ?? []) turn.startTool(tool);
			for (const tool of [...(scene.tools ?? [])].reverse()) turn.finishTool(tool);
			turn.finish(scene.answer);
			return turn;
		}
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
			// The panel renders the summary as markdown, so compare its plain text.
			await expect(panel).toContainText(entry.summary.replace(/[`*]/g, ''));
		} else await expect(panel.getByText(expected, { exact: true }).first()).toBeVisible();
	}
	files(provider: Provider, configDir = this.providerHome(provider)): string[] {
		if (provider === 'opencode') {
			const file = path.join(this.opencode, 'opencode.db');
			return fs.existsSync(file) ? [file] : [];
		}
		const dir = path.join(
			configDir,
			provider === 'claude' ? 'projects' : provider === 'copilot' ? 'session-state' : 'sessions'
		);
		if (!fs.existsSync(dir)) return [];
		return fs
			.readdirSync(dir, { recursive: true })
			.filter((name) =>
				provider === 'copilot'
					? String(name).endsWith('events.jsonl')
					: provider === 'grok'
						? String(name).endsWith('chat_history.jsonl')
						: String(name).endsWith('.jsonl')
			)
			.map((name) => path.join(dir, String(name)))
			.sort();
	}
	async oneTranscript(provider: Provider, configDir = this.providerHome(provider)) {
		await expect.poll(() => this.files(provider, configDir).length).toBe(1);
		const file = this.files(provider, configDir)[0];
		if (provider === 'opencode') await expect.poll(() => openCodeSchemaReady(file)).toBe(true);
		return file;
	}
}

export const test = base.extend<{ native: NativeApp; nativeProviderCli: boolean }>({
	nativeProviderCli: [true, { option: true }],
	native: async ({ nativeProviderCli }, use, info) => {
		const native = new NativeApp(info, { providerCli: nativeProviderCli });
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
