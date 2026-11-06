import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeCommands } from '../../../renderer/hooks/input/useNativeCommands';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { createMockSession } from '../../helpers/mockSession';
import type { NativeCommandSnapshot } from '../../../shared/nativeCommands';

let counter = 0;
const command = (name: string): NativeCommandSnapshot => ({
	commands: [{ command: `/${name}`, description: name, source: 'user' }],
});
beforeEach(() => {
	useSettingsStore.setState({ newShell: true });
});
afterEach(cleanup);

describe('native command refresh in the composer', () => {
	it('leaves the classic shell discovery unchanged', () => {
		useSettingsStore.setState({ newShell: false });
		window.maestro.agents.getNativeCommands = vi.fn();
		renderHook(() => useNativeCommands(createMockSession(), true));
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
