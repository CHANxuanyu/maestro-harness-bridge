import { conversationKey } from '../../shared/conversationAutomation';
import { patchNewShellPanel } from '../../shared/newShellPanel';
import { useConversationAutomationStore } from '../stores/conversationAutomationStore';
import { updateAiTab, useSessionStore } from '../stores/sessionStore';
import { useT } from '../i18n';
import {
	ConversationAutomationCards,
	hasTranscriptAutomationCards,
} from './ConversationAutomationCards';

interface CheckDeliveryTarget {
	sessionId: string;
	tabId: string;
	turnId: string;
	checkRunId?: string;
}

/**
 * What a finished turn's check evidence shows, if anything. The delivery bar asks
 * this before drawing itself, so a turn with nothing to report adds no row.
 */
export function useConversationCheckDelivery({
	sessionId,
	tabId,
	turnId,
	checkRunId,
}: CheckDeliveryTarget) {
	const target = { kind: 'conversation' as const, sessionId, tabId };
	const state = useConversationAutomationStore((s) => s.states[conversationKey(target)]);
	// A primitive key, so a streaming reply does not re-render every delivery bar:
	// the latest turn, and when this turn started and the next one began.
	const turnWindow = useSessionStore((s) => {
		const logs =
			s.sessions.find((s) => s.id === sessionId)?.aiTabs.find((tab) => tab.id === tabId)?.logs ??
			[];
		let latest = '';
		let start = '';
		let end = '';
		for (const log of logs) {
			if (log.source !== 'user') continue;
			if (start && !end) end = String(log.timestamp);
			if (log.id === turnId) start = String(log.timestamp);
			latest = log.id;
		}
		return `${latest}|${start}|${end}`;
	});
	const [latestTurnId, start, end] = turnWindow.split('|');
	// A batch run from the panel has no turn of its own: it belongs to the turn that
	// was latest when it ran, and does not move to a newer turn afterwards.
	const ranDuringThisTurn = (createdAt: number) =>
		!!start && createdAt >= Number(start) && (!end || createdAt < Number(end));
	const batch = state?.batches
		.slice()
		.reverse()
		.find(
			(batch) =>
				batch.turnId === (checkRunId ?? turnId) ||
				(!batch.turnId && ranDuringThisTurn(batch.createdAt))
		);
	const failed = batch?.checks.some((check) => check.outcome !== 'pass');
	const hasChecks = !!state?.checks.length;
	const ranChecks = batch?.checks.some(
		(check) => check.outcome === 'pass' || check.outcome === 'fail'
	);
	const showCards = !!state && turnId === latestTurnId && hasTranscriptAutomationCards(state);
	return { state, batch, failed, hasChecks, ranChecks, showCards, visible: hasChecks || showCards };
}

export function ConversationCheckDelivery(props: CheckDeliveryTarget) {
	const { sessionId, tabId } = props;
	const t = useT();
	const target = { kind: 'conversation' as const, sessionId, tabId };
	const { state, batch, failed, hasChecks, ranChecks, showCards, visible } =
		useConversationCheckDelivery(props);
	if (!visible) return null;
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
			{showCards && state && (
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
