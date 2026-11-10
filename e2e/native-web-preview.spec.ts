import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Web preview uses synthetic conversations only');
test.setTimeout(180_000);

// eslint-disable-next-line no-empty-pattern
test('web preview navigates, reloads, follows conversations and restores after restart', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const requests: string[] = [];
	const server = http.createServer((request, response) => {
		requests.push(request.url ?? '/');
		response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
		response.end(`<h1>Preview ${request.url}</h1><a href="/linked">Navigate</a>`);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Missing HTTP server address');
	const base = `http://127.0.0.1:${address.port}`;
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			rightPanelOpen: true,
			crashReportingEnabled: false,
		})
	);
	const session = createMockSession({
		id: 'web-owner',
		name: 'Web preview project',
		cwd: native.project,
		fullPath: native.project,
		projectRoot: native.project,
		state: 'idle',
		activeTabId: 'web-one',
		browserTabs: [],
		customPath: path.resolve('e2e/fixtures/native/claude'),
		customEnvVars: { CLAUDE_CONFIG_DIR: native.claude },
		aiTabs: ['web-one', 'web-two'].map((id) =>
			createMockAITab({
				id,
				name: id,
				state: 'idle',
				newShellPanel: { tab: 'files', open: true },
				logs: [
					{
						id: `${id}-output`,
						source: 'stdout',
						timestamp: Date.now(),
						text: `Open [local preview](${base}/output)`,
					},
				],
			})
		),
		unifiedTabOrder: [
			{ type: 'ai', id: 'web-one' },
			{ type: 'ai', id: 'web-two' },
		],
	});
	fs.writeFileSync(
		path.join(native.data, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [session], activeSessionId: session.id })
	);
	const select = async (id: string) =>
		native.page.locator(`[data-conversation-key$=":${id}"] [data-tree-nav]`).click();
	const read = async () =>
		(await native.cli('tab', 'panel', '--agent', session.id)).tab.newShellPanel;
	const guestText = async () =>
		native.page
			.getByTestId('new-shell-web-panel')
			.locator('webview')
			.evaluate(async (view) => {
				return (
					view as HTMLElement & { executeJavaScript(code: string): Promise<string> }
				).executeJavaScript('document.body.innerText');
			});
	let failed = false;
	try {
		await native.start();
		await select('web-one');
		const panel = native.page.locator('[data-panel="right"]');
		await panel.getByRole('button', { name: 'Web', exact: true }).click();
		await expect(panel).toContainText('Enter a local development server address');
		const url = panel.getByRole('textbox', { name: 'Browser URL' });
		await url.fill(`${base}/one`);
		await url.press('Enter');
		await expect.poll(guestText).toContain('Preview /one');
		await expect.poll(read).toMatchObject({ tab: 'web', webUrl: `${base}/one` });

		await panel.locator('webview').evaluate(async (view) => {
			await (
				view as HTMLElement & { executeJavaScript(code: string): Promise<unknown> }
			).executeJavaScript('document.querySelector("a").click()');
		});
		await expect.poll(guestText).toContain('Preview /linked');
		await expect.poll(read).toMatchObject({ webUrl: `${base}/linked` });
		const beforeReload = requests.filter((url) => url === '/linked').length;
		await panel.getByTitle('Reload', { exact: true }).click();
		await expect
			.poll(() => requests.filter((url) => url === '/linked').length)
			.toBeGreaterThan(beforeReload);
		await expect.poll(guestText).toContain('Preview /linked');

		await select('web-two');
		await native.cli('tab', 'panel', 'web', '--url', `${base}/two`, '--agent', session.id);
		await expect.poll(guestText).toContain('Preview /two');
		await expect.poll(read).toMatchObject({ webUrl: `${base}/two` });
		expect(
			(await native.cli('tab', 'show', 'web-one', '--agent', session.id)).tab.newShellPanel
		).toMatchObject({ webUrl: `${base}/linked` });
		await select('web-one');
		await expect.poll(guestText).toContain('Preview /linked');
		await native.cli(
			'tab',
			'panel',
			'web-two',
			'web',
			'--url',
			`${base}/background`,
			'--agent',
			session.id
		);
		expect(
			(await native.cli('tab', 'show', 'web-two', '--agent', session.id)).tab.newShellPanel
		).toMatchObject({ webUrl: `${base}/background` });
		await expect.poll(guestText).toContain('Preview /linked');
		await select('web-two');
		await expect.poll(guestText).toContain('Preview /background');
		await native.cli('tab', 'panel', 'web', '--url', `${base}/two`, '--agent', session.id);
		await expect.poll(guestText).toContain('Preview /two');
		await select('web-one');
		await expect.poll(guestText).toContain('Preview /linked');
		await native.page.getByRole('link', { name: 'local preview', exact: true }).click();
		await expect.poll(guestText).toContain('Preview /output');
		await expect.poll(read).toMatchObject({ webUrl: `${base}/output`, tab: 'web' });
		const saved = JSON.parse(
			fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')
		);
		expect(
			saved.sessions.find((s: { id: string }) => s.id === session.id).browserTabs ?? []
		).toEqual([]);
		const terminal = await native.cli(
			'open-terminal',
			'--agent',
			session.id,
			'--name',
			'Preview links'
		);
		await native.cli(
			'send-terminal',
			`printf '\\033[2J\\033[H\\033]8;;${base}/terminal\\007WEB_PREVIEW_LINK\\033]8;;\\007\n'`,
			'--agent',
			session.id,
			'--tab',
			terminal.tabId
		);
		await expect
			.poll(async () =>
				(
					await native.cli('read-terminal', '--agent', session.id, '--tab', terminal.tabId)
				).lines.join('\n')
			)
			.toContain('WEB_PREVIEW_LINK');
		// The command clears the screen and paints its link in the first cell row.
		const terminalScreen = native.page.getByTestId('terminal-panel').locator('.xterm-screen');
		await terminalScreen.click({ position: { x: 30, y: 8 } });
		await expect.poll(guestText).toContain('Preview /terminal');
		await expect.poll(read).toMatchObject({ webUrl: `${base}/terminal` });
		await native.cli(
			'tab',
			'panel',
			'terminal-close',
			'--terminal',
			terminal.tabId,
			'--agent',
			session.id
		);
		await native.app.evaluate(({ shell }) => {
			const state = globalThis as unknown as { webPreviewOpened: string[] };
			state.webPreviewOpened = [];
			shell.openExternal = async (url: string) => {
				state.webPreviewOpened.push(url);
			};
		});
		await panel.getByTitle('Open in External Browser', { exact: true }).click();
		await native.cli('tab', 'panel', 'web-external', '--agent', session.id);
		expect(
			await native.app.evaluate(
				() => (globalThis as unknown as { webPreviewOpened: string[] }).webPreviewOpened
			)
		).toEqual([`${base}/terminal`, `${base}/terminal`]);
		await native.cli('tab', 'panel', 'web', '--url', `${base}/cli`, '--agent', session.id);
		await expect.poll(guestText).toContain('Preview /cli');
		const cliReload = requests.filter((url) => url === '/cli').length;
		await native.cli('tab', 'panel', 'web-reload', '--agent', session.id);
		await expect
			.poll(() => requests.filter((url) => url === '/cli').length)
			.toBeGreaterThan(cliReload);
		await native.cli('tab', 'panel', 'close', '--agent', session.id);
		await expect(panel).toHaveAttribute('data-open', 'false');
		await expect
			.poll(() => native.page.evaluate(() => window.maestro.process.getActiveProcesses()))
			.toEqual([]);
		await native.restart();
		await select('web-one');
		await expect(native.page.locator('[data-panel="right"]')).toHaveAttribute('data-open', 'false');
		expect(await read()).toMatchObject({ webUrl: `${base}/cli`, open: false, tab: 'web' });
		await native.cli('tab', 'panel', 'open', '--agent', session.id);
		await expect.poll(guestText).toContain('Preview /cli');
		await select('web-two');
		await expect.poll(guestText).toContain('Preview /two');
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		try {
			if (native.app) await native.close(failed);
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			);
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	}
});
