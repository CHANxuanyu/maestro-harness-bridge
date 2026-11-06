import { describe, expect, it } from 'vitest';
import {
	NEW_SHELL_HIDDEN_FEATURES,
	shellFeatureVisible,
	shellActionVisible,
	shellSettingsTabVisible,
	shellSettingVisible,
} from '../../shared/newShellFeatures';
import { shortcutAppliesToShell } from '../../shared/shortcut-types';

describe('new shell feature policy', () => {
	it.each([false, true])('keeps normal actions available, new shell %s', (newShell) => {
		expect(shellActionVisible('settings', newShell)).toBe(true);
		expect(shellSettingsTabVisible('display', newShell)).toBe(true);
	});
	for (const feature of NEW_SHELL_HIDDEN_FEATURES) {
		it.each([false, true])(
			`${feature.id} follows shell without changing preferences, new shell %s`,
			(newShell) => {
				expect(shellFeatureVisible(feature.id, newShell)).toBe(!newShell);
				for (const prefix of feature.prefixes ?? [])
					expect(shellActionVisible(`${prefix}example`, newShell)).toBe(!newShell);
				for (const id of feature.actions) {
					expect(shellActionVisible(id, newShell)).toBe(!newShell);
					expect(shortcutAppliesToShell({ id, label: id, keys: ['Meta', 'k'] }, newShell)).toBe(
						!newShell
					);
				}
				for (const id of feature.settings ?? [])
					expect(shellSettingVisible(id, 'general', newShell)).toBe(!newShell);
				for (const tab of feature.settingsTabs ?? [])
					expect(shellSettingsTabVisible(tab, newShell)).toBe(!newShell);
			}
		);
	}
});
