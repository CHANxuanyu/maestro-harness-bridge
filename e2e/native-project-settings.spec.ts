import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import type { Session } from '../src/renderer/types';

test.setTimeout(120_000);
test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Project settings use synthetic providers only');

// All accounts, project files and Maestro data belong to NativeApp's temporary root.
// No prompts are sent, and no real provider CLI is used.
// eslint-disable-next-line no-empty-pattern
test('project defaults: UI, CLI, future conversations, restart and classic shell', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			uiLanguage: 'en',
			defaultSaveToHistory: false,
		})
	);
	const customPath = path.resolve('e2e/fixtures/native/codex');
	const owner = createMockSession({
		id: 'project-owner',
		name: 'Project fixture',
		toolType: 'codex',
		cwd: native.project,
		projectRoot: native.project,
		customPath,
		customEnvVars: { CODEX_HOME: native.codex },
		activeTabId: 'old-tab',
		aiTabs: [
			createMockAITab({
				id: 'old-tab',
				name: 'Existing conversation',
				permissionMode: 'readonly',
				readOnlyMode: true,
				customModel: 'existing-model',
			}),
		],
	});
	fs.writeFileSync(
		path.join(native.data, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [owner] })
	);
	fs.writeFileSync(
		path.join(native.data, 'maestro-agent-configs.json'),
		JSON.stringify({
			configs: { codex: { customPath, customEnvVars: { CODEX_HOME: native.codex } } },
		})
	);
	const saved = (): Session[] =>
		JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')).sessions;
	let failed = true;
	try {
		await native.start(home);
		await expect(
			native.page.getByText('Existing conversation', { exact: true }).first()
		).toBeVisible();
		const projectHeader = native.page.getByRole('button', { name: /^project\s+\d+$/i });
		await projectHeader.click({ button: 'right' });
		await native.page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
		const modal = native.page.getByRole('dialog', { name: 'Project settings', exact: true });
		await modal.getByLabel('Default tool').selectOption('codex');
		await modal.getByLabel('Default model').fill('project-model');
		await modal.getByLabel('Default permission').selectOption('full');
		await expect(modal.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
		await modal.getByRole('checkbox').check();
		await modal.getByRole('button', { name: 'Add Variable', exact: true }).click();
		await modal.getByPlaceholder('VARIABLE_NAME').fill('API_TOKEN');
		await modal.getByPlaceholder('value', { exact: true }).fill('synthetic-project-token');
		await expect(modal.getByPlaceholder('value', { exact: true })).toHaveAttribute(
			'type',
			'password'
		);
		await modal.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(modal).toHaveCount(0);
		const shown = await native.cli('project', 'settings', 'show', '--path', native.project);
		expect(shown.settings.defaultModel).toBe('project-model');
		expect(shown.settings.fullAccessAcknowledged).toBe(true);
		expect(shown.settings.envVars.API_TOKEN).not.toBe('synthetic-project-token');
		expect(
			(await native.cli('project', 'settings', 'show', '--path', native.project, '--show-secrets'))
				.settings.envVars.API_TOKEN
		).toBe('synthetic-project-token');
		expect(shown.settings.modelProvider).toBe('codex');
		const publicSettings = await native.page.evaluate(async () => ({
			all: await window.maestro.settings.getAll(),
			one: await window.maestro.settings.get('projectSettings'),
		}));
		expect(JSON.stringify(publicSettings)).not.toContain('synthetic-project-token');
		await expect(native.cli('settings', 'set', 'projectSettings', '{}')).rejects.toThrow(
			'project settings set'
		);
		const bypass = await native.page.evaluate(async () => {
			try {
				await window.maestro.settings.set('projectSettings', {});
				return 'accepted';
			} catch (error) {
				return String(error);
			}
		});
		expect(bypass).toContain('project settings set');
		const created = await native.cli('tab', 'new', '--agent', owner.id);
		expect(created.success).toBe(true);
		expect(created.sessionId).not.toBe(owner.id);
		await expect
			.poll(
				() =>
					saved()
						.find((session) => session.id === created.sessionId)
						?.aiTabs.find((tab) => tab.id === created.tabId)?.customModel
			)
			.toBe('project-model');
		expect(saved().find((session) => session.id === owner.id)?.aiTabs[0]).toMatchObject({
			id: 'old-tab',
			customModel: 'existing-model',
			permissionMode: 'readonly',
		});
		expect(
			saved().find((session) => session.id === created.sessionId)?.aiTabs[0].permissionMode
		).toBe('readonly');
		await native.cli(
			'project',
			'settings',
			'set',
			'--path',
			'~/same-project',
			'--ssh-remote',
			'fixture-a',
			'--model',
			'remote-a',
			'--model-provider',
			'codex'
		);
		expect(
			(
				await native.cli(
					'project',
					'settings',
					'show',
					'--path',
					'~/same-project',
					'--ssh-remote',
					'fixture-b'
				)
			).settings
		).toEqual({});
		await native.cli(
			'project',
			'settings',
			'set',
			'--path',
			native.project,
			'--provider',
			'inherit',
			'--model-provider',
			'codex',
			'--model',
			'project-model'
		);
		await native.restart(home);
		expect(
			(await native.cli('project', 'settings', 'show', '--path', native.project)).settings
				.defaultModel
		).toBe('project-model');
		const afterRestart = await native.cli('tab', 'new', '--agent', owner.id);
		expect(afterRestart.success).toBe(true);
		await expect
			.poll(
				() =>
					saved().find((session) => session.id === afterRestart.sessionId)?.customEnvVars?.API_TOKEN
			)
			.toBe('synthetic-project-token');
		const restartedTab = saved()
			.find((session) => session.id === afterRestart.sessionId)
			?.aiTabs.find((tab) => tab.id === afterRestart.tabId);
		expect(restartedTab).toMatchObject({
			customModel: 'project-model',
			permissionMode: 'readonly',
		});
		await native.cli('settings', 'set', 'uiLanguage', 'zh-CN');
		await native.page.getByRole('button', { name: /^project\s+\d+$/i }).click({ button: 'right' });
		await expect(
			native.page.getByRole('menuitem', { name: '项目设置', exact: true })
		).toBeVisible();
		await native.page.keyboard.press('Escape');
		await native.cli('settings', 'set', 'newShell', 'false');
		await expect(native.page.getByRole('menuitem', { name: '项目设置', exact: true })).toHaveCount(
			0
		);
		const classic = await native.cli('tab', 'new', '--agent', owner.id);
		expect(classic.sessionId).toBe(owner.id);
		await expect
			.poll(() =>
				saved()
					.find((session) => session.id === owner.id)
					?.aiTabs.some((tab) => tab.id === classic.tabId)
			)
			.toBe(true);
		expect(
			saved()
				.find((session) => session.id === owner.id)
				?.aiTabs.find((tab) => tab.id === classic.tabId)?.customModel
		).toBeUndefined();
		expect(fs.existsSync(path.join(native.codex, 'fixture-turn-count'))).toBe(false);
		failed = false;
	} finally {
		if (native.app) await native.close(failed);
	}
});
