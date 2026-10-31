import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { logger } from '../../utils/logger';
import { isAccountUnavailableError } from '../../../shared/accountUnavailableError';

/**
 * Session message from Claude session JSONL files
 */
export interface SessionMessage {
	type: string;
	role?: string;
	content: string;
	timestamp: string;
	uuid: string;
	toolUse?: any;
	/** Base64 data URLs reconstructed from image content blocks in the transcript. */
	images?: string[];
}

/**
 * Agent session metadata (used for session browser)
 */
export interface AgentSession {
	sessionId: string;
	projectPath: string;
	timestamp: string;
	modifiedAt: string;
	firstMessage: string;
	messageCount: number;
	sizeBytes: number;
	costUsd?: number; // Optional - some sessions may not have cost data
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	durationSeconds: number;
	origin?: 'user' | 'auto';
	sessionName?: string;
}

/**
 * @deprecated Use AgentSession instead
 */
export type ClaudeSession = AgentSession;

/**
 * Dependencies for useSessionViewer hook
 */
export interface UseSessionViewerDeps {
	/** Current working directory for the active session */
	cwd: string | undefined;
	/** Agent ID for the session (e.g., 'claude-code', 'opencode') */
	agentId?: string;
	/** Optional SSH remote ID for accessing sessions on a remote host */
	sshRemoteId?: string;
	/** Owning Maestro agent, selecting the same account as history pagination. */
	ownerAgentId?: string;
}

/**
 * Why the open session's messages could not be read. `account-unavailable`:
 * the agent's selected account dir is missing, which is not the same as the
 * session being empty.
 */
export type SessionReadError = 'account-unavailable' | 'failed';

/**
 * Return type for useSessionViewer hook
 */
export interface UseSessionViewerReturn {
	/** Currently viewed session (null when showing list view) */
	viewingSession: AgentSession | null;
	/** Messages loaded for the current session */
	messages: SessionMessage[];
	/** Whether messages are currently loading */
	messagesLoading: boolean;
	/** Why the last read of the open session failed, or null */
	messagesError: SessionReadError | null;
	/** Whether there are more messages to load */
	hasMoreMessages: boolean;
	/** Total number of messages in the session */
	totalMessages: number;
	/** Current offset for pagination */
	messagesOffset: number;
	/** Ref to the messages container for scroll handling */
	messagesContainerRef: React.RefObject<HTMLDivElement>;
	/** Load messages for a session (with optional offset for pagination) */
	loadMessages: (session: AgentSession, offset?: number) => Promise<void>;
	/** Start viewing a session (loads messages and sets viewingSession) */
	handleViewSession: (session: AgentSession) => void;
	/** Load more messages (older messages) */
	handleLoadMore: () => void;
	/** Handle scroll event for lazy loading */
	handleMessagesScroll: () => void;
	/** Clear the viewing session and return to list */
	clearViewingSession: () => void;
	/** Setter for viewingSession (for updates like rename) */
	setViewingSession: React.Dispatch<React.SetStateAction<AgentSession | null>>;
}

/**
 * Hook for managing session viewer state and pagination
 *
 * Encapsulates the detail view functionality of the AgentSessionsBrowser:
 * - Viewing a single session's messages
 * - Lazy loading messages with pagination
 * - Scroll-based infinite loading
 *
 * @example
 * ```tsx
 * const {
 *   viewingSession,
 *   messages,
 *   messagesLoading,
 *   handleViewSession,
 *   handleMessagesScroll,
 *   clearViewingSession,
 * } = useSessionViewer({ cwd: activeSession?.cwd });
 *
 * // View a session
 * handleViewSession(session);
 *
 * // Return to list
 * clearViewingSession();
 * ```
 */
export function useSessionViewer({
	cwd,
	agentId = 'claude-code',
	sshRemoteId,
	ownerAgentId,
}: UseSessionViewerDeps): UseSessionViewerReturn {
	const [viewingSession, setViewingSession] = useState<AgentSession | null>(null);
	const [messages, setMessages] = useState<SessionMessage[]>([]);
	const [messagesLoading, setMessagesLoading] = useState(false);
	const [hasMoreMessages, setHasMoreMessages] = useState(false);
	const [totalMessages, setTotalMessages] = useState(0);
	const [messagesOffset, setMessagesOffset] = useState(0);
	const [messagesError, setMessagesError] = useState<SessionReadError | null>(null);

	const messagesContainerRef = useRef<HTMLDivElement>(null);

	// Bumped whenever what the preview shows is replaced (another session, the
	// list, another agent or account), so a read that lands afterwards cannot
	// paint the old session, its count or its error over the new one.
	const generationRef = useRef(0);

	// The agent, account, project and host the preview reads from. When it
	// changes, the open session belongs to another account: close it rather than
	// leave the previous account's transcript on screen. A layout effect, so the
	// stale preview is never painted.
	const scopeKey = [agentId, cwd ?? '', sshRemoteId ?? '', ownerAgentId ?? ''].join('\u0000');
	const scopeRef = useRef(scopeKey);
	useLayoutEffect(() => {
		if (scopeRef.current === scopeKey) return;
		scopeRef.current = scopeKey;
		generationRef.current++;
		setViewingSession(null);
		setMessages([]);
		setMessagesLoading(false);
		setMessagesError(null);
		setHasMoreMessages(false);
		setTotalMessages(0);
		setMessagesOffset(0);
	}, [scopeKey]);

	/**
	 * Load messages for a session with pagination support
	 * @param session - The session to load messages for
	 * @param offset - Offset for pagination (0 for initial load)
	 */
	const loadMessages = useCallback(
		async (session: AgentSession, offset: number = 0) => {
			if (!cwd) return;

			const generation = generationRef.current;
			setMessagesLoading(true);
			try {
				// Use the generic agentSessions API with agentId parameter
				// Pass sshRemoteId for SSH remote session access
				const result = await window.maestro.agentSessions.read(
					agentId,
					cwd,
					session.sessionId,
					{ offset, limit: 20, ownerAgentId },
					sshRemoteId
				);
				if (generation !== generationRef.current) return;

				if (offset === 0) {
					setMessages(result.messages);
					// Scroll to bottom after initial load and focus the container for keyboard nav
					requestAnimationFrame(() => {
						if (messagesContainerRef.current) {
							messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
							messagesContainerRef.current.focus();
						}
					});
				} else {
					// Prepend older messages
					setMessages((prev) => [...result.messages, ...prev]);
				}
				setTotalMessages(result.total);
				setHasMoreMessages(result.hasMore);
				setMessagesOffset(offset + result.messages.length);
			} catch (error) {
				if (generation !== generationRef.current) return;
				// A missing account is an expected state with its own message, not a
				// crash to report.
				if (isAccountUnavailableError(error)) {
					setMessagesError('account-unavailable');
				} else {
					logger.error('Failed to load messages:', undefined, error);
					setMessagesError('failed');
				}
			} finally {
				if (generation === generationRef.current) setMessagesLoading(false);
			}
		},
		[cwd, agentId, sshRemoteId, ownerAgentId]
	);

	/**
	 * Start viewing a session - resets state and loads messages
	 */
	const handleViewSession = useCallback(
		(session: AgentSession) => {
			generationRef.current++;
			setViewingSession(session);
			setMessages([]);
			setMessagesOffset(0);
			setMessagesError(null);
			loadMessages(session, 0);
		},
		[loadMessages]
	);

	/**
	 * Load more (older) messages
	 */
	const handleLoadMore = useCallback(() => {
		if (viewingSession && hasMoreMessages && !messagesLoading) {
			loadMessages(viewingSession, messagesOffset);
		}
	}, [viewingSession, hasMoreMessages, messagesLoading, messagesOffset, loadMessages]);

	/**
	 * Handle scroll event for infinite loading
	 * Loads more messages when scrolled near the top
	 */
	const handleMessagesScroll = useCallback(() => {
		const container = messagesContainerRef.current;
		if (!container) return;

		// Load more when scrolled near top
		if (container.scrollTop < 100 && hasMoreMessages && !messagesLoading) {
			const prevScrollHeight = container.scrollHeight;
			handleLoadMore();

			// Maintain scroll position after loading
			requestAnimationFrame(() => {
				if (container) {
					container.scrollTop = container.scrollHeight - prevScrollHeight;
				}
			});
		}
	}, [hasMoreMessages, messagesLoading, handleLoadMore]);

	/**
	 * Clear viewing session and return to list view
	 */
	const clearViewingSession = useCallback(() => {
		generationRef.current++;
		setViewingSession(null);
		setMessages([]);
		setMessagesLoading(false);
		setMessagesError(null);
	}, []);

	return {
		viewingSession,
		messages,
		messagesLoading,
		messagesError,
		hasMoreMessages,
		totalMessages,
		messagesOffset,
		messagesContainerRef,
		loadMessages,
		handleViewSession,
		handleLoadMore,
		handleMessagesScroll,
		clearViewingSession,
		setViewingSession,
	};
}
