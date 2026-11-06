import { useSettingsStore } from '../stores/settingsStore';
import { useState } from 'react';
import type { Session, AITab, Theme } from '../types';
import { getBasename } from '../../shared/formatters';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { sessionProviderId } from '../../shared/agentPresets';
import { useNewConversationTools, newShellConversation } from '../services/newShellConversation';

export function EmptyConversationPicker({
	session,
	tab,
	theme,
}: {
	session: Session;
	tab: AITab;
	theme: Theme;
}) {
	const tools = useNewConversationTools(session.id);
	const [pending, setPending] = useState(false);
	const newShell = useSettingsStore((s) => s.newShell);
	if (!newShell || tab.logs.length > 0 || tab.state !== 'idle') return null;
	return (
		<div
			className="flex-1 flex flex-col items-center pt-24 gap-4"
			data-testid="empty-conversation-picker"
		>
			<div className="text-base" style={{ color: theme.colors.textMain }}>
				{getBasename(session.projectRoot || session.cwd)}
			</div>
			<div className="flex items-center gap-4 text-sm" role="group" aria-label="Tools">
				{tools.map((provider) => (
					<button
						key={provider}
						aria-pressed={sessionProviderId(session) === provider}
						disabled={pending}
						className="px-2 py-1 rounded"
						style={{
							color:
								sessionProviderId(session) === provider
									? theme.colors.accent
									: theme.colors.textDim,
							background:
								sessionProviderId(session) === provider ? theme.colors.bgActivity : undefined,
						}}
						onClick={async () => {
							if (sessionProviderId(session) === provider) return;
							setPending(true);
							try {
								await newShellConversation(session.id, provider, tab.id);
							} finally {
								setPending(false);
							}
						}}
					>
						{provider === 'deepseek' ? 'DeepSeek' : getAgentDisplayName(provider)}
					</button>
				))}
			</div>
		</div>
	);
}
