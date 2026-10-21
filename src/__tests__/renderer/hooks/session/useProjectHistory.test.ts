import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
	useProjectHistory,
	PROJECT_HISTORY_DEBOUNCE_MS,
	PROJECT_HISTORY_MIN_INTERVAL_MS,
} from '../../../../renderer/hooks/session/useProjectHistory';
import type { ProjectHistoryResult, ProjectHistoryScope } from '../../../../shared/projectHistory';
import type { Session } from '../../../../renderer/types';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';

function scope(projectKey: string): ProjectHistoryScope {
	return { projectKey, projectPath: `/${projectKey}`, ownerIds: [] };
}

function result(projectKey: string): ProjectHistoryResult {
	return {
		conversations: [
			{
				key: `k-${projectKey}`,
				projectKey,
				projectPath: `/${projectKey}`,
				provider: 'codex',
				nativeSessionId: `n-${projectKey}`,
				title: projectKey,
				preview: '',
				createdAt: 1,
				modifiedAt: 2,
				messageCount: 1,
				starred: false,
			},
		],
		errors: [],
	};
}

let api: ReturnType<typeof vi.fn>;
let previousAgentSessions: unknown;

beforeEach(() => {
	vi.useFakeTimers();
	api = vi.fn();
	previousAgentSessions = (window.maestro as any).agentSessions;
	(window.maestro as any).agentSessions = {
		...(previousAgentSessions as object),
		listProjectHistory: api,
	};
});

afterEach(() => {
	(window.maestro as any).agentSessions = previousAgentSessions;
	vi.useRealTimers();
});

describe('useProjectHistory', () => {
	it('never lets a scan for the old scopes replace the result for the new ones', async () => {
		let resolveOld!: (value: ProjectHistoryResult) => void;
		api.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)));
		api.mockImplementationOnce(async () => result('new'));
		const sessions: Session[] = [];
		const { result: hook, rerender } = renderHook(
			({ scopes }) => useProjectHistory(scopes, JSON.stringify(scopes), sessions),
			{ initialProps: { scopes: [scope('old')] } }
		);

		await act(async () => {
			vi.advanceTimersByTime(PROJECT_HISTORY_DEBOUNCE_MS);
		});
		expect(api).toHaveBeenCalledTimes(1);
		expect(hook.current.status).toBe('loading');

		rerender({ scopes: [scope('new')] });
		await act(async () => {
			vi.advanceTimersByTime(PROJECT_HISTORY_DEBOUNCE_MS);
		});
		expect(api).toHaveBeenLastCalledWith([scope('new')]);
		expect(hook.current.conversations.map((c) => c.projectKey)).toEqual(['new']);

		await act(async () => {
			resolveOld(result('old'));
		});
		expect(hook.current.conversations.map((c) => c.projectKey)).toEqual(['new']);
	});

	it('rescans when a turn finishes, but not while it streams', async () => {
		api.mockResolvedValue(result('p'));
		const idle = createMockSession({ aiTabs: [createMockAITab({ id: 't', state: 'idle' })] });
		const busy = { ...idle, aiTabs: [{ ...idle.aiTabs[0], state: 'busy' as const }] };
		const { rerender } = renderHook(
			({ sessions }) => useProjectHistory([scope('p')], 'p', sessions),
			{ initialProps: { sessions: [idle] } }
		);
		await act(async () => {
			vi.advanceTimersByTime(PROJECT_HISTORY_DEBOUNCE_MS);
		});
		expect(api).toHaveBeenCalledTimes(1);

		rerender({ sessions: [busy] });
		rerender({ sessions: [{ ...busy }] });
		await act(async () => {
			vi.advanceTimersByTime(PROJECT_HISTORY_MIN_INTERVAL_MS * 2);
		});
		// Starting a turn schedules nothing new beyond the bounded refresh window.
		const afterStart = api.mock.calls.length;

		rerender({ sessions: [idle] });
		await act(async () => {
			vi.advanceTimersByTime(PROJECT_HISTORY_MIN_INTERVAL_MS);
		});
		expect(api.mock.calls.length).toBe(afterStart + 1);
	});

	it('reports unavailable when this build has no history bridge', () => {
		(window.maestro as any).agentSessions = { ...(previousAgentSessions as object) };
		delete (window.maestro as any).agentSessions.listProjectHistory;
		const { result: hook } = renderHook(() => useProjectHistory([], '[]', []));
		expect(hook.current.status).toBe('unavailable');
	});
});
