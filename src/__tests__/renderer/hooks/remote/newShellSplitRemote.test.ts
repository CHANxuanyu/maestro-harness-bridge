import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { resetStores } from '../../../helpers/resetStores';
import { useAppRemoteEventListeners } from '../../../../renderer/hooks/remote/useAppRemoteEventListeners';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';

const { split, unsplit } = vi.hoisted(() => ({ split: vi.fn(), unsplit: vi.fn() }));
vi.mock('../../../../renderer/services/newShellSplit', () => ({
	splitConversation: split,
	unsplitConversation: unsplit,
}));

const ack = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	resetStores(useSessionStore, useSettingsStore);
	useSettingsStore.setState({ newShell: true });
	useSessionStore.setState({
		activeSessionId: 'first',
		sessions: ['first', 'second'].map((id) =>
			createMockSession({
				id,
				cwd: '/project',
				activeTabId: `${id}-conversation`,
				aiTabs: [createMockAITab({ id: `${id}-conversation` })],
			})
		),
	});
	Object.assign(window.maestro.process, { sendRemoteUpdateSessionConfigResponse: ack });
	split.mockResolvedValue(undefined);
	unsplit.mockResolvedValue(undefined);
	renderHook(() =>
		useAppRemoteEventListeners({
			sessionsRef: {
				get current() {
					return useSessionStore.getState().sessions;
				},
			},
			setActiveSessionId: useSessionStore.getState().setActiveSessionId,
			setSessions: useSessionStore.getState().setSessions,
			setGroups: useSessionStore.getState().setGroups,
			handleOpenFileTab: vi.fn(),
			refreshFileTree: vi.fn(),
			handleAutoRunRefresh: vi.fn(),
			startBatchRun: vi.fn(),
			stopBatchRun: vi.fn(),
			resumeAfterError: vi.fn(),
			skipCurrentDocument: vi.fn(),
			abortBatchOnError: vi.fn(),
		})
	);
});

describe('new shell split CLI bridge', () => {
	it('uses the shared split action and waits for persistence before acknowledging', async () => {
		let finish!: () => void;
		split.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:remoteUpdateSessionConfig', {
					detail: {
						sessionId: 'second',
						responseChannel: 'ack',
						configPatch: {
							tabId: 'second-conversation',
							newShellSplitAction: 'split',
							newShellSplitRatio: 0.6,
						},
					},
				})
			)
		);
		expect(split).toHaveBeenCalledWith('second', 'second-conversation', 0.6);
		expect(ack).not.toHaveBeenCalled();
		await act(async () => finish());
		expect(ack).toHaveBeenCalledWith('ack', { success: true });
		expect(useSessionStore.getState().sessions[1].aiTabs[0]).not.toHaveProperty(
			'newShellSplitAction'
		);
	});

	it('uses the shared unsplit action', async () => {
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:remoteUpdateSessionConfig', {
					detail: {
						sessionId: 'first',
						responseChannel: 'ack',
						configPatch: { tabId: 'first-conversation', newShellSplitAction: 'unsplit' },
					},
				})
			)
		);
		await waitFor(() => expect(ack).toHaveBeenCalledWith('ack', { success: true }));
		expect(unsplit).toHaveBeenCalledOnce();
		expect(split).not.toHaveBeenCalled();
	});

	it('returns the service rejection without claiming success', async () => {
		split.mockRejectedValueOnce(new Error('窗口太窄，无法分屏'));
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:remoteUpdateSessionConfig', {
					detail: {
						sessionId: 'second',
						responseChannel: 'ack',
						configPatch: { tabId: 'second-conversation', newShellSplitAction: 'split' },
					},
				})
			)
		);
		await waitFor(() =>
			expect(ack).toHaveBeenCalledWith('ack', {
				success: false,
				error: '窗口太窄，无法分屏',
			})
		);
	});

	it.each([
		{ newShellSplitAction: 'unknown' },
		{ newShellSplitAction: 'split', newShellSplitRatio: 'wide' },
		{ newShellSplitAction: 'split', customModel: 'must-not-write' },
	])('rejects malformed or mixed split requests: %j', async (patch) => {
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:remoteUpdateSessionConfig', {
					detail: {
						sessionId: 'second',
						responseChannel: 'ack',
						configPatch: { tabId: 'second-conversation', ...patch },
					},
				})
			)
		);
		await waitFor(() =>
			expect(ack).toHaveBeenCalledWith('ack', {
				success: false,
				error: expect.any(String),
			})
		);
		expect(split).not.toHaveBeenCalled();
		expect(unsplit).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessions[1].aiTabs[0].customModel).not.toBe('must-not-write');
	});
});
