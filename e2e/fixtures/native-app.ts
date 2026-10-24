import {
	test as base,
	expect,
	type ElectronApplication,
	type Page,
	type TestInfo,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchElectronApp } from './electron-app';

const exec = promisify(execFile);
export type Provider = 'claude' | 'codex';
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
}

export class NativeApp {
	readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-native-e2e-'));
	readonly data = path.join(this.root, 'maestro');
	readonly project = path.join(this.root, 'project');
	readonly claude = path.join(this.root, 'claude');
	readonly codex = path.join(this.root, 'codex');
	readonly script = path.join(this.root, 'scenario.json');
	app!: ElectronApplication;
	page!: Page;
	private boot = 0;
	constructor(private info: TestInfo) {
		for (const dir of [this.data, this.project, this.claude, this.codex]) fs.mkdirSync(dir);
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
			})
		);
	}
	scriptTurns(turns: NativeScene[]) {
		fs.writeFileSync(
			this.script,
			JSON.stringify({ turns, synopsis: { answer: 'A native acceptance turn completed.' } })
		);
	}
	get env() {
		return {
			CLAUDE_CONFIG_DIR: this.claude,
			CODEX_HOME: this.codex,
			MAESTRO_NATIVE_SCRIPT: this.script,
			MAESTRO_USER_DATA: this.data,
		};
	}
	async start() {
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
	async createAgent(provider: Provider) {
		const result = await this.cli(
			'create-agent',
			`Native ${provider}`,
			'--type',
			provider === 'claude' ? 'claude-code' : 'codex',
			'--cwd',
			this.project,
			'--custom-path',
			path.resolve(`e2e/fixtures/native/${provider}`),
			'--env',
			`CLAUDE_CONFIG_DIR=${this.claude}`,
			'--env',
			`CODEX_HOME=${this.codex}`,
			'--env',
			`MAESTRO_NATIVE_SCRIPT=${this.script}`
		);
		expect(result.success).toBe(true);
		await expect(this.input()).toBeVisible();
		return result.agentId as string;
	}
	input() {
		return this.page.getByPlaceholder(/^Talking to /);
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
		await this.input().fill(prompt);
		await this.input().press('Enter');
	}
	files(provider: Provider): string[] {
		const dir = path.join(
			provider === 'claude' ? this.claude : this.codex,
			provider === 'claude' ? 'projects' : 'sessions'
		);
		if (!fs.existsSync(dir)) return [];
		return fs
			.readdirSync(dir, { recursive: true })
			.filter((name) => String(name).endsWith('.jsonl'))
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
