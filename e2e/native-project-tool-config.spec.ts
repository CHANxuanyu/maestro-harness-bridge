import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import type { Session } from '../src/renderer/types';

test.setTimeout(120_000);
test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'Project tool configuration uses synthetic providers only'
);

// No conversation sends. Accounts and application state stay in the fixture root.
// eslint-disable-next-line no-empty-pattern
test('project tool config: claude -p, custom path, CLI readback, restart and classic shell', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	const customPath = path.resolve('e2e/fixtures/native/claude');
	const nextPath = path.join(native.root, 'claude-alternate');
	fs.symlinkSync(customPath, nextPath);
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			uiLanguage: 'en',
			defaultSaveToHistory: false,
			// Seed an already migrated installation with deliberate per-config choices.
			migration_apiModeDefaultV1: true,
		})
	);
	const owner = createMockSession({
		id: 'project-config-claude',
		name: 'Primary Claude',
		toolType: 'claude-code',
		cwd: native.project,
		projectRoot: native.project,
		customPath,
		customEnvVars: { CLAUDE_CONFIG_DIR: native.claude },
		enableMaestroP: true,
		maestroPMode: 'interactive',
		state: 'idle',
		aiPid: 0,
		activeTabId: 'existing',
		aiTabs: [
			createMockAITab({
				id: 'existing',
				name: 'Existing conversation',
				state: 'idle',
				permissionMode: 'full',
			}),
		],
	});
	const sibling = createMockSession({
		...owner,
		id: 'second-config',
		name: 'Second Claude',
		activeTabId: 'second',
		aiTabs: [createMockAITab({ id: 'second', name: 'Other conversation', state: 'idle' })],
	});
	const sessionsFile = path.join(native.data, 'maestro-sessions.json');
	fs.writeFileSync(sessionsFile, JSON.stringify({ sessions: [owner, sibling] }));
	fs.writeFileSync(
		path.join(native.data, 'maestro-agent-configs.json'),
		JSON.stringify({
			configs: {
				'claude-code': { customPath, customEnvVars: { CLAUDE_CONFIG_DIR: native.claude } },
			},
		})
	);
	const saved = (): Session[] => JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).sessions;
	let failed = true;
	try {
		await native.start(home);
		for (const session of [owner, sibling]) {
			expect(await native.cli('show', 'agent', session.id)).toMatchObject({
				tokenSource: 'interactive',
				enableMaestroP: true,
				maestroPMode: 'interactive',
			});
		}
		await expect(
			native.page.getByText('Existing conversation', { exact: true }).first()
		).toBeVisible();
		await native.page.getByRole('button', { name: /^project\s+\d+$/i }).click({ button: 'right' });
		await native.page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
		let modal = native.page.getByRole('dialog', { name: 'Project settings', exact: true });
		await expect(modal.getByText('New conversation defaults', { exact: true })).toBeVisible();
		await expect(modal.getByText('Tool configurations', { exact: true })).toBeVisible();
		let row = modal.getByTestId(`project-tool-${owner.id}`);
		await row.getByRole('button', { name: /Primary Claude/ }).click();
		await expect(
			row.getByText('Changes affect all conversations using this tool configuration.', {
				exact: true,
			})
		).toBeVisible();
		await row.getByRole('button', { name: 'claude -p', exact: true }).click();
		await row.getByPlaceholder('/path/to/claude', { exact: true }).fill(nextPath);
		await modal.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(modal).toHaveCount(0);
		const shown = await native.cli('show', 'agent', owner.id);
		expect(shown).toMatchObject({
			customPath: nextPath,
			tokenSource: 'api',
			enableMaestroP: false,
			maestroPMode: 'dynamic',
			customEnvVars: { CLAUDE_CONFIG_DIR: native.claude },
		});
		expect((await native.cli('show', 'agent', sibling.id)).tokenSource).toBe('interactive');
		expect(
			JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-agent-configs.json'), 'utf8'))
		).toEqual({
			configs: {
				'claude-code': { customPath, customEnvVars: { CLAUDE_CONFIG_DIR: native.claude } },
			},
		});
		expect(
			saved()
				.find((session) => session.id === owner.id)
				?.aiTabs.map((tab) => tab.id)
		).toEqual(['existing']);
		expect(
			await native.page.evaluate(async () =>
				(await window.maestro.process.getActiveProcesses()).filter((process) => !process.isTerminal)
			)
		).toEqual([]);
		// A rejected multi-tool transaction leaves defaults and both owners untouched.
		const beforeDefaults = await native.cli(
			'project',
			'settings',
			'show',
			'--path',
			native.project
		);
		await expect(
			native.cli(
				'project',
				'settings',
				'set',
				'--path',
				native.project,
				'--provider',
				'codex',
				'--tool-config',
				JSON.stringify({
					[owner.id]: { customArgs: '--should-not-save' },
					missing: { customArgs: '--missing' },
				})
			)
		).rejects.toThrow();
		expect(await native.cli('project', 'settings', 'show', '--path', native.project)).toEqual(
			beforeDefaults
		);
		expect((await native.cli('show', 'agent', owner.id)).customArgs).not.toBe('--should-not-save');
		await native.cli(
			'project',
			'settings',
			'set',
			'--path',
			native.project,
			'--provider',
			'codex',
			'--tool-config',
			JSON.stringify({
				[owner.id]: { customArgs: '--transaction-a' },
				[sibling.id]: { customArgs: '--transaction-b' },
			})
		);
		expect(
			(await native.cli('project', 'settings', 'show', '--path', native.project)).settings
				.defaultProvider
		).toBe('codex');
		expect((await native.cli('show', 'agent', owner.id)).customArgs).toBe('--transaction-a');
		expect((await native.cli('show', 'agent', sibling.id)).customArgs).toBe('--transaction-b');
		await native.restart(home);
		expect((await native.cli('show', 'agent', owner.id)).customArgs).toBe('--transaction-a');
		expect((await native.cli('show', 'agent', sibling.id)).customArgs).toBe('--transaction-b');
		modal = native.page.getByRole('dialog', { name: 'Project settings', exact: true });
		row = modal.getByTestId(`project-tool-${owner.id}`);
		expect(await native.cli('show', 'agent', owner.id)).toMatchObject({
			customPath: nextPath,
			tokenSource: 'api',
			enableMaestroP: false,
			maestroPMode: 'dynamic',
		});
		await native.page.getByRole('button', { name: /^project\s+\d+$/i }).click({ button: 'right' });
		await native.page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
		await row.getByRole('button', { name: /Primary Claude/ }).click();
		await expect(row.getByPlaceholder('/path/to/claude', { exact: true })).toHaveValue(nextPath);
		await expect(row.getByRole('button', { name: 'claude -p', exact: true })).toHaveClass(/ring-2/);
		await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
		await native.cli(
			'update-agent',
			owner.id,
			'--custom-path',
			customPath,
			'--token-source',
			'dynamic'
		);
		expect(await native.cli('show', 'agent', owner.id)).toMatchObject({
			customPath,
			tokenSource: 'dynamic',
		});
		await native.page.getByRole('button', { name: /^project\s+\d+$/i }).click({ button: 'right' });
		await native.page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
		await row.getByRole('button', { name: /Primary Claude/ }).click();
		await expect(row.getByPlaceholder('/path/to/claude', { exact: true })).toHaveValue(customPath);
		await expect(row.getByRole('button', { name: 'Dynamic', exact: true })).toHaveClass(/ring-2/);
		expect(saved().find((session) => session.id === owner.id)).toMatchObject({
			customPath,
			enableMaestroP: true,
			maestroPMode: 'dynamic',
		});
		await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
		await native.cli('settings', 'set', 'newShell', 'false');
		await expect(native.page.getByTestId(`project-tool-${owner.id}`)).toHaveCount(0);
		expect((await native.cli('settings', 'get', 'newShell')).value).toBe(false);
		await native.cli('settings', 'set', 'sidebarNavigationMode', 'agents');
		// The window title strip also shows the agent name, so aim at the classic list row.
		await native.page
			.locator('[data-tour="session-list"]')
			.getByText('Primary Claude', { exact: true })
			.click({ button: 'right' });
		await native.page.getByRole('button', { name: 'Edit Agent...', exact: true }).click();
		const classic = native.page.getByRole('dialog', {
			name: 'Edit Agent: Primary Claude',
			exact: true,
		});
		await expect(classic.getByPlaceholder('/path/to/claude', { exact: true })).toHaveValue(
			customPath
		);
		await expect(classic.getByRole('button', { name: 'Dynamic', exact: true })).toHaveClass(
			/ring-2/
		);
		// A changed name proves the post-edit disk write has actually completed.
		await classic.locator('#edit-agent-name-input').fill('Primary Claude Updated');
		await classic.getByRole('button', { name: 'Save Changes', exact: true }).click();
		await expect(classic).toHaveCount(0);
		await expect
			.poll(() => saved().find((session) => session.id === owner.id))
			.toMatchObject({
				name: 'Primary Claude Updated',
				customPath,
				enableMaestroP: true,
				maestroPMode: 'dynamic',
			});
		expect(await native.cli('show', 'agent', owner.id)).toMatchObject({
			customPath,
			tokenSource: 'dynamic',
		});
		expect((await native.cli('show', 'agent', sibling.id)).tokenSource).toBe('interactive');
		await native.cli('update-agent', owner.id, '--token-source', 'api');
		expect((await native.cli('show', 'agent', owner.id)).tokenSource).toBe('api');
		expect(fs.existsSync(path.join(native.claude, 'fixture-turn-count'))).toBe(false);
		failed = false;
	} finally {
		if (native.app) await native.close(failed);
	}
});
