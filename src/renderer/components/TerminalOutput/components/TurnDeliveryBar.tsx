import { memo, type ReactNode } from 'react';
import type { TurnDelivery } from '../../../../shared/gitChangeTurns';
import type { AgentTaskList } from '../../../utils/agentTaskList';
import { useT } from '../../../i18n';
import { updateAiTab } from '../../../stores/sessionStore';
import { patchNewShellPanel } from '../../../../shared/newShellPanel';
import {
	ConversationCheckDelivery,
	useConversationCheckDelivery,
} from '../../ConversationCheckDelivery';

export const TurnDeliveryBar = memo(function TurnDeliveryBar({
	turnId,
	delivery,
	plan,
	sessionId,
	tabId,
	textColor,
	checkResult,
}: {
	turnId: string;
	delivery?: TurnDelivery;
	plan: AgentTaskList | null;
	sessionId: string;
	tabId: string;
	textColor: string;
	/** Optional caller override; otherwise F3 reads main-owned evidence for this turn. */
	checkResult?: ReactNode;
}) {
	const t = useT();
	const hasFiles = delivery && delivery.files > 0;
	const checks = useConversationCheckDelivery({
		sessionId,
		tabId,
		turnId,
		checkRunId: delivery?.checkRunId,
	});
	// No placeholder row: a turn with no files, tasks or check evidence draws nothing.
	if (!hasFiles && !plan && !checkResult && !checks.visible) return null;
	return (
		<div
			className="px-3 sm:px-6 pb-3 text-xs"
			data-testid="turn-delivery"
			data-turn-id={turnId}
			style={{ color: textColor }}
		>
			<div className="flex flex-wrap items-center gap-3" style={{ paddingInlineStart: '0.5em' }}>
				{hasFiles && (
					<button
						className="rounded border border-current/20 px-2 py-1 hover:brightness-125"
						type="button"
						onClick={() =>
							updateAiTab(sessionId, tabId, (tab) => ({
								...tab,
								newShellPanel: patchNewShellPanel(tab.newShellPanel, {
									tab: 'changes',
									open: true,
									changesView: 'turn',
									changesTurnId: turnId,
								}),
							}))
						}
					>
						{t('workflows.activity.files', { count: delivery.files })}
						{' · '}
						{delivery.additions === null || delivery.deletions === null
							? t('workflows.activity.countsUnavailable')
							: `+${delivery.additions} -${delivery.deletions}`}
					</button>
				)}
				{plan && (
					<span data-testid="delivery-plan">
						{t('workflows.activity.tasks', { completed: plan.completed, total: plan.tasks.length })}
					</span>
				)}
				{checkResult ?? (
					<ConversationCheckDelivery
						sessionId={sessionId}
						tabId={tabId}
						turnId={turnId}
						checkRunId={delivery?.checkRunId}
					/>
				)}
			</div>
		</div>
	);
});
