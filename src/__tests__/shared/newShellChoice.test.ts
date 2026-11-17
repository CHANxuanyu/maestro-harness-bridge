import { describe, expect, it } from 'vitest';
import { migrateNewShellChoice, newShellChoicePatch } from '../../shared/newShellChoice';

describe('new shell default migration', () => {
	it.each([
		['fresh install', {}],
		['upgrade without value', { fontSize: 16 }],
		['upgrade with materialized old default', { newShell: false }],
		['upgrade with new shell already on', { newShell: true }],
	])('%s chooses auto once', (_, stored) => {
		const patch = migrateNewShellChoice(stored);
		expect(patch).toEqual({ newShell: true, newShellChoice: 'auto' });
		expect(migrateNewShellChoice({ ...stored, ...patch })).toBeNull();
	});

	it.each([true, false])('respects explicit choice across later starts: %s', (enabled) => {
		const stored = { ...migrateNewShellChoice({}), ...newShellChoicePatch(enabled) };
		expect(stored).toEqual({ newShell: enabled, newShellChoice: enabled ? 'new' : 'classic' });
		expect(migrateNewShellChoice(stored)).toBeNull();
		expect(migrateNewShellChoice(JSON.parse(JSON.stringify(stored)))).toBeNull();
	});

	it.each(['false', 0, null, undefined, {}])('rejects a non-boolean choice: %s', (value) => {
		expect(() => newShellChoicePatch(value)).toThrow('newShell must be a boolean');
	});
});
