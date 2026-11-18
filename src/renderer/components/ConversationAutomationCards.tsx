import { useState } from 'react';
import { useT, useAppLocale } from '../i18n';
import { formatDurationForLocale } from '../../shared/duration';
import { conversationExpiryCardId } from '../../shared/conversationAutomation';
import { FollowUpObservation } from './FollowUpObservation';
import type {
	AutomationAction,
	ConversationAutomationState,
} from '../../shared/conversationAutomation';

export function ConversationAutomationCards({
	state,
	act,
	surface = 'transcript',
}: {
	state: ConversationAutomationState;
	act: (action: AutomationAction) => Promise<void>;
	surface?: 'transcript' | 'panel';
}) {
	const t = useT();
	const locale = useAppLocale();
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const send = (action: AutomationAction) => {
		setBusy(true);
		setError('');
		void act(action)
			.catch((error: unknown) => setError(String(error)))
			.finally(() => setBusy(false));
	};
	const latest = state.batches.at(-1);
	const button = (label: string, action: AutomationAction) => (
		<button
			type="button"
			disabled={busy}
			className="rounded border border-current/25 px-2 py-1 disabled:opacity-50"
			onClick={() => send(action)}
		>
			{label}
		</button>
	);
	const budget =
		state.startedAt !== undefined && state.deadline !== undefined
			? t('workflows.automation.budgetUsed', {
					used: formatDurationForLocale(
						(state.expired ? state.deadline : (state.pausedAt ?? Date.now())) - state.startedAt,
						locale
					),
					total: formatDurationForLocale(state.deadline - state.startedAt, locale),
				})
			: undefined;
	return (
		<div className="w-full space-y-3 text-xs" data-testid="automation-cards">
			{error && <p role="alert">{error}</p>}
			{!!state.notes.length && (
				<details>
					<summary>{t('workflows.automation.notes')}</summary>
					{state.notes.map((note, index) => (
						<p key={index}>
							{t(`workflows.automation.${note.kind}`, { detail: note.detail ?? '' })}
						</p>
					))}
				</details>
			)}
			{state.stopped && !state.expired && <p>{t('workflows.automation.stopped')}</p>}
			{!!state.checks.length && !state.projectAuthorized && (
				<section
					className="rounded border border-current/25 p-3 space-y-2"
					data-testid="checks-project-permission"
				>
					<h4 className="font-semibold">{t('workflows.automation.projectPermission')}</h4>
					<p>{state.project}</p>
					<p>{t('workflows.automation.projectScope')}</p>
					{button(t('workflows.automation.allowProject'), {
						action: 'authorize',
						choice: 'project',
					})}
				</section>
			)}
			{state.checks
				.filter((check) => check.boundary && !check.once)
				.map((check) => (
					<section
						key={check.id}
						className="rounded border border-current/25 p-3 space-y-2"
						data-testid="checks-scope-request"
					>
						<code className="select-text break-all">{check.command}</code>
						<p>{t(`workflows.automation.${check.boundary!}`)}</p>
						<div className="flex gap-2">
							{button(t('workflows.automation.once'), {
								action: 'authorize',
								choice: 'once',
								checkId: check.id,
							})}
							{button(t('workflows.automation.reject'), {
								action: 'authorize',
								choice: 'reject',
								checkId: check.id,
							})}
						</div>
					</section>
				))}
			{state.fix === 'ask' && latest?.checks.some((check) => check.outcome === 'fail') && (
				<section
					className="rounded border border-current/25 p-3 space-y-2"
					data-testid="checks-fix-choice"
				>
					<h4 className="font-semibold">{t('workflows.automation.fixQuestion')}</h4>
					<p>{t('workflows.automation.fixLimit')}</p>
					<div className="flex gap-2">
						{button(t('workflows.automation.fixAuto'), { action: 'fix', mode: 'auto' })}
						{button(t('workflows.automation.fixManual'), { action: 'fix', mode: 'manual' })}
					</div>
				</section>
			)}
			{!!state.attempts.length && (
				<section
					className="rounded border border-current/25 p-3 space-y-2 overflow-auto"
					data-testid="checks-attempt-ledger"
				>
					<h4 className="font-semibold">{t('workflows.automation.attemptLedger')}</h4>
					<p>{t('workflows.automation.ledgerSource')}</p>
					<table className="w-full text-left border-separate border-spacing-2">
						<thead>
							<tr>
								{(['attempt', 'action', 'result', 'progress'] as const).map((key) => (
									<th key={key}>{t(`workflows.automation.${key}`)}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{state.progress.attempts.map((attempt, index) => (
								<tr key={attempt.id}>
									<td>{index + 1}</td>
									<td className="select-text min-w-48">
										{(['basis', 'difference', 'expectation'] as const).map((key) => (
											<p key={key}>
												{t(`workflows.automation.${key}`)}:{' '}
												{attempt[key] || t('workflows.automation.missingBasis')}
											</p>
										))}
									</td>
									<td className="select-text">
										{state.batches
											.find((batch) => batch.id === attempt.id)
											?.checks.filter((check) => check.outcome === 'fail')
											.map((check) => (
												<pre className="whitespace-pre-wrap" key={check.id}>
													{check.outputTail.slice(-500)}
												</pre>
											))}
									</td>
									<td>{t(`workflows.automation.${attempt.verdict}`)}</td>
								</tr>
							))}
						</tbody>
					</table>
					<p>{budget}</p>
					{state.decision && ['continue', 'diagnose', 'gather'].includes(state.decision.kind) && (
						<p>
							{t(
								`workflows.automation.${state.decision.kind as 'continue' | 'diagnose' | 'gather'}`
							)}
						</p>
					)}
				</section>
			)}
			{state.decision?.kind === 'escalate' && (
				<section
					className="rounded border border-current/25 p-3 space-y-2"
					data-testid="checks-boundary-card"
				>
					<h4 className="font-semibold">{t('workflows.automation.boundaryTitle')}</h4>
					<dl>
						<dt>{t('workflows.automation.stuck')}</dt>
						<dd>
							{state.decision.options
								.map(
									(option) =>
										`${option.boundary && ['budget', 'commitment', 'permission', 'model', 'login'].includes(option.boundary) ? t(`workflows.automation.${option.boundary as 'budget' | 'commitment' | 'permission' | 'model' | 'login'}`) : ''}: ${option.basis}`
								)
								.join('\n')}
						</dd>
						<dt>{t('workflows.automation.paths')}</dt>
						<dd>
							{state.progress.attempts.map((attempt) => (
								<p key={attempt.id}>
									{attempt.basis}: {t(`workflows.automation.${attempt.verdict}`)}
								</p>
							))}
						</dd>
					</dl>
					<p>{budget}</p>
					<p>{t('workflows.automation.pauseNote')}</p>
					{state.decision.options.map((option, index) => (
						<div key={index}>
							{button(
								`${option.plan}${option.recommended ? ` (${t('workflows.automation.recommended')})` : ''}`,
								{ action: 'answer', option: index }
							)}
							<p>{option.cost}</p>
						</div>
					))}
					{button(t('workflows.automation.stop'), { action: 'stop' })}
				</section>
			)}
			{state.expired && surface === 'transcript' && (
				<section
					id={conversationExpiryCardId(state.target)}
					tabIndex={-1}
					className="rounded border border-current/25 p-3 space-y-2"
					data-testid="follow-up-expiry"
				>
					<h4 className="font-semibold">{t('workflows.automation.expired')}</h4>
					<p>{t('workflows.automation.stopped')}</p>
					{state.expiryReport ? (
						<>
							{state.checks.length > 0 && state.expiryReport.total > 0 && (
								<p>
									{t('workflows.automation.passed', {
										passed: state.expiryReport.passed,
										total: state.expiryReport.total,
									})}
								</p>
							)}
							{state.expiryReport.observations.map((item, index) => (
								<div key={index}>
									<p>{item.reason}</p>
									{item.status && <FollowUpObservation status={item.status} />}
								</div>
							))}
							<p>
								{t(
									state.expiryReport.recommendation === 'extend'
										? 'workflows.automation.expiryExtend'
										: 'workflows.automation.expiryReview'
								)}
							</p>
						</>
					) : (
						<p>{t('workflows.automation.expiryReview')}</p>
					)}
					<p>{budget}</p>
					<div className="flex gap-2">
						{button(t('workflows.automation.extend'), { action: 'extend' })}
						{button(t('workflows.automation.stop'), { action: 'stop' })}
					</div>
				</section>
			)}
		</div>
	);
}
