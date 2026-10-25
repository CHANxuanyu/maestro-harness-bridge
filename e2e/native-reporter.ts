import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

export default class NativeReporter implements Reporter {
	private results: {
		provider: string;
		scenario: string;
		status: string;
		cliVersion: string | null;
	}[] = [];
	constructor(private options: { output?: string } = {}) {}
	onTestEnd(test: TestCase, result: TestResult) {
		const match = /^(claude|codex|opencode|grok|omp|copilot)(?: ([a-j]))?:/.exec(test.title);
		if (!match) return;
		// No title, prompt, errors, stdout, session IDs, account paths or captures
		// enter the shareable summary. Diagnostics remain in local Playwright files.
		this.results.push({
			provider: match[1],
			scenario: match[2] ?? 'cleanup',
			status: result.status,
			cliVersion:
				test.annotations.find((annotation) => annotation.type === 'native-cli-version')
					?.description ?? null,
		});
	}
	onEnd(result: FullResult) {
		const output = this.options.output ?? 'e2e-results/native-summary.json';
		fs.mkdirSync(path.dirname(output), { recursive: true });
		fs.writeFileSync(
			output,
			JSON.stringify(
				{
					mode: 'real-cli',
					syntheticCredentials: process.env.MAESTRO_E2E_SMOKE === '1',
					platform: process.platform,
					applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
						encoding: 'utf8',
					}).trim(),
					sourceDirty:
						execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
					status: result.status,
					scenarios: this.results,
					shared: process.env.MAESTRO_E2E_SHARED_PATH
						? 'selected'
						: 'unverified: no explicit connector path',
				},
				null,
				2
			) + '\n'
		);
	}
}
