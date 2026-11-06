import { useEffect, useState } from 'react';
import { generateId } from '../../utils/ids';
import type { NativeHistorySearchResult } from '../../../shared/nativeHistorySearch';

/** Content searches are local and opt in; no work runs in the classic shell. */
export function useNativeHistorySearch(query: string, enabled: boolean) {
	const [state, setState] = useState<{
		query: string;
		result: NativeHistorySearchResult;
		searching: boolean;
	}>({ query: '', result: { hits: [], truncated: false }, searching: false });
	useEffect(() => {
		if (!enabled || query.trim().length < 2) {
			setState({ query, result: { hits: [], truncated: false }, searching: false });
			return;
		}
		let active = true;
		let started = false;
		const requestId = generateId();
		setState({ query, result: { hits: [], truncated: false }, searching: true });
		const timer = setTimeout(async () => {
			started = true;
			try {
				const result = await window.maestro.agentSessions.searchNativeHistory({ query, requestId });
				if (active) setState({ query, result, searching: false });
			} catch {
				if (active)
					setState({
						query,
						result: { hits: [], truncated: false, unavailable: true },
						searching: false,
					});
			}
		}, 250);
		return () => {
			active = false;
			clearTimeout(timer);
			if (started)
				void window.maestro.agentSessions.cancelNativeHistorySearch(requestId).catch(() => {});
		};
	}, [query, enabled]);
	return enabled && query.trim().length >= 2 && state.query === query
		? state
		: { result: { hits: [], truncated: false }, searching: false };
}
