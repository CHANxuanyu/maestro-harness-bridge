/**
 * Tests for src/shared/theme-types.ts
 *
 * Tests the isValidThemeId type guard and the retired-theme resolver.
 */

import { describe, it, expect } from 'vitest';
import {
	DEFAULT_THEME_ID,
	isValidThemeId,
	resolveThemeId,
	RETIRED_THEME_IDS,
	type ThemeId,
} from '../../shared/theme-types';
import { THEMES } from '../../shared/themes';

describe('isValidThemeId', () => {
	// Sample of valid theme IDs (not exhaustive - that would couple tests to implementation)
	const sampleValidIds = [
		'dracula',
		'monokai',
		'github-light',
		'nord',
		'olive-nights',
		'indigo-blue',
		'pedurple',
	];

	it('should return true for valid theme IDs', () => {
		for (const id of sampleValidIds) {
			expect(isValidThemeId(id)).toBe(true);
		}
	});

	it('should return false for invalid theme IDs', () => {
		const invalidIds = ['', 'invalid', 'not-a-theme', 'Dracula', 'NORD'];
		for (const id of invalidIds) {
			expect(isValidThemeId(id)).toBe(false);
		}
	});

	it('should work as a type guard for filtering', () => {
		const mixedIds = ['dracula', 'invalid', 'nord', 'fake'];
		const validIds = mixedIds.filter(isValidThemeId);

		expect(validIds).toEqual(['dracula', 'nord']);
		// TypeScript should now know validIds is ThemeId[]
		const _typeCheck: ThemeId[] = validIds;
		expect(_typeCheck).toBe(validIds);
	});
});

describe('resolveThemeId', () => {
	it('passes a live theme id through untouched', () => {
		expect(resolveThemeId('nord')).toBe('nord');
		expect(resolveThemeId('winamp')).toBe('winamp');
	});

	// A user who picked a theme before it was retired still has that id on disk.
	// App.tsx looks the theme up bare, so an unmapped id renders the app unstyled.
	it('maps a retired theme id to its replacement', () => {
		expect(resolveThemeId('inquest')).toBe('dracula');
	});

	it('falls back for anything unrecognized, including non-strings', () => {
		expect(resolveThemeId('not-a-theme')).toBe('clay-dark');
		expect(resolveThemeId(undefined)).toBe('clay-dark');
		expect(resolveThemeId(null)).toBe('clay-dark');
		expect(resolveThemeId(42)).toBe('clay-dark');
		expect(resolveThemeId('not-a-theme', 'nord')).toBe('nord');
	});

	it('never maps a retired id onto another retired or missing theme', () => {
		for (const [retired, replacement] of Object.entries(RETIRED_THEME_IDS)) {
			expect(isValidThemeId(retired)).toBe(false);
			expect(THEMES[replacement]).toBeDefined();
		}
	});
});

// The 2026-11-02 redesign's default look (docs/roadmap/claude-code-ui.md).
describe('Clay themes', () => {
	it('ship a dark and a light variant', () => {
		expect(THEMES['clay-dark']).toMatchObject({ id: 'clay-dark', mode: 'dark' });
		expect(THEMES['clay-light']).toMatchObject({ id: 'clay-light', mode: 'light' });
		expect(isValidThemeId('clay-dark')).toBe(true);
		expect(isValidThemeId('clay-light')).toBe(true);
	});

	it('are the default theme a fresh install starts on', () => {
		expect(DEFAULT_THEME_ID).toBe('clay-dark');
	});

	it('keep one accent and neutral surfaces', () => {
		for (const id of ['clay-dark', 'clay-light'] as const) {
			const { colors } = THEMES[id];
			// Surfaces are warm greys, never tinted with the accent hue.
			for (const surface of [colors.bgMain, colors.bgSidebar, colors.bgActivity]) {
				const [r, g, b] = [1, 3, 5].map((i) => parseInt(surface.slice(i, i + 2), 16));
				expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(16);
			}
		}
	});
});
