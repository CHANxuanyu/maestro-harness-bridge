import { useState, useEffect, useRef } from 'react';
import { logger } from '../../../utils/logger';
import { captureException } from '../../../utils/sentry';
import { isAccountUnavailableError } from '../../../../shared/accountUnavailableError';
import type { SearchMode, SearchResult } from '../types';

interface UseAgentSessionsSearchArgs {
	search: string;
	searchMode: SearchMode;
	projectPathForSessions: string | undefined;
	agentId: string;
	sshRemoteId: string | undefined;
	ownerAgentId?: string;
}

export function useAgentSessionsSearch({
	search,
	searchMode,
	projectPathForSessions,
	agentId,
	sshRemoteId,
	ownerAgentId,
}: UseAgentSessionsSearchArgs): {
	searchResults: SearchResult[];
	isSearching: boolean;
	/** The agent's selected account could not be read, so no results is not "no matches". */
	searchError: 'account-unavailable' | null;
} {
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [searchError, setSearchError] = useState<'account-unavailable' | null>(null);
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current);
		}

		// Title search filters in-memory - no IPC needed
		if (searchMode === 'title' || !search.trim()) {
			setSearchResults([]);
			setIsSearching(false);
			setSearchError(null);
			return;
		}

		// A result from the previous account or query cannot replace the current search.
		let active = true;
		setIsSearching(true);
		searchTimeoutRef.current = setTimeout(async () => {
			if (!projectPathForSessions || !search.trim()) {
				setSearchResults([]);
				setIsSearching(false);
				return;
			}

			try {
				const results = await window.maestro.agentSessions.search(
					agentId,
					projectPathForSessions,
					search,
					searchMode,
					sshRemoteId,
					{ ownerAgentId }
				);
				if (!active) return;
				setSearchResults(results);
				setSearchError(null);
			} catch (error) {
				if (!active) return;
				setSearchResults([]);
				// A missing account is an expected state with its own message.
				if (isAccountUnavailableError(error)) {
					setSearchError('account-unavailable');
					return;
				}
				setSearchError(null);
				logger.error('Search failed:', undefined, error);
				captureException(error, {
					extra: { fn: 'useAgentSessionsSearch', agentId, projectPathForSessions },
				});
				setSearchResults([]);
			} finally {
				if (active) setIsSearching(false);
			}
		}, 300);

		return () => {
			active = false;
			if (searchTimeoutRef.current) {
				clearTimeout(searchTimeoutRef.current);
			}
		};
	}, [search, searchMode, projectPathForSessions, agentId, sshRemoteId, ownerAgentId]);

	return { searchResults, isSearching, searchError };
}
