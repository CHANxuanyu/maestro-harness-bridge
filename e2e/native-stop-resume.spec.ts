import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import type { Session } from '../src/renderer/types';
import { appendReadOnlyPrompt } from '../src/shared/readOnlyPrompt';
import { transcriptMessagesToLogEntries } from '../src/renderer/utils/transcriptMessages';

// This regression must never discover credentials or invoke a real provider.
for (const provider of ['claude', 'codex'] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`${provider} read-only Stop, normal restart and continuation`, async ({}, info) => {
		if (process.env.MAESTRO_E2E_REAL === '1') {
			throw new Error('This regression requires synthetic providers. Unset MAESTRO_E2E_REAL.');
		}
		const native = new NativeApp(info, { providerCli: false });
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home, { recursive: true });
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				newShell: true,
				defaultSaveToHistory: true,
				synopsisDebounceSeconds: 0,
				crashReportingEnabled: false,
			})
		);
		native.scriptTurns([
			{
				answer: '',
				tools: [{ id: 'stopped-wait', command: 'sleep 30', output: '' }],
				waitForStop: true,
				stopDiagnostic: true,
			},
			{ answer: 'Continued in the same conversation.' },
		]);
		const prompt = 'Wait 30 seconds, then reply WAIT_DONE. Do not read or change files.';
		const internalText = 'IMPORTANT: You are in read-only/plan mode.';
		const saved = (): Session[] =>
			JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')).sessions;
		const noSynopsisFailure = async () => {
			// The logger retains toasts after they disappear from the screen.
			const logs = await native.page.evaluate(() =>
				window.maestro.logger.getLogs({ context: 'Toast' })
			);
			expect(JSON.stringify(logs)).not.toMatch(
				/Synopsis failed|No final answer is available|摘要生成失败/
			);
		};
		let failed = false;
		let closed = false;
		try {
			await native.start(home);
			const agentId = await native.createAgent(provider);
			await native.cli('tab', 'permission', 'active', 'readonly', '--agent', agentId);
			await native.cli('tab', 'save-to-history', 'active', 'true', '--agent', agentId);
			const tabId = saved().find((session) => session.id === agentId)!.activeTabId;
			await native.send(prompt);
			await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
			await native.page.getByTestId('stop-turn-button').click();
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			await expect(native.output().getByText(prompt, { exact: true })).toHaveCount(1);
			await expect(native.output()).not.toContainText(internalText);
			await expect
				.poll(() =>
					native.page.evaluate(
						async (id) =>
							(await window.maestro.process.getActiveProcesses()).filter((process) =>
								process.sessionId.startsWith(`${id}-ai-`)
							),
						agentId
					)
				)
				.toEqual([]);
			await noSynopsisFailure();
			const file = await native.oneTranscript(provider);
			const stoppedBytes = fs.readFileSync(file);
			// The native history keeps its wire suffix. Only display decoding changes.
			expect(stoppedBytes.toString()).toContain(internalText);
			await native.restart(home);
			await native.page
				.locator(`[data-conversation-key="${agentId}:${tabId}"] [data-tree-nav]`)
				.click();
			await expect(native.output().getByText(prompt, { exact: true })).toHaveCount(1);
			await expect(native.output()).not.toContainText(internalText);
			expect(fs.readFileSync(file)).toEqual(stoppedBytes);
			await native.send('Continue after the stopped turn.');
			await expect(
				native.output().getByText('Continued in the same conversation.', { exact: true })
			).toBeVisible();
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			await expect(native.output().getByText(prompt, { exact: true })).toHaveCount(1);
			await expect(native.output()).not.toContainText(internalText);
			await noSynopsisFailure();
			expect(native.files(provider)).toEqual([file]);
			expect(fs.readFileSync(file).subarray(0, stoppedBytes.length)).toEqual(stoppedBytes);
			await native.close();
			closed = true;
			const logs = saved()
				.find((session) => session.id === agentId)!
				.aiTabs.find((tab) => tab.id === tabId)!.logs;
			expect(
				logs.filter((entry) => entry.source === 'user' && entry.text.startsWith(prompt))
			).toHaveLength(1);
			expect(
				logs
					.filter((entry) => entry.source === 'user')
					.some((entry) => entry.text.includes(internalText))
			).toBe(false);
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (failed && !closed && native.app) await native.close(true);
		}
	});

	// eslint-disable-next-line no-empty-pattern
	test(`${provider} repairs an old mentioned turn beyond the tail window and keeps a real repeat`, async ({}, info) => {
		if (process.env.MAESTRO_E2E_REAL === '1') {
			throw new Error('This regression requires synthetic providers. Unset MAESTRO_E2E_REAL.');
		}
		const native = new NativeApp(info, { providerCli: false });
		native.scriptTurns([]);
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home, { recursive: true });
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				newShell: true,
				defaultSaveToHistory: false,
				crashReportingEnabled: false,
			})
		);
		const prompt = 'Wait for @Reviewer in parallel, then report the result.';
		const wire =
			appendReadOnlyPrompt(prompt) +
			'\n\n---\n\n' +
			fs
				.readFileSync(path.resolve('src/prompts/cross-agent-consult-pending.md'), 'utf8')
				.split('{{CONSULTED_AGENTS}}')
				.join('Reviewer');
		const seed = await native.externalTurn(provider, wire, { answer: '' });
		await native.externalTurn(provider, prompt, { answer: 'The genuine repeat stays.' }, seed.id);
		for (let index = 0; index < 325; index++) {
			await native.externalTurn(
				provider,
				`Later question ${index}`,
				{ answer: `Later answer ${index}` },
				seed.id
			);
		}
		const bytes = fs.readFileSync(seed.file);
		const sessionsFile = path.join(native.data, 'maestro-sessions.json');
		const saved = (): { sessions: Session[] } => JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
		let failed = false;
		let closed = true;
		try {
			await native.start(home);
			closed = false;
			const agentId = await native.createAgent(provider);
			const result = await native.page.evaluate(
				async ({ tool, cwd, id, ownerAgentId }) =>
					window.maestro.agentSessions.read(tool, cwd, id, {
						limit: 2000,
						offset: 0,
						readOnly: true,
						ownerAgentId,
					}),
				{
					tool: provider === 'claude' ? 'claude-code' : 'codex',
					cwd: native.project,
					id: seed.id,
					ownerAgentId: agentId,
				}
			);
			expect(result.messages.length).toBeGreaterThan(500);
			await native.close();
			closed = true;
			// Seed only the temporary Maestro cache as an older build left it.
			// The fixture's native file is never rewritten during repair.
			const state = saved();
			const session = state.sessions.find((item) => item.id === agentId)!;
			const tab = session.aiTabs.find((item) => item.id === session.activeTabId)!;
			const canonical = transcriptMessagesToLogEntries(result.messages);
			const first = canonical.find((entry) => entry.source === 'user')!;
			const own = {
				id: 'cached-local-send',
				source: 'user' as const,
				timestamp: first.timestamp - 200,
				text: prompt,
				readOnly: true,
			};
			tab.agentSessionId = seed.id;
			tab.logs = [
				own,
				...canonical.map((entry) => (entry.id === first.id ? { ...entry, text: wire } : entry)),
			];
			fs.writeFileSync(sessionsFile, JSON.stringify(state));
			await native.start(home);
			closed = false;
			const conversation = native.page.locator(
				`[data-conversation-key="${agentId}:${tab.id}"] [data-tree-nav]`
			);
			await conversation.click();
			await expect
				.poll(() => {
					const logs = saved()
						.sessions.find((item) => item.id === agentId)!
						.aiTabs.find((item) => item.id === tab.id)!.logs;
					return logs
						.filter((entry) => entry.source === 'user' && entry.text.startsWith(prompt))
						.map((entry) => entry.text);
				})
				.toEqual([prompt, prompt]);
			await native.restart(home);
			await native.page
				.locator(`[data-conversation-key="${agentId}:${tab.id}"] [data-tree-nav]`)
				.click();
			await expect(native.output()).not.toContainText('IMPORTANT: You are in read-only/plan mode.');
			await expect(native.output()).not.toContainText('[Maestro] This message also mentions');
			await native.close();
			closed = true;
			const logs = saved()
				.sessions.find((item) => item.id === agentId)!
				.aiTabs.find((item) => item.id === tab.id)!.logs;
			expect(
				logs
					.filter((entry) => entry.source === 'user' && entry.text.startsWith(prompt))
					.map((entry) => entry.text)
			).toEqual([prompt, prompt]);
			expect(
				logs.some((entry) => entry.text.includes('IMPORTANT: You are in read-only/plan mode.'))
			).toBe(false);
			expect(
				logs.some((entry) => entry.text.includes('[Maestro] This message also mentions'))
			).toBe(false);
			expect(fs.readFileSync(seed.file)).toEqual(bytes);
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (failed && !closed && native.app) await native.close(true);
		}
	});
}
