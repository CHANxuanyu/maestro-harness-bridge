import { useState, useEffect, useRef } from 'react';
import { logger } from '../../../utils/logger';
import { captureException } from '../../../utils/sentry';
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
} {
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current);
		}

		// Title search filters in-memory - no IPC needed
		if (searchMode === 'title' || !search.trim()) {
			setSearchResults([]);
			setIsSearching(false);
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
			} catch (error) {
				if (!active) return;
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

	return { searchResults, isSearching };
}
