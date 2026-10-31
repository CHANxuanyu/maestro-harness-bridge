import { useT } from '../../../i18n';
import React, { RefObject } from 'react';
import { AlertCircle, Loader2, UserX } from 'lucide-react';
import { Spinner } from '../../ui/Spinner';
import type { Theme } from '../../../types';
import type { SessionMessage, SessionReadError } from '../../../hooks/agent/useSessionViewer';
import { EmptyStatePlaceholder } from '../../ui/EmptyStatePlaceholder';
import { SessionMessageBubble } from './SessionMessageBubble';

interface SessionMessagesViewProps {
	messages: SessionMessage[];
	messagesLoading: boolean;
	/** Why the session could not be read; shown only while nothing is on screen. */
	messagesError?: SessionReadError | null;
	hasMoreMessages: boolean;
	theme: Theme;
	messagesContainerRef: RefObject<HTMLDivElement>;
	onScroll: React.UIEventHandler<HTMLDivElement>;
	onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
	handleLoadMore: () => void;
}

export const SessionMessagesView = React.memo(function SessionMessagesView({
	messages,
	messagesLoading,
	messagesError,
	hasMoreMessages,
	theme,
	messagesContainerRef,
	onScroll,
	onKeyDown,
	handleLoadMore,
}: SessionMessagesViewProps) {
	const uiText = useT();
	return (
		<div
			ref={messagesContainerRef}
			className="flex-1 overflow-y-auto p-6 space-y-4 outline-none scrollbar-thin"
			onScroll={onScroll}
			onKeyDown={onKeyDown}
			tabIndex={0}
			role="region"
			aria-label={uiText('workflows.sessions.sessionMessages')}
		>
			{hasMoreMessages && (
				<div className="text-center py-2">
					{messagesLoading ? (
						<Loader2
							className="w-5 h-5 animate-spin mx-auto"
							style={{ color: theme.colors.textDim }}
						/>
					) : (
						<button
							onClick={handleLoadMore}
							className="text-sm hover:underline"
							style={{ color: theme.colors.accent }}
						>
							{uiText('workflows.sessions.loadEarlierMessages')}
						</button>
					)}
				</div>
			)}

			{messages.map((msg, idx) => (
				<SessionMessageBubble key={msg.uuid || idx} message={msg} index={idx} theme={theme} />
			))}

			{messagesError && !messagesLoading && messages.length === 0 && (
				<EmptyStatePlaceholder
					theme={theme}
					icon={
						messagesError === 'account-unavailable' ? (
							<UserX className="w-12 h-12" />
						) : (
							<AlertCircle className="w-12 h-12" />
						)
					}
					title={uiText(
						messagesError === 'account-unavailable'
							? 'workflows.sessions.accountUnavailable'
							: 'workflows.sessions.loadMessagesFailed'
					)}
					description={
						messagesError === 'account-unavailable'
							? uiText('workflows.sessions.accountUnavailableDetail')
							: undefined
					}
				/>
			)}

			{messagesLoading && messages.length === 0 && (
				<div className="flex items-center justify-center py-8">
					<Spinner size={24} color={theme.colors.textDim} />
				</div>
			)}
		</div>
	);
});
