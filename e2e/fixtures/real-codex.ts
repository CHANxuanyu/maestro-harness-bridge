import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, type TestInfo } from '@playwright/test';
import { NativeApp } from './native-app';
import { prepareCredentials, codexAcceptanceConfig } from './native/real-runtime.cjs';

/** API credentials or access-only login snapshots in isolated temporary accounts. */
export class RealCodexApp extends NativeApp {
	readonly executable: string;
	readonly model: string | undefined;
	readonly version: string;
	readonly childProvider: 'claude' | 'codex';
	private loginCredentials: Record<string, string> = {};

	constructor(info: TestInfo, appServer: boolean) {
		if (process.env.MAESTRO_E2E_REAL !== '1') throw new Error('Real run requires explicit opt-in');
		if (Object.keys(process.env).some((key) => key.startsWith('MAESTRO_CALLER_')))
			throw new Error('Unset inherited MAESTRO_CALLER_*; only the application may inject identity');
		const executable = process.env.MAESTRO_E2E_CODEX_PATH;
		const model = process.env.MAESTRO_E2E_CODEX_MODEL;
		if (!executable || !path.isAbsolute(executable))
			throw new Error('Set absolute MAESTRO_E2E_CODEX_PATH');
		const childProvider = appServer
			? 'claude'
			: (process.env.MAESTRO_E2E_CHILD_PROVIDER ?? 'claude');
		if (childProvider !== 'claude' && childProvider !== 'codex')
			throw new Error('Set MAESTRO_E2E_CHILD_PROVIDER to claude or codex');
		super(info, { providerCli: false });
		this.executable = executable;
		this.model = model;
		this.childProvider = childProvider;
		try {
			if (!process.env.CODEX_API_KEY) prepareCredentials('codex', this.codex);
			// Only a Claude child needs Claude credentials. Preserve the helper's
			// access-token environment in the child environment getter.
			if (!appServer && childProvider === 'claude' && !process.env.ANTHROPIC_API_KEY)
				this.loginCredentials = {
					CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '',
					...prepareCredentials('claude', this.claude),
				};
			const settings = path.join(this.data, 'maestro-settings.json');
			fs.writeFileSync(
				settings,
				JSON.stringify({
					...JSON.parse(fs.readFileSync(settings, 'utf8')),
					newShell: true,
					codexAppServer: appServer,
					uiLanguage: 'en',
					defaultSaveToHistory: false,
					crashReportingEnabled: false,
				})
			);
			fs.writeFileSync(
				path.join(this.codex, 'config.toml'),
				codexAcceptanceConfig(!!process.env.CODEX_API_KEY)
			);
			this.version = execFileSync(executable, ['--version'], {
				cwd: this.project,
				env: { ...process.env, ...this.env },
				encoding: 'utf8',
				timeout: 10_000,
			}).trim();
			info.annotations.push({ type: 'native-cli-version', description: this.version });
			expect(this.version).toMatch(/^codex-cli \S+/);
			if (process.env.MAESTRO_E2E_CODEX_EXPECT_VERSION)
				expect(this.version).toBe(process.env.MAESTRO_E2E_CODEX_EXPECT_VERSION);
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
			// Credentials remain in the child environment, never agent settings or argv.
			CODEX_API_KEY: process.env.CODEX_API_KEY ?? '',
			OPENAI_API_KEY: '',
			ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
			CLAUDE_CODE_OAUTH_TOKEN: '',
			...this.loginCredentials,
			CLAUDE_CODE_API_KEY: '',
			CLAUDE_CODE_USE_BEDROCK: '0',
			CLAUDE_CODE_USE_VERTEX: '0',
			ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
		};
	}

	async createChild() {
		return this.childProvider === 'codex' ? this.createCodex('Codex reader') : this.createClaude();
	}

	async createCodex(name = 'Real Codex') {
		const result = await this.cli(
			'create-agent',
			name,
			'--type',
			'codex',
			'--cwd',
			this.project,
			'--custom-path',
			this.executable,
			...(this.model ? ['--model', this.model] : []),
			'--env',
			`CODEX_HOME=${this.codex}`,
			'--env',
			`HOME=${this.syntheticHome}`
		);
		expect(result.success).toBe(true);
		return result.agentId as string;
	}

	async createClaude() {
		const executable = process.env.MAESTRO_E2E_CLAUDE_PATH;
		const model = process.env.MAESTRO_E2E_CLAUDE_MODEL;
		if (!executable || !path.isAbsolute(executable))
			throw new Error('Set absolute MAESTRO_E2E_CLAUDE_PATH');
		const result = await this.cli(
			'create-agent',
			'Claude reader',
			'--type',
			'claude-code',
			'--cwd',
			this.project,
			'--custom-path',
			executable,
			...(model ? ['--model', model] : []),
			'--env',
			`CLAUDE_CONFIG_DIR=${this.claude}`,
			'--env',
			`HOME=${this.syntheticHome}`
		);
		expect(result.success).toBe(true);
		return result.agentId as string;
	}
}

export type RealProcessProbe = {
	answers: Record<string, string[]>;
	exits: Array<{ id: string; code: number; interrupted?: boolean }>;
	tools: Array<{ id: string; name: string; state: unknown }>;
};

declare global {
	interface Window {
		__realCodexProbe: RealProcessProbe;
	}
}

export async function observeRealProcesses(native: NativeApp) {
	await native.page.evaluate(() => {
		const probe: RealProcessProbe = { answers: {}, exits: [], tools: [] };
		window.__realCodexProbe = probe;
		window.maestro.process.onData((id, text) => (probe.answers[id] ??= []).push(text));
		window.maestro.process.onExit((id, code, _signal, interrupted) =>
			probe.exits.push({ id, code, interrupted })
		);
		window.maestro.process.onToolExecution((id, event) =>
			probe.tools.push({ id, name: event.toolName, state: event.state })
		);
	});
}

// Observe the actual stdio messages at the existing controller boundary. No
// synthetic replies, normalization, retries or alternative protocol handling.
export type Wire = {
	direction: 'send' | 'receive';
	message: {
		id?: string | number;
		method?: string;
		params?: {
			threadId?: string;
			turnId?: string;
			expectedTurnId?: string;
			item?: { type?: string; command?: string; status?: string };
			turn?: { id?: string; status?: string };
		};
		result?: {
			turnId?: string;
			decision?: string;
			thread?: { id?: string; status?: { type?: string } };
		};
	};
};
type WireGlobal = typeof globalThis & { __realCodexWire: Wire[] };

export async function observeCodexWire(native: NativeApp) {
	await native.app.evaluate((_electron, modulePath) => {
		const root = globalThis as WireGlobal;
		root.__realCodexWire = [];
		// Electron evaluate has process but no module-scoped require. Use Node's
		// loader and cache so this is the same controller the application uses.
		const load = process.getBuiltinModule('module').createRequire(modulePath);
		const { CodexAppServerSession } = load(modulePath);
		const proto = CodexAppServerSession.prototype;
		const received = new WeakSet<object>();
		for (const [method, direction] of [
			['send', 'send'],
			['handleMessage', 'receive'],
		] as const) {
			const original = proto[method];
			proto[method] = function (message: Wire['message']) {
				// The controller revisits the same object when draining early events.
				// Record the wire delivery once, while preserving both handler calls.
				if (direction === 'send' || !received.has(message)) {
					root.__realCodexWire.push({ direction, message: JSON.parse(JSON.stringify(message)) });
					if (direction === 'receive') received.add(message);
				}
				return original.call(this, message);
			};
		}
	}, path.resolve('dist/main/process-manager/CodexAppServerSession.js'));
}

export async function readCodexWire(native: NativeApp): Promise<Wire[]> {
	return native.app.evaluate(() => (globalThis as WireGlobal).__realCodexWire);
}
