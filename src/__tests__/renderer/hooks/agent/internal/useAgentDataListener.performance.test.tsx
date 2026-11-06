import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAgentDataListener } from '../../../../../renderer/hooks/agent/internal/useAgentDataListener';
import { useBatchedSessionUpdates } from '../../../../../renderer/hooks/session/useBatchedSessionUpdates';
import { useSessionStore } from '../../../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../../../renderer/stores/settingsStore';
import { removeHiddenProgressLog } from '../../../../../renderer/hooks/agent/internal/helpers/exitTabCleanup';
import { buildHiddenProgressLogId } from '../../../../../renderer/utils/hiddenProgress';
import { createMockSession } from '../../../../helpers/mockSession';
import { createMockAITab } from '../../../../helpers/mockTab';
import type { LogEntry } from '../../../../../renderer/types';

vi.mock('../../../../../renderer/hooks/agent/internal/helpers/exitTabCleanup', async (original) => {
	const actual =
		await original<
			typeof import('../../../../../renderer/hooks/agent/internal/helpers/exitTabCleanup')
		>();
	return { ...actual, removeHiddenProgressLog: vi.fn(actual.removeHiddenProgressLog) };
});
let onData: (sessionId: string, data: string) => void;
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
	vi.mocked(removeHiddenProgressLog).mockClear();
	window.maestro.process.onData = vi.fn((callback) => {
		onData = callback;
		return vi.fn();
	});
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it.each([true, false])(
	'batches 100 Hz output without rescanning history per event (newShell=%s)',
	(newShell) => {
		useSettingsStore.setState({ newShell });
		const logs: LogEntry[] = Array.from({ length: 5000 }, (_, i) => ({
			id: `message-${i}`,
			source: i % 2 ? 'stdout' : 'user',
			timestamp: i,
			text: `Message ${i}`,
			delivered: i % 2 === 0,
		}));
		logs.push({
			id: buildHiddenProgressLogId('tab'),
			source: 'system',
			text: 'Working',
			timestamp: 6000,
		});
		const session = createMockSession({
			id: 'perf',
			activeTabId: 'tab',
			aiTabs: [createMockAITab({ id: 'tab', logs, showThinking: 'sticky' })],
		});
		useSessionStore.setState({ sessions: [session], activeSessionId: 'perf' });
		const updates: number[] = [];
		const unsubscribe = useSessionStore.subscribe((state, prev) => {
			if (state.sessions !== prev.sessions) updates.push(Date.now());
		});
		const { result } = renderHook(() => {
			const batchedUpdater = useBatchedSessionUpdates();
			useAgentDataListener({ batchedUpdater, activeHiddenToolRef: { current: new Map() } });
			return batchedUpdater;
		});
		const started = performance.now();
		act(() => onData('perf-ai-tab', ' chunk-0'));
		const immediateUpdates = updates.length;
		for (let i = 1; i < 300; i++) {
			act(() => {
				vi.advanceTimersByTime(10);
				onData('perf-ai-tab', ` chunk-${i}`);
			});
		}
		// Flush the last partial batch, as exit and error listeners do.
		act(() => result.current.flushNow());
		const cleanupPasses = vi.mocked(removeHiddenProgressLog).mock.calls.length;
		console.info(
			JSON.stringify({
				newShell,
				cleanupPasses,
				storeUpdates: updates.length,
				ms: performance.now() - started,
			})
		);
		const final = useSessionStore.getState().sessions[0];
		const finalLogs = final.aiTabs[0].logs;
		expect(finalLogs.some((log) => log.id === buildHiddenProgressLogId('tab'))).toBe(false);
		expect(finalLogs.slice(0, 5000)).toEqual(logs.slice(0, 5000));
		expect(
			finalLogs
				.slice(5000)
				.map((log) => log.text)
				.join('')
		).toBe(Array.from({ length: 300 }, (_, i) => ` chunk-${i}`).join(''));
		expect(immediateUpdates).toBe(newShell ? 0 : 1);
		expect(updates).toHaveLength(newShell ? 15 : 16);
		if (newShell) expect(cleanupPasses).toBeLessThanOrEqual(15);
		unsubscribe();
	}
);

it('flushes pending output on teardown after a shell switch without dropping another tab', () => {
	useSettingsStore.setState({ newShell: true });
	const makeTab = (id: string) =>
		createMockAITab({
			id,
			logs: [
				{ id: `user-${id}`, source: 'user', text: id, timestamp: 1 },
				{ id: buildHiddenProgressLogId(id), source: 'system', text: 'Working', timestamp: 2 },
			],
		});
	useSessionStore.setState({
		sessions: [
			createMockSession({ id: 'perf', activeTabId: 'a', aiTabs: [makeTab('a'), makeTab('b')] }),
		],
	});
	const hook = renderHook(() => {
		const batchedUpdater = useBatchedSessionUpdates();
		useAgentDataListener({ batchedUpdater, activeHiddenToolRef: { current: new Map() } });
	});
	act(() => onData('perf-ai-a', 'tail'));
	act(() => useSettingsStore.setState({ newShell: false }));
	hook.unmount();
	const [a, b] = useSessionStore.getState().sessions[0].aiTabs;
	expect(a.logs.map((log) => log.text)).toEqual(['a', 'tail']);
	expect(b.logs.map((log) => log.text)).toEqual(['b', 'Working']);
});
