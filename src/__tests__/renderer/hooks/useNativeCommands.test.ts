import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useNativeCommands } from '../../../renderer/hooks/input/useNativeCommands';
import { activeSessionChromeEquality } from '../../../renderer/stores/sessionEquality';
import { selectActiveSession, useSessionStore } from '../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { createMockSession } from '../../helpers/mockSession';
import { resetStores } from '../../helpers/resetStores';
import type { NativeCommandSnapshot } from '../../../shared/nativeCommands';

let counter = 0;
const command = (name: string): NativeCommandSnapshot => ({
	commands: [{ command: `/${name}`, description: name, source: 'user' }],
});
beforeEach(() => {
	resetStores(useSessionStore, useSettingsStore);
	useSettingsStore.setState({ newShell: true });
});
afterEach(cleanup);

describe('native command refresh in the composer', () => {
	it.each([true, false])(
		'uses the updated account when the shell keeps its old session snapshot (menu open: %s)',
		async (open) => {
			const reported = { command: '/plugin:review', description: '', source: 'reported' as const };
			const session = createMockSession({
				cwd: `/temporary/composer-${++counter}`,
				customEnvVars: { CLAUDE_CONFIG_DIR: '/temporary/account-a' },
				agentCommands: [reported],
			});
			useSessionStore.setState({ sessions: [session], activeSessionId: session.id });
			const read = vi.fn().mockImplementation(async (context) => ({
				commands:
					context.customEnvVars?.CLAUDE_CONFIG_DIR === '/temporary/account-a'
						? [reported]
						: command('account-b').commands,
			}));
			window.maestro.agents.getNativeCommands = read;
			const { result, rerender } = renderHook(
				({ open }) => {
					const current = useStoreWithEqualityFn(
						useSessionStore,
						selectActiveSession,
						activeSessionChromeEquality
					);
					return { session: current, ...useNativeCommands(current, open) };
				},
				{ initialProps: { open: true } }
			);
			await waitFor(() => expect(result.current.commands).toContainEqual(reported));
			rerender({ open });
			const customEnvVars = { CLAUDE_CONFIG_DIR: '/temporary/account-b' };
			act(() => {
				useSessionStore
					.getState()
					.setSessions((sessions) =>
						sessions.map((s) => (s.id === session.id ? { ...s, customEnvVars } : s))
					);
			});
			expect(useSessionStore.getState().sessions[0].customEnvVars).toEqual(customEnvVars);
			expect(result.current.session).toBe(session);
			// The legacy report stays on the session, but cannot enter the new account's list.
			expect(useSessionStore.getState().sessions[0].agentCommands).toEqual([reported]);
			expect(result.current.commands).not.toContainEqual(reported);
			await waitFor(() => expect(result.current.commands).toEqual(command('account-b').commands));
			expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ customEnvVars }));
			rerender({ open: true });
			await waitFor(() => expect(result.current.commands).toEqual(command('account-b').commands));
		}
	);

	it('refreshes an already open menu when the provider reports plugin commands', async () => {
		const session = createMockSession({ cwd: `/temporary/composer-${++counter}` });
		const read = vi.fn().mockResolvedValue(command('initial'));
		window.maestro.agents.getNativeCommands = read;
		const { result, rerender } = renderHook(({ current }) => useNativeCommands(current, true), {
			initialProps: { current: session },
		});
		await waitFor(() => expect(result.current.commands[0]?.command).toBe('/initial'));
		read.mockResolvedValue(command('plugin:review'));
		rerender({
			current: { ...session, agentCommands: [{ command: '/plugin:review', description: '' }] },
		});
		await waitFor(() => expect(result.current.commands[0]?.command).toBe('/plugin:review'));
	});

	it('leaves the classic shell discovery unchanged', () => {
		useSettingsStore.setState({ newShell: false });
		const session = createMockSession({ customEnvVars: { CLAUDE_CONFIG_DIR: '/temporary/a' } });
		useSessionStore.setState({ sessions: [session] });
		window.maestro.agents.getNativeCommands = vi.fn();
		const render = vi.fn();
		renderHook(() => {
			render();
			return useNativeCommands(session, true);
		});
		const renders = render.mock.calls.length;
		act(() => {
			useSessionStore.getState().updateSession(session.id, {
				customEnvVars: { CLAUDE_CONFIG_DIR: '/temporary/b' },
			});
		});
		expect(render).toHaveBeenCalledTimes(renders);
		expect(window.maestro.agents.getNativeCommands).not.toHaveBeenCalled();
	});
	it('shows cached commands while refreshing and checks again on reopen', async () => {
		const session = createMockSession({ cwd: `/temporary/composer-${++counter}` });
		let complete!: (result: NativeCommandSnapshot) => void;
		const read = vi
			.fn()
			.mockResolvedValueOnce(command('cached'))
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						complete = resolve;
					})
			);
		window.maestro.agents.getNativeCommands = read;
		const { result, rerender } = renderHook(({ open }) => useNativeCommands(session, open), {
			initialProps: { open: true },
		});
		await waitFor(() => expect(result.current.commands[0]?.command).toBe('/cached'));
		await act(async () => {
			complete(command('fresh'));
		});
		expect(result.current.commands[0].command).toBe('/fresh');
		rerender({ open: false });
		expect(read).toHaveBeenCalledTimes(2);
		read.mockResolvedValueOnce(command('fresh')).mockResolvedValueOnce(command('added'));
		rerender({ open: true });
		expect(result.current.commands[0].command).toBe('/fresh');
		await waitFor(() => expect(result.current.commands[0].command).toBe('/added'));
		expect(read).toHaveBeenCalledTimes(4);
	});
	it('discards a delayed response after switching accounts', async () => {
		const session = createMockSession({
			cwd: `/temporary/composer-${++counter}`,
			customEnvVars: { CLAUDE_CONFIG_DIR: '/temporary/a' },
		});
		let complete!: (result: NativeCommandSnapshot) => void;
		window.maestro.agents.getNativeCommands = vi
			.fn()
			.mockResolvedValueOnce(command('a-cached'))
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						complete = resolve;
					})
			)
			.mockResolvedValueOnce(command('b-cached'))
			.mockResolvedValueOnce(command('b'));
		const { result, rerender } = renderHook(({ current }) => useNativeCommands(current, true), {
			initialProps: { current: session },
		});
		await waitFor(() => expect(result.current.commands[0]?.command).toBe('/a-cached'));
		rerender({ current: { ...session, customEnvVars: { CLAUDE_CONFIG_DIR: '/temporary/b' } } });
		expect(result.current.commands.some((c) => c.command === '/a-cached')).toBe(false);
		await waitFor(() => expect(result.current.commands[0]?.command).toBe('/b'));
		await act(async () => {
			complete(command('late-a'));
		});
		expect(result.current.commands[0].command).toBe('/b');
	});
});
