import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { interpolate, placeholderNames } from '../../../renderer/i18n/interpolate';
import { interpolateNodes } from '../../../renderer/i18n/richText';
import {
	CATALOGS,
	getTranslator,
	hasTranslation,
	SUPPORTED_LOCALES,
	translate,
	type MessageKey,
} from '../../../renderer/i18n/translate';

// Translation edits are checked as a complete catalog, including infrequently
// visited states such as validation errors and confirmation dialogs.
describe('message catalogs', () => {
	it.each(SUPPORTED_LOCALES)('%s preserves English keys and named parameters', (locale) => {
		const sourceKeys = Object.keys(CATALOGS.en).sort() as MessageKey[];
		expect(Object.keys(CATALOGS[locale]).sort()).toEqual(sourceKeys);
		for (const key of sourceKeys) {
			const translated = CATALOGS[locale][key];
			expect(translated, `${locale}: ${key}`).toBeTypeOf('string');
			expect(placeholderNames(translated).sort(), `${locale}: ${key}`).toEqual(
				placeholderNames(CATALOGS.en[key]).sort()
			);
		}
	});

	it('falls back to English when an incomplete catalog lacks a message', () => {
		const key: MessageKey = 'settings.search.noResults';
		const catalog = CATALOGS['zh-CN'] as Partial<Record<MessageKey, string>>;
		const saved = catalog[key];
		try {
			delete catalog[key];
			expect(hasTranslation('zh-CN', key)).toBe(false);
			expect(translate('zh-CN', key, { query: 'my setting' })).toBe(
				'No settings found for “my setting”'
			);
		} finally {
			catalog[key] = saved;
		}
	});

	it('returns an unknown key visibly instead of rendering an empty string', () => {
		expect(translate('zh-CN', 'future.message' as MessageKey)).toBe('future.message');
	});

	it('reuses a translator until the language changes', () => {
		expect(getTranslator('en')).toBe(getTranslator('en'));
		expect(getTranslator('zh-CN')).not.toBe(getTranslator('en'));
		expect(getTranslator('zh-CN')('settings.language.heading')).toBe('语言');
	});
});

describe('message interpolation', () => {
	it('inserts zero, empty text, repeated values, and literal replacement characters', () => {
		expect(interpolate('{count}: {name}/{name}{empty}', { count: 0, name: '$&', empty: '' })).toBe(
			'0: $&/$&'
		);
	});

	it('leaves missing parameters and non-placeholder braces visible', () => {
		expect(interpolate('{known} {missing} {not-a-name}', { known: 'value' })).toBe(
			'value {missing} {not-a-name}'
		);
		expect(interpolate('{name}')).toBe('{name}');
		expect(placeholderNames('{name} {count} {name}')).toEqual(['name', 'count']);
	});

	it('keeps rich parameters interactive while treating template markup as text', () => {
		const { container } = render(
			<div>
				{interpolateNodes('<img src=x> {link} {count} {missing}', {
					link: <a href="https://example.com/help">Help</a>,
					count: 0,
				})}
			</div>
		);
		expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute(
			'href',
			'https://example.com/help'
		);
		expect(container.querySelector('img')).toBeNull();
		expect(container.textContent).toBe('<img src=x> Help 0 {missing}');
	});

	it('supports repeated rich parameters and deliberately empty values', () => {
		const { container } = render(
			<div>{interpolateNodes('{key}/{key}{empty}', { key: <kbd>Enter</kbd>, empty: null })}</div>
		);
		expect(container.querySelectorAll('kbd')).toHaveLength(2);
		expect(container.textContent).toBe('Enter/Enter');
	});
});
