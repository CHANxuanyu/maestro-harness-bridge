import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, type TestInfo } from '@playwright/test';
import { NativeApp } from './native-app';
import { observeRealProcesses } from './real-codex';
import {
	acceptanceEnabled,
	prepareAcceptanceProviders,
	codexAcceptanceConfig,
} from './native/real-runtime.cjs';
import { DEEPSEEK_PRESET } from '../../src/shared/agentPresets';
import { readCodexRolloutSync } from '../../src/shared/codexRollout';

export { acceptanceEnabled };
export type AcceptanceProvider = 'claude' | 'codex' | 'deepseek';
export type AcceptanceConversation = {
	owner: string;
	tab: string;
	process: string;
	provider: AcceptanceProvider;
	home: string;
};

/** Task P only: opt-in before construction, bounded turns, isolated accounts and allowlisted evidence. */
export class RealAcceptanceApp extends NativeApp {
	private acceptanceCredentials: Record<string, string> = {};
	readonly tools: Record<string, { executable: string; version: string; model?: string }>;
	readonly evidence: Record<string, unknown> = { assertions: [] };
	readonly records = new Map<string, string>();
	private observing = false;

	constructor(
		private acceptanceInfo: TestInfo,
		scenario: string,
		providers: AcceptanceProvider[]
	) {
		if (!acceptanceEnabled(scenario))
			throw new Error('Real acceptance requires explicit local opt-in');
		if (Object.keys(process.env).some((key) => key.startsWith('MAESTRO_CALLER_')))
			throw new Error('Unset inherited MAESTRO_CALLER_*; only the application may inject identity');
		super(acceptanceInfo, { providerCli: false });
		try {
			const prepared = prepareAcceptanceProviders(providers, {
				claude: this.claude,
				codex: this.codex,
				home: this.syntheticHome,
			});
			this.acceptanceCredentials = prepared.credentials;
			this.tools = prepared.tools;
			const settings = path.join(this.data, 'maestro-settings.json');
			fs.writeFileSync(
				settings,
				JSON.stringify({
					...JSON.parse(fs.readFileSync(settings, 'utf8')),
					newShell: true,
					uiLanguage: 'en',
					codexAppServer: false,
					defaultSaveToHistory: false,
					crashReportingEnabled: false,
					autoResumeOnLimit: false,
				})
			);
			fs.writeFileSync(path.join(this.codex, 'config.toml'), codexAcceptanceConfig());
			// Discovery must inspect the pinned binary, using only isolated account dirs.
			fs.writeFileSync(
				path.join(this.data, 'maestro-agent-configs.json'),
				JSON.stringify({
					configs: Object.fromEntries(
						Object.entries(this.tools).map(([provider, tool]) => [
							provider === 'codex' ? 'codex' : 'claude-code',
							{
								customPath: tool.executable,
								customEnvVars: {
									CLAUDE_CONFIG_DIR: this.claude,
									CODEX_HOME: this.codex,
									HOME: this.syntheticHome,
								},
							},
						])
					),
				})
			);
			this.evidence.tools = Object.fromEntries(
				Object.entries(this.tools).map(([provider, tool]) => [
					provider,
					{
						version: tool.version,
						model: provider === 'deepseek' ? DEEPSEEK_PRESET.defaultModel : tool.model,
					},
				])
			);
			for (const tool of Object.values(this.tools))
				acceptanceInfo.annotations.push({ type: 'native-cli-version', description: tool.version });
		} catch (error) {
			fs.rmSync(this.root, { recursive: true, force: true });
			throw error;
		}
	}

	override get env() {
		return {
			...super.env,
			HOME: this.syntheticHome,
			USERPROFILE: this.syntheticHome,
			CODEX_API_KEY: '',
			OPENAI_API_KEY: '',
			ANTHROPIC_API_KEY: '',
			ANTHROPIC_AUTH_TOKEN: '',
			CLAUDE_CODE_OAUTH_TOKEN: '',
			CLAUDE_CODE_API_KEY: '',
			CLAUDE_CODE_USE_BEDROCK: '0',
			CLAUDE_CODE_USE_VERTEX: '0',
			CLAUDE_CODE_USE_FOUNDRY: '0',
			ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
			MAESTRO_E2E_DEEPSEEK_KEY: '',
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
			CLAUDE_CODE_ENABLE_TASKS: 'false',
			...this.acceptanceCredentials,
		};
	}

	override async start() {
		await super.start(this.syntheticHome);
		await observeRealProcesses(this);
		this.observing = true;
	}

	git(...args: string[]) {
		return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
			cwd: this.project,
			encoding: 'utf8',
			env: {
				...process.env,
				...this.env,
				GIT_CONFIG_NOSYSTEM: '1',
				GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
			},
		});
	}

	initRepo(files: Record<string, string>) {
		this.git('init', '-b', 'main');
		this.git('config', 'user.name', 'Acceptance');
		this.git('config', 'user.email', 'acceptance@example.invalid');
		this.git('config', 'commit.gpgsign', 'false');
		for (const [name, contents] of Object.entries(files))
			fs.writeFileSync(path.join(this.project, name), contents);
		this.git('add', '.');
		this.git('commit', '-m', 'Acceptance baseline');
	}

	async create(provider: AcceptanceProvider, maxInvocations: number, deepseekProxy?: string) {
		const tool = this.tools[provider];
		expect(tool).toBeDefined();
		const record = path.join(this.root, `${provider}-${this.records.size}-requests.jsonl`);
		const control = `${record}.control`;
		fs.writeFileSync(
			control,
			JSON.stringify({ record, maxInvocations, deepseekProxy, recordCaller: true })
		);
		const result = await this.cliWithEnv(
			provider === 'deepseek'
				? {
						MAESTRO_E2E_DEEPSEEK_KEY: process.env.MAESTRO_E2E_DEEPSEEK_KEY!,
					}
				: {},
			'create-agent',
			`Acceptance ${provider}`,
			'--type',
			provider === 'codex' ? 'codex' : 'claude-code',
			'--cwd',
			this.project,
			'--custom-path',
			path.resolve('e2e/fixtures/native/real-cli'),
			...(provider === 'deepseek'
				? ['--preset', 'deepseek', '--api-key-env', 'MAESTRO_E2E_DEEPSEEK_KEY']
				: ['--model', tool.model!, '--env', `CLAUDE_CONFIG_DIR=${this.claude}`]),
			...(provider === 'codex' ? [] : ['--custom-args', '--max-turns 8']),
			'--env',
			`CODEX_HOME=${this.codex}`,
			'--env',
			`HOME=${this.syntheticHome}`,
			'--env',
			`MAESTRO_E2E_CLI=${tool.executable}`,
			'--env',
			`MAESTRO_E2E_CONTROL=${control}`,
			'--env',
			`MAESTRO_E2E_PROCESS=${record}.pid`
		);
		expect(result.success).toBe(true);
		this.records.set(result.agentId, record);
		if (provider !== 'codex')
			expect(
				(await this.cli('update-agent', result.agentId, '--token-source', 'api')).success
			).toBe(true);
		// Fixture setup only, before any turns: disable resilience on the actual runner.
		await this.page.evaluate(async (id) => {
			const runner = (await window.maestro.sessions.getAll()).find(
				(session: { id: string }) => session.id === id
			);
			await window.maestro.sessions.setMany(
				[{ ...runner, retryOnAvailabilityErrors: false, retryOnTokenExhaustion: false }],
				[]
			);
		}, result.agentId);
		await this.page.reload();
		await expect(this.input()).toBeVisible();
		expect(
			await this.page.evaluate(async (id) => {
				const runner = (await window.maestro.sessions.getAll()).find(
					(session: { id: string }) => session.id === id
				);
				return [runner.retryOnAvailabilityErrors, runner.retryOnTokenExhaustion];
			}, result.agentId)
		).toEqual([false, false]);
		await observeRealProcesses(this);
		return this.conversation(result.agentId, provider);
	}

	async conversation(
		owner: string,
		provider: AcceptanceProvider,
		tab = 'active'
	): Promise<AcceptanceConversation> {
		await expect
			.poll(() =>
				this.cli('tab', 'show', tab, '--agent', owner)
					.then((result) => result.success === true)
					.catch(() => false)
			)
			.toBe(true);
		const shown = await this.cli('tab', 'show', tab, '--agent', owner);
		expect(shown.success).toBe(true);
		const home =
			provider === 'deepseek'
				? await this.page.evaluate(async (id) => {
						const runner = (await window.maestro.sessions.getAll()).find(
							(session: { id: string }) => session.id === id
						);
						return runner.customEnvVars.CLAUDE_CONFIG_DIR as string;
					}, owner)
				: this.providerHome(provider);
		expect(path.relative(this.root, home)).not.toMatch(/^\.\./);
		return {
			owner,
			tab: shown.tab.tabId,
			process: `${owner}-ai-${shown.tab.tabId}`,
			provider,
			home,
		};
	}

	async select(ref: AcceptanceConversation) {
		expect((await this.cli('tab', 'select', ref.tab, '--agent', ref.owner)).success).toBe(true);
	}

	row(ref: AcceptanceConversation) {
		return this.page.locator(`[data-conversation-key="${ref.owner}:${ref.tab}"]`);
	}

	async answer(ref: AcceptanceConversation) {
		return this.page.evaluate(
			(id) => window.__realCodexProbe.answers[id]?.join('') ?? '',
			ref.process
		);
	}

	async settled(ref: AcceptanceConversation, count = 1, successful = true) {
		await expect
			.poll(
				() =>
					this.page.evaluate(
						(id) => window.__realCodexProbe.exits.filter((event) => event.id === id),
						ref.process
					),
				{ timeout: 180_000 }
			)
			.toHaveLength(count);
		const exits = await this.page.evaluate(
			(id) => window.__realCodexProbe.exits.filter((event) => event.id === id),
			ref.process
		);
		const turns = (this.evidence.turns ??= {}) as Record<string, unknown>;
		turns[ref.process] = { exits, answer: await this.answer(ref) };
		if (successful) expect(exits.map((event) => event.code)).toEqual(Array(count).fill(0));
		await expect
			.poll(() =>
				this.page.evaluate(
					async (id) =>
						(await window.maestro.process.getActiveProcesses()).filter(
							(process) => process.sessionId === id
						),
					ref.process
				)
			)
			.toEqual([]);
	}

	async sendTurn(ref: AcceptanceConversation, prompt: string, count = 1) {
		await this.select(ref);
		await this.input().fill(prompt);
		await this.input().press('Enter');
		await this.settled(ref, count);
	}

	invocations(
		owner: string
	): Array<{ args: string[]; cwd: string; caller?: { agentId: string; tabId: string } }> {
		const file = this.records.get(owner)!;
		return fs.existsSync(file)
			? fs
					.readFileSync(file, 'utf8')
					.trim()
					.split('\n')
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			: [];
	}

	async transcript(ref: AcceptanceConversation) {
		await expect
			.poll(
				async () =>
					(await this.cli('tab', 'show', ref.tab, '--agent', ref.owner)).tab.agentSessionId
			)
			.toBeTruthy();
		const id = (await this.cli('tab', 'show', ref.tab, '--agent', ref.owner)).tab
			.agentSessionId as string;
		const files = () =>
			this.files(ref.provider === 'codex' ? 'codex' : 'claude', ref.home).filter((file) =>
				path.basename(file).includes(id)
			);
		await expect.poll(files).toHaveLength(1);
		const file = files()[0];
		expect(path.relative(fs.realpathSync(this.root), fs.realpathSync(file))).not.toMatch(/^\.\./);
		const rows = (
			ref.provider === 'codex' ? readCodexRolloutSync(file) : fs.readFileSync(file, 'utf8')
		)
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(rows.length).toBeGreaterThan(0);
		const transcripts = (this.evidence.transcripts ??= []) as unknown[];
		transcripts.push({
			provider: ref.provider,
			tab: ref.tab,
			nativeId: id,
			file,
			rows: rows.length,
			models: [
				...new Set(
					rows
						.map(
							(row) =>
								row.message?.model ?? (row.type === 'turn_context' ? row.payload?.model : undefined)
						)
						.filter(Boolean)
				),
			],
		});
		return { file, rows };
	}

	checked(assertion: string) {
		(this.evidence.assertions as string[]).push(assertion);
	}

	async finish(completed: boolean) {
		try {
			this.evidence.completed = completed;
			this.evidence.invocations = Object.fromEntries(
				[...this.records.keys()].map((owner) => [owner, this.invocations(owner)])
			);
			if (this.observing)
				this.evidence.processes = await this.page.evaluate(() => window.__realCodexProbe);
			await this.acceptanceInfo.attach('real-acceptance.json', {
				body: JSON.stringify(this.evidence, null, 2),
				contentType: 'application/json',
			});
		} finally {
			try {
				if (this.app) await this.close(!completed);
			} finally {
				fs.rmSync(this.root, { recursive: true, force: true });
			}
		}
	}
}
