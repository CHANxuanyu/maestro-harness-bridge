import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNativeHistorySearch } from '../../../renderer/hooks/session/useNativeHistorySearch';
const search = vi.fn();
const cancel = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
	vi.useFakeTimers();
	search.mockReset();
	cancel.mockClear();
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
	await act(async () => {
		vi.advanceTimersByTime(1000);
	});
	expect(search).not.toHaveBeenCalled();
});
