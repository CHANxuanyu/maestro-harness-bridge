import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { settingsSet } from '../../../cli/commands/settings-set';
import { settingsGet } from '../../../cli/commands/settings-get';
import { readSettingValue } from '../../../cli/services/storage';
import { SETTINGS_DEFAULTS } from '../../../main/stores/defaults';

describe('newShell generic settings commands', () => {
	const directories: string[] = [];
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		for (const directory of directories) rmSync(directory, { recursive: true, force: true });
	});

	it('registers an opt-in default', () => {
		expect(SETTINGS_DEFAULTS.newShell).toBe(false);
	});

	it('sets and reads a boolean through the existing generic commands', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'maestro-shell-settings-'));
		directories.push(directory);
		vi.stubEnv('MAESTRO_USER_DATA', directory);
		writeFileSync(path.join(directory, 'maestro-settings.json'), '{}');
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('CLI exit');
		});
		settingsGet('newShell', { json: true });
		expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toMatchObject({ defaultValue: false });
		settingsSet('newShell', 'true', { json: true });
		expect(readSettingValue('newShell')).toBe(true);
		settingsGet('newShell', { json: true });
		expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toMatchObject({
			key: 'newShell',
			value: true,
		});
	});
});
