import { conversationKey } from '../../shared/conversationAutomation';
import { patchNewShellPanel } from '../../shared/newShellPanel';
import { useConversationAutomationStore } from '../stores/conversationAutomationStore';
import { updateAiTab, useSessionStore } from '../stores/sessionStore';
import { useT } from '../i18n';
import { ConversationAutomationCards } from './ConversationAutomationCards';

export function ConversationCheckDelivery({
	sessionId,
	tabId,
	turnId,
	checkRunId,
}: {
	sessionId: string;
	tabId: string;
	turnId: string;
	checkRunId?: string;
}) {
	const t = useT();
	const target = { kind: 'conversation' as const, sessionId, tabId };
	const state = useConversationAutomationStore((s) => s.states[conversationKey(target)]);
	const latestTurnId = useSessionStore(
		(s) =>
			s.sessions
				.find((s) => s.id === sessionId)
				?.aiTabs.find((tab) => tab.id === tabId)
				?.logs.slice()
				.reverse()
				.find((log) => log.source === 'user')?.id
	);
	const batch = state?.batches
		.slice()
		.reverse()
		.find(
			(batch) =>
				batch.turnId === (checkRunId ?? turnId) || (!batch.turnId && turnId === latestTurnId)
		);
	const failed = batch?.checks.some((check) => check.outcome !== 'pass');
	const hasChecks = !!state?.checks.length;
	const ranChecks = batch?.checks.some(
		(check) => check.outcome === 'pass' || check.outcome === 'fail'
	);
	const showCards = state && turnId === latestTurnId;
	if (!hasChecks && !showCards) return null;
	return (
		<div className="w-full space-y-2" data-testid="conversation-check-delivery">
			{hasChecks && (
				<button
					className="rounded border border-current/25 px-2 py-1"
					data-check-status={
						batch?.checks.some((check) => check.outcome === 'fail')
							? 'failed'
							: ranChecks && !failed
								? 'passed'
								: 'unverified'
					}
					onClick={() =>
						updateAiTab(sessionId, tabId, (tab) => ({
							...tab,
							newShellPanel: patchNewShellPanel(tab.newShellPanel, { tab: 'checks', open: true }),
						}))
					}
				>
					{ranChecks
						? t('workflows.automation.passed', {
								passed: batch!.checks.filter((check) => check.outcome === 'pass').length,
								total: batch!.checks.length,
							})
						: state?.running
							? t('workflows.automation.running')
							: batch?.checks.length
								? t('workflows.automation.not-run')
								: t('workflows.automation.notChecked')}
				</button>
			)}
			{hasChecks && failed && (
				<pre className="whitespace-pre-wrap select-text max-h-36 overflow-auto">
					{batch?.checks
						.filter((check) => check.outcome !== 'pass')
						.map(
							(check) =>
								`${check.command}: ${t(`workflows.automation.${check.outcome === 'fail' ? 'fail' : 'not-run'}`)}\n${check.error || check.outputTail.slice(-1500)}`
						)
						.join('\n')}
				</pre>
			)}
			{showCards && (
				<ConversationAutomationCards
					state={state}
					act={async (action) => {
						await window.maestro.conversationAutomation.execute({ target, ...action });
					}}
				/>
			)}
		</div>
	);
}

export function ConversationWaitingBadge({
	sessionId,
	tabId,
}: {
	sessionId: string;
	tabId: string;
}) {
	const t = useT();
	const waiting = useConversationAutomationStore((s) =>
		s.states[conversationKey({ kind: 'conversation', sessionId, tabId })]?.followUps.some(
			(entry) => entry.state === 'pending' && entry.condition.kind === 'ci'
		)
	);
	return waiting ? (
		<span className="text-2xs opacity-70 shrink-0" data-testid="conversation-waiting-ci">
			{t('workflows.automation.waitingCI')}
		</span>
	) : null;
}
