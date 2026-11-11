import { describe, expect, it } from 'vitest';
import {
	changeNewShellPanel,
	patchNewShellPanel,
	shellRightPanelTab,
} from '../../shared/newShellPanel';

describe('conversation panel state', () => {
	it('persists the grouping choice across panel switches and restart without affecting other conversations', () => {
		const turn = changeNewShellPanel(undefined, 'changes-turns');
		expect(turn).toEqual({ tab: 'changes', open: true, changesView: 'turn' });
		const restored = JSON.parse(JSON.stringify(changeNewShellPanel(turn, 'files')));
		expect(changeNewShellPanel(restored, 'changes')).toEqual(turn);
		expect(changeNewShellPanel(restored, 'changes-files')).toEqual({
			...turn,
			changesView: 'file',
		});
		expect(changeNewShellPanel(undefined, 'changes')).toEqual({ tab: 'changes', open: true });
	});
	it.each([false, true])(
		'resolves keyboard and panel selection without changing classic preference, new shell %s',
		(newShell) => {
			expect(shellRightPanelTab('history', newShell, { tab: 'files' })).toBe(
				newShell ? 'files' : 'history'
			);
			expect(shellRightPanelTab('autorun', newShell, { tab: 'changes' })).toBe(
				newShell ? 'changes' : 'autorun'
			);
		}
	);
	it.each(['terminal', 'tasks', 'web'] as const)(
		'remembers %s without changing the classic shell',
		(tab) => {
			const panel = changeNewShellPanel(undefined, tab);
			expect(panel).toEqual({ tab, open: true });
			expect(shellRightPanelTab('history', true, panel)).toBe(tab);
			expect(shellRightPanelTab('history', false, panel)).toBe('history');
		}
	);
	it.each([false, true])('closing a terminal preserves tasks and open=%s', (open) => {
		const previous = { tab: 'tasks' as const, open, terminalTabId: 'closed', filter: 'keep' };
		expect(changeNewShellPanel(previous, 'terminal-close')).toEqual({
			...previous,
			terminalTabId: undefined,
		});
	});
	const file = { tab: 'files' as const, fileTabId: 'f', open: true, filter: 'src' };
	it('remembers a file across panel switches and a serialized restart', () => {
		const stored = JSON.parse(JSON.stringify(changeNewShellPanel(file, 'changes')));
		expect(changeNewShellPanel(stored, 'files')).toEqual(file);
		expect(changeNewShellPanel(file, 'close')).toEqual({ ...file, open: false });
		expect(changeNewShellPanel(changeNewShellPanel(file, 'close'), 'open')).toEqual(file);
	});
	it('back clears the file reference while preserving its filter', () => {
		expect(changeNewShellPanel(file, 'back')).toEqual({ ...file, fileTabId: undefined });
		expect(file.fileTabId).toBe('f');
	});
	it('a second conversation starts with independent panel state', () => {
		expect(patchNewShellPanel(undefined, { tab: 'changes' })).toEqual({ tab: 'changes' });
		expect(patchNewShellPanel(file, { filter: 'readme' })).toEqual({ ...file, filter: 'readme' });
	});
});
