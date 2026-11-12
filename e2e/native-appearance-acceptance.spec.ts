import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Locator } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import type { Session } from '../src/renderer/types';

// Skip before constructing a fixture: these checks never need real accounts.
const test = base.extend<{ native: NativeApp; seed: Record<string, unknown> }>({
	seed: [{ newShell: false }, { option: true }],
	native: async ({ seed }, use, info) => {
		const native = new NativeApp(info, { providerCli: false });
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				defaultSaveToHistory: false,
				crashReportingEnabled: false,
				...seed,
			})
		);
		fs.writeFileSync(
			path.join(native.data, 'maestro-agent-configs.json'),
			JSON.stringify({
				configs: {
					'claude-code': {
						customPath: path.resolve('e2e/fixtures/native/claude'),
						customEnvVars: {
							CLAUDE_CONFIG_DIR: native.claude,
							MAESTRO_NATIVE_SCRIPT: native.script,
						},
					},
				},
			})
		);
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
test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'Appearance acceptance uses synthetic providers only'
);
test.setTimeout(180_000);

function savedSettings(native: NativeApp) {
	return JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-settings.json'), 'utf8'));
}

// Measure the face the browser actually resolves, not just a font name that
// might fall back to a proportional font. No application stores or dev hooks.
async function fontMetrics(surface: Locator) {
	return surface.evaluate(async (element) => {
		await document.fonts.ready;
		const style = getComputedStyle(element);
		const context = document.createElement('canvas').getContext('2d')!;
		context.font = `${style.fontSize} ${style.fontFamily}`;
		return {
			family: style.fontFamily,
			wide: context.measureText('WWWWWWWW').width,
			narrow: context.measureText('iiiiiiii').width,
		};
	});
}

test('U1 fresh classic: Clay, proportional UI, collapsed files and fixed-pitch code and terminal', async ({
	native,
}) => {
	const { page } = native;
	// Playwright emulates a light color scheme unless told otherwise, which
	// overrides the OS appearance; drive the media feature the product reads.
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect(page.locator('html')).toHaveAttribute('data-new-shell', 'false');
	await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
	await expect(page.locator('.maestro-app-shell')).toHaveCSS('background-color', 'rgb(38, 38, 36)');
	expect(await page.evaluate(() => window.maestro.settings.get('activeThemeId'))).toBe('clay-dark');
	const agent = await native.createAgent('claude');
	const right = page.locator('[data-panel="right"]');
	await expect(right).toHaveAttribute('data-open', 'false');
	// Collapsed is `w-0 border-l opacity-0`: with border-box sizing only the 1px
	// left border remains, and it is fully transparent.
	expect((await right.boundingBox())!.width).toBeLessThanOrEqual(1);
	await expect(right).toHaveCSS('opacity', '0');
	await expect(page.getByTitle(/^Show right panel/)).toBeVisible();
	const ui = await fontMetrics(page.locator('.maestro-app-shell'));
	expect(ui.family).toMatch(/^Inter,/);
	expect(ui.narrow).toBeGreaterThan(0);
	expect(ui.wide / ui.narrow).toBeGreaterThan(1.5);

	native.scriptTurns([{ answer: 'Font acceptance prose.\n\n```ts\nconst Wi = "WiWi";\n```' }]);
	await native.send('Show a code block for the appearance check');
	await expect(native.output()).toContainText('Font acceptance prose.');
	const code = native.output().getByTestId('code-fence').locator('pre code');
	await expect(code).toBeVisible();
	await expect(code).toHaveText('const Wi = "WiWi";');
	const codeFont = await fontMetrics(code);
	expect(codeFont.family).toMatch(/monospace/i);
	expect(codeFont.wide).toBeGreaterThan(0);
	expect(Math.abs(codeFont.wide - codeFont.narrow)).toBeLessThan(codeFont.wide * 0.02);
	await expect(right).toHaveAttribute('data-open', 'false');

	const terminal = await native.cli('open-terminal', '--agent', agent, '--name', 'U1 font check');
	const xterm = page.locator('.xterm:visible');
	await expect(xterm).toBeVisible();
	await native.cli(
		'send-terminal',
		"printf 'U1_TERMINAL_READY\\n'",
		'--agent',
		agent,
		'--tab',
		terminal.tabId
	);
	await expect
		.poll(async () =>
			(await native.cli('read-terminal', '--agent', agent, '--tab', terminal.tabId)).lines.join(
				'\n'
			)
		)
		.toContain('U1_TERMINAL_READY');
	const processes = await page.evaluate(() =>
		window.maestro.process.getActiveProcesses({ includeChildProcesses: false })
	);
	expect(
		processes.find((process) => process.sessionId === `${agent}-terminal-${terminal.tabId}`)?.pid
	).toBeGreaterThan(0);
	// xterm paints with WebGL or DOM. Its visible IME composition view uses the
	// same live font options in both renderers, so it is an observable font probe.
	const input = xterm.locator('textarea');
	await input.focus();
	await input.dispatchEvent('compositionstart', { data: '' });
	await input.dispatchEvent('compositionupdate', { data: 'WiWi' });
	const composition = xterm.locator('.composition-view.active');
	await expect(composition).toBeVisible();
	await expect(composition).toHaveText('WiWi');
	const terminalFont = await fontMetrics(composition);
	expect(terminalFont.family).toMatch(/monospace/i);
	expect(terminalFont.wide).toBeGreaterThan(0);
	expect(Math.abs(terminalFont.wide - terminalFont.narrow)).toBeLessThan(terminalFont.wide * 0.02);
	await input.dispatchEvent('compositionend', { data: '' });
});

test.describe('U1 existing classic preferences', () => {
	test.use({
		seed: {
			newShell: false,
			activeThemeId: 'dracula',
			fontFamily: 'Courier New',
			chatFontFamily: 'Arial',
			terminalFontFamily: 'Courier New',
			filePreviewFontFamily: 'Georgia',
			fileEditorFontFamily: 'Courier New',
			documentGraphFontFamily: 'Georgia',
		},
	});
	test('U1 existing classic: chosen theme and all font preferences survive startup and restart', async ({
		native,
		seed,
	}) => {
		await native.createAgent('claude');
		native.scriptTurns([{ answer: 'U1 saved chat font.' }]);
		await native.send('Show my saved chat font');
		for (const boot of [0, 1]) {
			if (boot) await native.restart();
			await expect(native.page.locator('html')).toHaveAttribute('data-new-shell', 'false');
			await expect(native.page.locator('.maestro-app-shell')).toHaveCSS(
				'background-color',
				'rgb(40, 42, 54)'
			);
			const ui = await fontMetrics(native.page.locator('.maestro-app-shell'));
			expect(ui.family).toMatch(/^"?Courier New"?,/);
			const prose = native.output().getByText('U1 saved chat font.', { exact: true });
			await expect(prose).toBeVisible();
			expect((await fontMetrics(prose)).family).toMatch(/^Arial,/);
			expect(savedSettings(native)).toMatchObject(seed);
			expect(await native.page.evaluate(() => window.maestro.settings.getAll())).toMatchObject(
				seed
			);
		}
	});
});

test.describe('U5 classic system appearance', () => {
	test.use({ seed: { newShell: false, activeThemeId: 'dracula', followSystemAppearance: false } });
	test('U5 Clay follows native dark and light mode only while enabled; other themes stay selected', async ({
		native,
	}) => {
		const { page } = native;
		await page.keyboard.press('ControlOrMeta+,');
		const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
		await settings.getByRole('button', { name: 'Themes', exact: true }).click();
		await settings.locator('[data-theme-id="clay-light"]').click();
		const follow = settings.getByRole('switch', { name: 'Follow system light and dark mode' });
		await expect(follow).not.toBeChecked();
		await follow.click();
		await expect(follow).toBeChecked();
		await expect.poll(() => savedSettings(native).followSystemAppearance).toBe(true);
		const appearance = async (
			mode: 'dark' | 'light',
			expectedMode: 'dark' | 'light',
			background: string
		) => {
			// Playwright's emulated scheme overrides nativeTheme, so set the media
			// feature the renderer reads (usePrefersDarkColorScheme) directly.
			await page.emulateMedia({ colorScheme: mode });
			await expect
				.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
				.toBe(mode === 'dark');
			await expect(page.locator('html')).toHaveAttribute('data-theme-mode', expectedMode);
			await expect(page.locator('.maestro-app-shell')).toHaveCSS('background-color', background);
		};
		for (const mode of ['dark', 'light', 'dark'] as const) {
			await appearance(mode, mode, mode === 'dark' ? 'rgb(38, 38, 36)' : 'rgb(250, 249, 245)');
			expect(savedSettings(native).activeThemeId).toBe('clay-light');
		}
		await follow.click();
		await expect(follow).not.toBeChecked();
		await expect.poll(() => savedSettings(native).followSystemAppearance).toBe(false);
		for (const mode of ['light', 'dark'] as const) {
			await appearance(mode, 'light', 'rgb(250, 249, 245)');
			expect(savedSettings(native).activeThemeId).toBe('clay-light');
		}
		await settings.locator('[data-theme-id="dracula"]').click();
		// Keep following enabled to prove that it is the unpaired theme, not the
		// disabled setting, that makes subsequent OS appearance changes inert.
		await follow.click();
		await expect(follow).toBeChecked();
		for (const mode of ['light', 'dark', 'light'] as const) {
			await appearance(mode, 'dark', 'rgb(40, 42, 54)');
			expect(savedSettings(native).activeThemeId).toBe('dracula');
		}
		await page.keyboard.press('Escape');
	});
});

test('N1 classic to new shell by clicking: usable ordered panes and conversations survive switching back', async ({
	native,
}) => {
	const { page } = native;
	const saved = (): Session[] =>
		JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')).sessions;
	await page.setViewportSize({ width: 1440, height: 1000 });
	await expect(page.locator('html')).toHaveAttribute('data-new-shell', 'false');
	await page.keyboard.press('ControlOrMeta+,');
	const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
	await settings.getByRole('button', { name: 'Display', exact: true }).click();
	const toggle = settings.getByRole('switch', { name: 'Use the new shell', exact: true });
	await expect(toggle).not.toBeChecked();
	await toggle.click();
	await expect(toggle).toBeChecked();
	await expect(page.locator('html')).toHaveAttribute('data-new-shell', 'true');
	await expect.poll(() => savedSettings(native).newShell).toBe(true);
	await page.keyboard.press('Escape');
	await expect(settings).toHaveCount(0);
	await expect(page.getByTestId('project-start')).toBeVisible();
	fs.writeFileSync(
		path.join(native.project, 'appearance.ts'),
		'export const acceptance = "N1 file preview";\n'
	);
	await native.app.evaluate(({ dialog }, project) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
	}, native.project);
	await page.getByRole('button', { name: 'Open project folder', exact: true }).click();
	await expect(native.input()).toBeVisible();
	await expect.poll(() => saved().length).toBe(1);
	const owner = saved()[0];
	expect(owner.cwd).toBe(fs.realpathSync(native.project));
	const row = page.locator(`[data-conversation-key="${owner.id}:${owner.activeTabId}"]`);
	await expect(row).toBeVisible();
	await row.locator(':scope > div > button[data-tree-nav]').last().click();
	native.scriptTurns([
		{ answer: 'N1 conversation is preserved.' },
		{ answer: 'N1 classic continuation works.' },
	]);
	await native.send('N1 project conversation');
	await expect(native.output()).toContainText('N1 conversation is preserved.');
	await expect(page.getByTestId('stop-turn-button')).toHaveCount(0);
	await native.input().fill('N1 unsent draft');
	const header = page.locator('[data-shell-header="main"]');
	await header.getByTitle(/^Show right panel/).click();
	const left = page.locator('[data-panel="left"]');
	const centre = header.locator('..');
	const right = page.locator('[data-panel="right"]');
	await expect(right).toHaveAttribute('data-open', 'true');
	await right.locator('[data-tour="files-tab"]').click();
	const files = right.locator('[data-tour="files-panel"]');
	await files.getByText('appearance.ts', { exact: true }).click();
	await expect(files).toContainText('N1 file preview');
	for (const region of [left, centre, right]) {
		await expect(region).toBeVisible();
		await expect(region).toBeInViewport({ ratio: 1 });
	}
	// Poll the actual rectangles through the width transition. All three must
	// share a vertical band, with neither adjacent pair overlapping horizontally.
	await expect
		.poll(async () => {
			const [l, c, r] = await Promise.all([
				left.boundingBox(),
				centre.boundingBox(),
				right.boundingBox(),
			]);
			return (
				!!l &&
				!!c &&
				!!r &&
				l.width > 0 &&
				c.width > 0 &&
				r.width > 0 &&
				l.height > 100 &&
				c.height > 100 &&
				r.height > 100 &&
				l.x + l.width <= c.x &&
				c.x + c.width <= r.x &&
				Math.max(l.y, c.y, r.y) < Math.min(l.y + l.height, c.y + c.height, r.y + r.height)
			);
		})
		.toBe(true);
	await expect(centre.getByLabel('Terminal output', { exact: true })).toBeVisible();
	await expect(native.input()).toHaveValue('N1 unsent draft');
	await expect
		.poll(() => saved()[0].aiTabs.find((tab) => tab.id === owner.activeTabId)?.inputValue)
		.toBe('N1 unsent draft');
	const before = saved()[0].aiTabs.find((tab) => tab.id === owner.activeTabId)!;
	expect(before.agentSessionId).toBeTruthy();
	expect(before.logs.some((log) => log.text.includes('N1 conversation is preserved.'))).toBe(true);
	await page.keyboard.press('ControlOrMeta+,');
	await settings.getByRole('button', { name: 'Display', exact: true }).click();
	await expect(toggle).toBeChecked();
	await toggle.click();
	await expect(toggle).not.toBeChecked();
	await page.keyboard.press('Escape');
	await expect(page.locator('html')).toHaveAttribute('data-new-shell', 'false');
	await expect.poll(() => savedSettings(native).newShell).toBe(false);
	await expect(native.output()).toContainText('N1 project conversation');
	await expect(native.output()).toContainText('N1 conversation is preserved.');
	await expect(native.input()).toHaveValue('N1 unsent draft');
	await expect
		.poll(() => saved()[0].aiTabs.find((tab) => tab.id === before.id))
		.toMatchObject({
			id: before.id,
			agentSessionId: before.agentSessionId,
			logs: before.logs,
			inputValue: 'N1 unsent draft',
		});
	await native.send('N1 continue in classic');
	await expect(native.output()).toContainText('N1 classic continuation works.');
	await expect
		.poll(() => saved()[0].aiTabs.find((tab) => tab.id === before.id)?.agentSessionId)
		.toBe(before.agentSessionId);
});
