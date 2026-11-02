import { describe, expect, it } from 'vitest';
import { APPEARANCE_PAIRS, THEMES, themeIdForAppearance } from '../../shared/themes';

describe('themeIdForAppearance', () => {
	it('draws the Clay half that matches the system', () => {
		expect(themeIdForAppearance('clay-dark', false)).toBe('clay-light');
		expect(themeIdForAppearance('clay-light', true)).toBe('clay-dark');
		expect(themeIdForAppearance('clay-dark', true)).toBe('clay-dark');
		expect(themeIdForAppearance('clay-light', false)).toBe('clay-light');
	});

	it('never changes a theme that has no pair', () => {
		for (const id of ['dracula', 'github-light', 'nord', 'custom', 'some-plugin-theme']) {
			expect(themeIdForAppearance(id, true)).toBe(id);
			expect(themeIdForAppearance(id, false)).toBe(id);
		}
	});

	it('pairs a dark theme with a light one, both ways', () => {
		for (const [id, pair] of Object.entries(APPEARANCE_PAIRS)) {
			expect(APPEARANCE_PAIRS[pair!]).toBe(id);
			expect(THEMES[id as keyof typeof THEMES].mode).not.toBe(THEMES[pair!].mode);
		}
	});
});
