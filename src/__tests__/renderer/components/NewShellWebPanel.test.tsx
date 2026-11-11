import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewShellWebPanel } from '../../../renderer/components/NewShellWebPanel';
import { applyNewShellWebAction, newShellWebViews } from '../../../renderer/services/newShellWeb';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { mockTheme } from '../../helpers/mockTheme';
import { resetStores } from '../../helpers/resetStores';

function Panel() {
	const session = useSessionStore((s) => s.sessions[0]);
	return <NewShellWebPanel key={session.activeTabId} session={session} theme={mockTheme} visible />;
}

beforeEach(() => {
	resetStores(useSessionStore, useSettingsStore);
	vi.clearAllMocks();
	useSettingsStore.setState({ newShell: true, uiLanguage: 'en' });
	useSessionStore.setState({
		activeSessionId: 'owner',
		sessions: [
			createMockSession({
				id: 'owner',
				activeTabId: 'one',
				aiTabs: [
					createMockAITab({
						id: 'one',
						newShellPanel: { tab: 'web', open: true, webUrl: 'http://localhost:5173/one' },
					}),
					createMockAITab({
						id: 'two',
						newShellPanel: { tab: 'web', open: true, webUrl: 'http://localhost:5173/two' },
					}),
				],
			}),
		],
	});
});
afterEach(cleanup);

describe('conversation web engine', () => {
	it('navigates the mounted engine from the CLI, reloads from either entry and opens externally', async () => {
		const { container } = render(<Panel />);
		const original = container.querySelector('webview')!;
		await act(() => applyNewShellWebAction('owner', 'one', 'web', 'http://localhost:5173/next'));
		expect((original as unknown as { src: string }).src).toBe('http://localhost:5173/next');
		expect(screen.getByRole('textbox', { name: 'Browser URL' })).toHaveValue(
			'http://localhost:5173/next'
		);
		fireEvent.click(screen.getByTitle('Reload'));
		const reloaded = container.querySelector('webview')!;
		expect(reloaded).not.toBe(original);
		expect(reloaded.getAttribute('src')).toBe('http://localhost:5173/next');
		await act(() => applyNewShellWebAction('owner', 'one', 'web-reload'));
		expect(container.querySelector('webview')).not.toBe(reloaded);
		await act(() => applyNewShellWebAction('owner', 'one', 'web-external'));
		expect(window.maestro.shell.openExternal).toHaveBeenCalledWith('http://localhost:5173/next');
	});
	it('routes address submission through the same action and preserves URLs after switching and serializing', () => {
		const { container, unmount } = render(<Panel />);
		const navigate = vi.spyOn(newShellWebViews.get(JSON.stringify(['owner', 'one']))!, 'navigate');
		fireEvent.change(screen.getByRole('textbox', { name: 'Browser URL' }), {
			target: { value: 'http://localhost:5173/edited' },
		});
		fireEvent.submit(container.querySelector('form')!);
		expect(navigate).toHaveBeenCalledWith('http://localhost:5173/edited');
		act(() =>
			useSessionStore
				.getState()
				.setSessions((sessions) => sessions.map((s) => ({ ...s, activeTabId: 'two' })))
		);
		expect(container.querySelector('webview')!.getAttribute('src')).toBe(
			'http://localhost:5173/two'
		);
		const restored = JSON.parse(JSON.stringify(useSessionStore.getState().sessions));
		unmount();
		expect(newShellWebViews.size).toBe(0);
		restored[0].activeTabId = 'one';
		useSessionStore.setState({ sessions: restored });
		render(<Panel />);
		expect(screen.getByRole('textbox', { name: 'Browser URL' })).toHaveValue(
			'http://localhost:5173/edited'
		);
	});
	it.each(['file:///tmp/private', 'javascript:alert(1)', 'http://'])(
		'rejects invalid panel navigation %s without mutation',
		async (url) => {
			const previous = useSessionStore.getState().sessions;
			await expect(applyNewShellWebAction('owner', 'one', 'web', url)).rejects.toThrow('HTTP');
			expect(useSessionStore.getState().sessions).toBe(previous);
		}
	);
	it.each(['web', 'web-reload', 'web-external'] as const)(
		'gates %s in the classic shell',
		async (action) => {
			useSettingsStore.setState({ newShell: false });
			await expect(applyNewShellWebAction('owner', 'one', action)).rejects.toThrow('new shell');
			expect(window.maestro.shell.openExternal).not.toHaveBeenCalled();
		}
	);
});
