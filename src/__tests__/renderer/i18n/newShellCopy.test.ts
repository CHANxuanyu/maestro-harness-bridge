import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../../../renderer/i18n/translate';
import { scanJsx, scanNewShellCopy } from './scanNewShellCopy.mjs';

describe('new shell copy audit', () => {
	it('keeps raw findings limited to reviewed names, key labels and hidden classic menus', () => {
		// FileTreeContextMenu tests separately prove Auto Run and Document Graph are hidden.
		expect(
			scanNewShellCopy().map((item: { file: string; kind: string; text: string }) => [
				item.file.split('/').pop(),
				item.kind,
				item.text,
			])
		).toEqual([
			['HamburgerMenuContent.tsx', 'expression', '⇧⌘N'],
			['HamburgerMenuContent.tsx', 'expression', '⌘K'],
			['HamburgerMenuContent.tsx', 'expression', '⌥⌘Y'],
			['EmptyConversationPicker.tsx', 'expression', 'DeepSeek'],
			['MainPanelHeader.tsx', 'expression', 'GIT'],
			['CommandModeBar.tsx', 'text', 'Tab'],
			['FileTreeContextMenu.tsx', 'expression', 'Stage Document for Auto Run'],
			['FileTreeContextMenu.tsx', 'expression', 'Stage'],
			['FileTreeContextMenu.tsx', 'expression', 'Documents for Auto Run'],
			['FileTreeContextMenu.tsx', 'text', 'Open'],
			['FileTreeContextMenu.tsx', 'text', 'in Document Graph'],
			['FileTreeContextMenu.tsx', 'text', 'Open in Document Graph'],
			['FileTreeContextMenu.tsx', 'text', 'Document Graph'],
			['FilePreview.tsx', 'text', 'jq'],
			['MediaViewer.tsx', 'text', 'x'],
			['TerminalTouchBar.tsx', 'aria-label', 'Escape'],
			['TerminalTouchBar.tsx', 'text', 'Esc'],
			['TerminalTouchBar.tsx', 'aria-label', 'Tab'],
			['TerminalTouchBar.tsx', 'text', 'Tab'],
			['TerminalTouchBar.tsx', 'aria-label', 'Control'],
			['TerminalTouchBar.tsx', 'text', 'Ctrl'],
			['TerminalTouchBar.tsx', 'aria-label', 'Enter'],
			['QuitConfirmModal.tsx', 'text', 'Tab'],
			['QuitConfirmModal.tsx', 'text', 'Enter'],
		]);
	});
	it('keeps file labels distinct from projects and avoids singular file grammar', () => {
		expect(CATALOGS.en['workflows.newShellCopy.panels.previewFolder']).toBe(
			'Preview files in folder ({count})'
		);
		expect(CATALOGS['zh-CN']['workflows.newShellCopy.panels.importOthers']).toBe(
			'仅导入不重名的文件和文件夹。'
		);
		expect(CATALOGS['zh-CN']['workflows.newShellCopy.panels.moveOthers']).toBe(
			'仅移动不重名的文件和文件夹。'
		);
	});

	it('localizes terminal search and context menus', () => {
		expect(
			scanNewShellCopy().filter(
				(item: { surface: string }) =>
					item.surface === 'terminal' &&
					!['Esc', 'Tab', 'Ctrl', 'Escape', 'Control', 'Enter'].includes(
						(item as { surface: string; text: string }).text
					)
			)
		).toEqual([]);
	});
	it('localizes remaining file preview JSX', () => {
		const audited = [
			'MarkdownImage.tsx',
			'MediaViewer.tsx',
			'FilePreviewActionsSheet.tsx',
			'MarkdownPreviewFast.tsx',
			'TextPreviewFast.tsx',
		];
		expect(
			scanNewShellCopy().filter(
				(item: { file: string; text: string }) =>
					audited.some((name) => item.file.endsWith(name)) && item.text !== 'x'
			)
		).toEqual([]);
	});
	it('localizes file operation feedback', () => {
		expect(scanNewShellCopy().filter((item: { kind: string }) => item.kind === 'feedback')).toEqual(
			[]
		);
	});
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
					(key.startsWith('workflows.newShell.') || key.startsWith('workflows.newShellCopy.')) &&
					/智能体|会话|\bagents?\b|[—–]/i.test(text!)
			);
			expect(violations).toEqual([]);
		}
	);
});
