import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../../../renderer/i18n/translate';
import { scanJsx, scanNewShellCopy } from './scanNewShellCopy.mjs';

describe('new shell copy audit', () => {
	it('finds visible JSX copy and ignores translated and classic-only text', () => {
		const source = `<><p>Untranslated text</p><button title="Open files" aria-label={'Choose tool'} />
			<input placeholder={busy ? 'Wait here' : t('ready')} />
			<div>{t('translated', { name: 'Provider' })}</div>
			{!newShell && <p>Classic only</p>}
			<p>{newShell ? t('new') : 'Classic fallback'}</p></>`;
		expect(scanJsx(source).map((item: { text: string }) => item.text)).toEqual([
			'Untranslated text',
			'Open files',
			'Choose tool',
			'Wait here',
		]);
	});

	it('keeps the empty conversation tool selector localized', () => {
		expect(
			scanNewShellCopy().filter(
				(item: { file: string; kind: string }) =>
					item.file.endsWith('EmptyConversationPicker.tsx') && item.kind === 'aria-label'
			)
		).toEqual([]);
	});

	it.each(['en', 'zh-CN'] as const)(
		'%s uses conversation terminology in new shell keys',
		(locale) => {
			const violations = Object.entries(CATALOGS[locale]).filter(
				([key, text]) =>
					key.startsWith('workflows.newShell.') && /智能体|会话|\bagents?\b|[—–]/i.test(text!)
			);
			expect(violations).toEqual([]);
		}
	);
});
