import { useT } from '../../i18n';
/**
 * AgentResilienceSection - the two "Agent Resilience" auto-retry toggles shared
 * by the create (NewInstanceModal) and edit (EditAgentModal) agent dialogs.
 *
 * Styled to match the rest of the agent modals: a standard uppercase section
 * heading plus checkbox rows (see SshRemoteSelector for the checkbox pattern).
 *
 * Both toggles default ON. See `resilienceEnabled` in shared/agentConstants and
 * the retry engine in stores/retryStore.
 */

import React from 'react';

import type { Theme } from '../../types';

interface AgentResilienceSectionProps {
	theme: Theme;
	retryOnAvailabilityErrors: boolean;
	retryOnTokenExhaustion: boolean;
	onChangeAvailability: (value: boolean) => void;
	onChangeTokenExhaustion: (value: boolean) => void;
}

export function AgentResilienceSection({
	theme,
	retryOnAvailabilityErrors,
	retryOnTokenExhaustion,
	onChangeAvailability,
	onChangeTokenExhaustion,
}: AgentResilienceSectionProps): React.ReactElement {
	const uiText = useT();
	return (
		<div>
			<div
				className="block text-xs font-bold opacity-70 uppercase mb-2"
				style={{ color: theme.colors.textMain }}
			>
				{uiText('workflows.sessions.resilience')}
			</div>
			<p className="text-xs mb-2" style={{ color: theme.colors.textDim }}>
				{uiText('workflows.sessions.resilienceHelp')}
			</p>

			<div className="space-y-2">
				<label
					className="flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-white/5"
					style={{ backgroundColor: theme.colors.bgActivity }}
				>
					<input
						type="checkbox"
						checked={retryOnAvailabilityErrors}
						onChange={(e) => onChangeAvailability(e.target.checked)}
						className="mt-0.5 accent-current"
						style={{ accentColor: theme.colors.accent }}
						aria-label={uiText('workflows.sessions.retryAvailability')}
					/>
					<div className="flex flex-col min-w-0">
						<span className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
							{uiText('workflows.sessions.retryAvailability')}
						</span>
						<span className="text-2xs" style={{ color: theme.colors.textDim }}>
							{uiText('workflows.sessions.retryAvailabilityHelp')}
						</span>
					</div>
				</label>

				<label
					className="flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-white/5"
					style={{ backgroundColor: theme.colors.bgActivity }}
				>
					<input
						type="checkbox"
						checked={retryOnTokenExhaustion}
						onChange={(e) => onChangeTokenExhaustion(e.target.checked)}
						className="mt-0.5 accent-current"
						style={{ accentColor: theme.colors.accent }}
						aria-label={uiText('workflows.sessions.retryQuota')}
					/>
					<div className="flex flex-col min-w-0">
						<span className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
							{uiText('workflows.sessions.retryQuota')}
						</span>
						<span className="text-2xs" style={{ color: theme.colors.textDim }}>
							{uiText('workflows.sessions.retryQuotaHelp')}
						</span>
					</div>
				</label>
			</div>
		</div>
	);
}
