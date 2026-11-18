import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import type { ConversationAutomationMarker } from '../../shared/conversationAutomationPrompt';
import { useT } from '../i18n';
import { FollowUpObservation } from './FollowUpObservation';

/** An app-authored turn is a compact marker, not something the owner typed. */
export function ConversationAutomationTurn({ marker }: { marker: ConversationAutomationMarker }) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const label =
		marker.kind === 'expiry'
			? t('workflows.automation.turnExpiry')
			: marker.kind === 'fix'
				? t('workflows.automation.turnFix')
				: marker.kind === 'diagnosis'
					? t('workflows.automation.turnDiagnosis')
					: marker.reason
						? t('workflows.automation.turnFollowUpReason', { reason: marker.reason })
						: t('workflows.automation.turnFollowUp');
	return (
		<section
			className="rounded border border-current/20 px-3 py-2 text-xs space-y-2"
			data-testid="automation-turn-marker"
		>
			<div className="flex items-center gap-2">
				<Clock size={14} aria-hidden="true" className="shrink-0" />
				<span>{label}</span>
				{marker.late && <span>{t('workflows.automation.turnLate')}</span>}
				{marker.observation && (
					<button
						type="button"
						className="ml-auto shrink-0 flex items-center gap-1"
						aria-expanded={expanded}
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? (
							<ChevronDown size={14} aria-hidden="true" />
						) : (
							<ChevronRight size={14} aria-hidden="true" />
						)}
						{t('workflows.automation.observationDetails')}
					</button>
				)}
			</div>
			{expanded && marker.observation && <FollowUpObservation status={marker.observation} />}
		</section>
	);
}
