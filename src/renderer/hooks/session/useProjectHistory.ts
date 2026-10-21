/**
 * useProjectHistory - native conversations for the Left Bar's project tree.
 *
 * Main scans every registered provider and account for the scoped project
 * paths and returns metadata only (no transcript). This hook decides WHEN to
 * ask: on mount and scope change, when the window regains focus (a native CLI
 * run outside Maestro should appear without a restart), when a turn finishes
 * or a tab closes, and on a slow interval. Every trigger is debounced and
 * rate-limited, so streaming tokens never cause a scan.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '../../types';
import type {
	ProjectHistoryConversation,
	ProjectHistoryError,
	ProjectHistoryResult,
	ProjectHistoryScope,
} from '../../../shared/projectHistory';
import { useEventListener } from '../utils/useEventListener';

/** Quiet period before a scheduled refresh runs. */
export const PROJECT_HISTORY_DEBOUNCE_MS = 750;
/** Minimum gap between two automatic refreshes (an explicit retry ignores it). */
export const PROJECT_HISTORY_MIN_INTERVAL_MS = 5_000;
/** Background poll while the window is visible. */
export const PROJECT_HISTORY_POLL_MS = 120_000;

export type ProjectHistoryStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

export interface ProjectHistoryState {
	status: ProjectHistoryStatus;
	/** True while a refresh runs over data that is already on screen. */
	refreshing: boolean;
	conversations: ProjectHistoryConversation[];
	errors: ProjectHistoryError[];
	/** Set when the whole request failed. */
	failure: string | null;
	refresh: () => void;
}

type ListProjectHistory = (scopes: ProjectHistoryScope[]) => Promise<ProjectHistoryResult>;

/** The bridge method, when this build's preload exposes it. */
function listProjectHistoryApi(): ListProjectHistory | null {
	const api = (
		window as unknown as {
			maestro?: { agentSessions?: { listProjectHistory?: ListProjectHistory } };
		}
	).maestro?.agentSessions?.listProjectHistory;
	return typeof api === 'function' ? api : null;
}

/**
 * Changes when a turn ENDS or the set of open conversations changes (a tab
 * closed, a native id assigned), not when a turn starts or streams.
 */
export function historyRefreshSignal(sessions: Session[]): { ids: string; busy: Set<string> } {
	const ids: string[] = [];
	const busy = new Set<string>();
	for (const session of sessions) {
		for (const tab of session.aiTabs ?? []) {
			ids.push(`${session.id}:${tab.id}:${tab.agentSessionId ?? ''}`);
			if (tab.state === 'busy') busy.add(`${session.id}:${tab.id}`);
		}
	}
	return { ids: ids.join('|'), busy };
}

export function useProjectHistory(
	scopes: ProjectHistoryScope[],
	scopeKey: string,
	sessions: Session[]
): ProjectHistoryState {
	const [state, setState] = useState<Omit<ProjectHistoryState, 'refresh'>>(() => ({
		status: listProjectHistoryApi() ? 'idle' : 'unavailable',
		refreshing: false,
		conversations: [],
		errors: [],
		failure: null,
	}));
	const scopesRef = useRef(scopes);
	scopesRef.current = scopes;
	const requestRef = useRef(0);
	const lastRunRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);

	const run = useCallback(async () => {
		const api = listProjectHistoryApi();
		if (!api) {
			setState((prev) => ({ ...prev, status: 'unavailable', refreshing: false }));
			return;
		}
		const request = ++requestRef.current;
		lastRunRef.current = Date.now();
		const requestScopes = scopesRef.current;
		if (requestScopes.length === 0) {
			setState({
				status: 'ready',
				refreshing: false,
				conversations: [],
				errors: [],
				failure: null,
			});
			return;
		}
		setState((prev) => ({
			...prev,
			status: prev.status === 'ready' ? 'ready' : 'loading',
			refreshing: prev.status === 'ready',
		}));
		try {
			const result = await api(requestScopes);
			// A newer request (scope change, retry) owns the state now.
			if (!mountedRef.current || request !== requestRef.current) return;
			setState({
				status: 'ready',
				refreshing: false,
				conversations: result?.conversations ?? [],
				errors: result?.errors ?? [],
				failure: null,
			});
		} catch (error) {
			if (!mountedRef.current || request !== requestRef.current) return;
			const failure = error instanceof Error ? error.message : String(error);
			// Keep what was already loaded: a failed refresh must not empty the tree.
			setState((prev) => ({
				...prev,
				status: prev.conversations.length > 0 ? 'ready' : 'error',
				refreshing: false,
				failure,
			}));
		}
	}, []);

	const schedule = useCallback(
		(force = false) => {
			if (timerRef.current) clearTimeout(timerRef.current);
			const sinceLast = Date.now() - lastRunRef.current;
			const wait = force
				? PROJECT_HISTORY_DEBOUNCE_MS
				: Math.max(PROJECT_HISTORY_DEBOUNCE_MS, PROJECT_HISTORY_MIN_INTERVAL_MS - sinceLast);
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				void run();
			}, wait);
		},
		[run]
	);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			requestRef.current++;
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = null;
		};
	}, []);

	// Scope change (an agent added, a project moved): fetch promptly. Bumping
	// the request id first means a scan still running for the OLD scopes can
	// never land on top of the new ones.
	useEffect(() => {
		requestRef.current++;
		schedule(true);
	}, [scopeKey, schedule]);

	// Turn completion and tab set changes.
	const signal = historyRefreshSignal(sessions);
	const busyKey = [...signal.busy].join('|');
	const prevSignalRef = useRef(signal);
	useEffect(() => {
		const prev = prevSignalRef.current;
		prevSignalRef.current = signal;
		let finished = false;
		for (const key of prev.busy) {
			if (!signal.busy.has(key)) {
				finished = true;
				break;
			}
		}
		if (finished || prev.ids !== signal.ids) schedule();
		// `signal` is rebuilt every render; its two string projections are the identity.
	}, [signal.ids, busyKey, schedule]);

	useEventListener('focus', () => schedule(), { target: window });

	useEffect(() => {
		const id = setInterval(() => {
			if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
			schedule();
		}, PROJECT_HISTORY_POLL_MS);
		return () => clearInterval(id);
	}, [schedule]);

	const refresh = useCallback(() => {
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = null;
		void run();
	}, [run]);

	return { ...state, refresh };
}
