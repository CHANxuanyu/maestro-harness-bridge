import { useT } from '../../../i18n';
import React from 'react';
import { List, Plus, X } from 'lucide-react';
import type { Theme } from '../../../types';
import { HeaderActionButton } from '../../ui/HeaderActionButton';

interface SessionListHeaderProps {
	agentId: string;
	sessionName: string | undefined;
	activeAgentSessionId: string | null;
	theme: Theme;
	onNewSession: () => void;
	onClose: () => void;
}

export const SessionListHeader = React.memo(function SessionListHeader({
	agentId,
	sessionName,
	activeAgentSessionId,
	theme,
	onNewSession,
	onClose,
}: SessionListHeaderProps) {
	const uiText = useT();
	return (
		<>
			<div className="flex items-center gap-4">
				<List className="w-5 h-5" style={{ color: theme.colors.textDim }} />
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					{agentId === 'claude-code' ? 'Claude' : uiText('workflows.sessions.history.agentLabel')}{' '}
					{uiText('workflows.sessions.sessionsFor')}{' '}
					{sessionName || uiText('workflows.sessions.history.agentLabel')}
				</span>
				{activeAgentSessionId && (
					<span
						className="text-xs px-2 py-0.5 rounded-full"
						style={{
							backgroundColor: theme.colors.accent + '20',
							color: theme.colors.accent,
						}}
					>
						{uiText('workflows.sessions.active')} {activeAgentSessionId.slice(0, 8)}...
					</span>
				)}
			</div>
			<div className="flex items-center gap-2">
				<HeaderActionButton theme={theme} onClick={onNewSession} icon={<Plus />}>
					{uiText('workflows.sessions.newSession')}
				</HeaderActionButton>
				<button
					onClick={onClose}
					aria-label={uiText('common.close')}
					className="p-2 rounded hover:bg-white/5 transition-colors"
					style={{ color: theme.colors.textDim }}
				>
					<X className="w-4 h-4" />
				</button>
			</div>
		</>
	);
});
