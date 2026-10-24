import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { NativeApp, type Provider } from './fixtures/native-app';

function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
		throw error;
	}
}

for (const provider of ['claude', 'codex'] satisfies Provider[]) {
	test(`${provider}: failure cleanup ends the native process and captures diagnostics`, async ({}, info) => {
		const native = new NativeApp(info);
		let pid: number | undefined;
		let appRunning = false;
		let passed = false;
		try {
			await native.start();
			appRunning = true;
			native.app.on('close', () => {
				appRunning = false;
			});
			native.scriptTurns([
				{
					answer: '',
					tools: [{ id: 'cleanup-tool', command: 'sleep 60', output: '' }],
					waitForStop: true,
				},
			]);
			await native.createAgent(provider);
			await native.send('Run until the application exits');
			await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
			pid = Number(
				fs.readFileSync(
					path.join(provider === 'claude' ? native.claude : native.codex, 'fixture-process'),
					'utf8'
				)
			);
			await native.close(true);
			await expect.poll(() => alive(pid!)).toBe(false);
			expect(fs.statSync(info.outputPath('failure-1.png')).size).toBeGreaterThan(0);
			expect(fs.statSync(info.outputPath('trace-1.zip')).size).toBeGreaterThan(0);
			passed = true;
		} finally {
			// Reap only this fixture's child if the regression deliberately broke
			// application shutdown. Never leave a negative control running.
			if (pid && alive(pid)) process.kill(pid, 'SIGTERM');
			if (appRunning) await native.close(true);
			fs.rmSync(native.root, { recursive: true, force: true });
			if (passed) fs.rmSync(info.outputDir, { recursive: true, force: true });
		}
	});
}
