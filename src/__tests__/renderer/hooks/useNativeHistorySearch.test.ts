import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNativeHistorySearch } from '../../../renderer/hooks/session/useNativeHistorySearch';
import { useConversationArchiveStore } from '../../../renderer/stores/conversationArchiveStore';
import type { ArchivedConversation } from '../../../shared/conversationArchive';
const archived: ArchivedConversation = {
	key: 'native-conversation',
	provider: 'codex',
	nativeSessionId: 'native-id',
	projectKey: 'project',
	projectPath: '/project',
	title: 'Archive this conversation',
	preview: '',
	createdAt: 1,
	modifiedAt: 1,
	messageCount: 1,
	starred: false,
	permissionMode: 'readonly',
	archivedAt: 2,
	ownerIds: [],
};
const hit = {
	conversation: archived,
	matchPreview: 'needle',
	message: { role: 'user' as const, text: 'needle' },
};
const search = vi.fn();
const cancel = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
	vi.useFakeTimers();
	search.mockReset();
	cancel.mockClear();
	useConversationArchiveStore.setState({ records: [] });
	Object.assign(window.maestro.agentSessions, {
		searchNativeHistory: search,
		cancelNativeHistorySearch: cancel,
	});
});
afterEach(() => vi.useRealTimers());
it('debounces 250ms, cancels the previous request and discards its late reply', async () => {
	let finishOld: (value: unknown) => void = () => {};
	search
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishOld = resolve;
				})
		)
		.mockResolvedValueOnce({ hits: [], truncated: true });
	const hook = renderHook(({ query }) => useNativeHistorySearch(query, true), {
		initialProps: { query: 'old' },
	});
	await act(async () => {
		vi.advanceTimersByTime(249);
	});
	expect(search).not.toHaveBeenCalled();
	await act(async () => {
		vi.advanceTimersByTime(1);
	});
	expect(search).toHaveBeenCalledTimes(1);
	expect(hook.result.current.searching).toBe(true);
	hook.rerender({ query: 'new' });
	expect(cancel).toHaveBeenCalledWith(search.mock.calls[0][0].requestId);
	await act(async () => {
		vi.advanceTimersByTime(250);
	});
	await act(async () => {
		finishOld({ hits: [{ matchPreview: 'stale' }], truncated: false });
	});
	expect(hook.result.current.result).toEqual({ hits: [], truncated: true });
	hook.rerender({ query: '' });
	expect(hook.result.current.result.hits).toEqual([]);
	expect(hook.result.current.searching).toBe(false);
});
it('does no content search for one character or the old shell', async () => {
	const hook = renderHook(({ query, enabled }) => useNativeHistorySearch(query, enabled), {
		initialProps: { query: 'a', enabled: true },
	});
	await act(async () => {
		vi.advanceTimersByTime(1000);
	});
	hook.rerender({ query: 'needle', enabled: false });
	act(() => useConversationArchiveStore.setState({ records: [archived] }));
	await act(async () => {
		vi.advanceTimersByTime(1000);
	});
	expect(search).not.toHaveBeenCalled();
});

it('refreshes an unchanged query after archive and unarchive broadcasts', async () => {
	search
		.mockResolvedValueOnce({ hits: [hit], truncated: false })
		.mockResolvedValueOnce({ hits: [], truncated: false })
		.mockResolvedValueOnce({ hits: [hit], truncated: false });
	const hook = renderHook(() => useNativeHistorySearch('needle', true));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(250);
	});
	expect(hook.result.current.result.hits).toEqual([hit]);
	act(() => useConversationArchiveStore.setState({ records: [archived] }));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(250);
	});
	expect(search).toHaveBeenCalledTimes(2);
	expect(hook.result.current.result.hits).toEqual([]);
	act(() => useConversationArchiveStore.setState({ records: [{ ...archived, archived: false }] }));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(250);
	});
	expect(search).toHaveBeenCalledTimes(3);
	expect(hook.result.current.result.hits).toEqual([hit]);
	expect(search.mock.calls.map(([request]) => request.query)).toEqual([
		'needle',
		'needle',
		'needle',
	]);
});

it('cancels a search overtaken by an archive change and ignores its late result', async () => {
	let finishOld: (value: unknown) => void = () => {};
	search
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishOld = resolve;
				})
		)
		.mockResolvedValueOnce({ hits: [], truncated: false });
	const hook = renderHook(() => useNativeHistorySearch('needle', true));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(250);
	});
	act(() => useConversationArchiveStore.setState({ records: [archived] }));
	expect(cancel).toHaveBeenCalledWith(search.mock.calls[0][0].requestId);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(250);
	});
	await act(async () => {
		finishOld({ hits: [hit], truncated: false });
	});
	expect(hook.result.current.result.hits).toEqual([]);
	expect(hook.result.current.searching).toBe(false);
});
