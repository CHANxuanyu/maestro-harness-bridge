import { describe, expect, it } from 'vitest';
import {
	buildWebSettingsSnapshot,
	WEB_SETTINGS_BROADCAST_KEYS,
} from '../../../main/web-server/web-settings-snapshot';
import type { SettingsStoreInterface } from '../../../main/stores/types';

function storeWithLanguage(value: unknown): SettingsStoreInterface {
	return {
		get: (key: string, fallback: unknown) => (key === 'uiLanguage' ? value : fallback),
	} as SettingsStoreInterface;
}

describe('web UI language propagation', () => {
	it.each(['system', 'en', 'zh-CN'])('includes %s in the read and broadcast snapshot', (value) => {
		expect(WEB_SETTINGS_BROADCAST_KEYS.has('uiLanguage')).toBe(true);
		expect(buildWebSettingsSnapshot(storeWithLanguage(value)).uiLanguage).toBe(value);
	});

	it.each([undefined, null, 'fr', { value: 'zh-CN' }])(
		'normalizes old or malformed stored preferences (%j)',
		(value) => {
			expect(buildWebSettingsSnapshot(storeWithLanguage(value)).uiLanguage).toBe('system');
		}
	);
});
