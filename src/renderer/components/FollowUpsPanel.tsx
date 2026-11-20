import { useEffect, useState } from 'react';
import {
	conversationKey,
	conversationExpiryCardId,
	CONVERSATION_TOTAL_MS,
	CONVERSATION_WAIT_MS,
	type AutomationAction,
	type ConversationTarget,
} from '../../shared/conversationAutomation';
import { DURATION_MS, formatDurationForLocale } from '../../shared/duration';
import { useConversationAutomationStore } from '../stores/conversationAutomationStore';
import { useT, useAppLocale } from '../i18n';

export function FollowUpsPanel({ target, cwd }: { target: ConversationTarget; cwd: string }) {
	const t = useT();
	const locale = useAppLocale();
	const state = useConversationAutomationStore((s) => s.states[conversationKey(target)]);
	const [reason, setReason] = useState('');
	const [kind, setKind] = useState<'time' | 'command' | 'ci'>('time');
	const [value, setValue] = useState('1200');
	const [totalMs, setTotalMs] = useState(CONVERSATION_TOTAL_MS);
	useEffect(() => {
		if (state?.startedAt !== undefined && state.deadline !== undefined)
			setTotalMs(state.deadline - state.startedAt);
	}, [state?.startedAt, state?.deadline]);
	const allStates = useConversationAutomationStore((s) => s.states);
	const undeliverable = Object.values(allStates).filter(
		(other) =>
			conversationKey(other.target) !== conversationKey(target) &&
			other.deliveries.some((delivery) => delivery.state === 'undeliverable')
	);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const act = async (action: AutomationAction) => {
		await window.maestro.conversationAutomation.execute({ target, ...action });
	};
	const send = (action: AutomationAction) => {
		setBusy(true);
		setError('');
		void act(action)
			.catch((error: unknown) => setError(String(error)))
			.finally(() => setBusy(false));
	};
	const latest = (state?.startedAt ?? Date.now()) + totalMs;
	return (
		<div className="p-4 space-y-3 overflow-y-auto text-sm" data-testid="follow-ups-panel">
			<form
				className="rounded border border-current/25 p-3 space-y-2"
				onSubmit={(event) => {
					event.preventDefault();
					send({
						action: 'follow-add',
						reason,
						totalMs,
						condition:
							kind === 'time'
								? { kind, at: Date.now() + Number(value) * DURATION_MS.second }
								: kind === 'command'
									? { kind, processId: value }
									: { kind, runId: value, cwd },
					});
				}}
			>
				<h4 className="font-semibold">{t('workflows.automation.addFollowUp')}</h4>
				<input
					required
					aria-label={t('workflows.automation.reason')}
					placeholder={t('workflows.automation.reason')}
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					className="w-full rounded border border-current/25 bg-transparent p-2"
				/>
				<select
					aria-label={t('workflows.automation.addFollowUp')}
					value={kind}
					onChange={(event) => setKind(event.target.value as typeof kind)}
					className="bg-transparent"
				>
					<option value="time">{t('workflows.automation.time')}</option>
					<option value="command">{t('workflows.automation.command')}</option>
					<option value="ci">{t('workflows.automation.ciCondition')}</option>
				</select>
				<input
					required
					aria-label={t('workflows.automation.value')}
					value={value}
					onChange={(event) => setValue(event.target.value)}
					className="w-full rounded border border-current/25 bg-transparent p-2"
				/>
				<dl className="space-y-2">
					<dt>{t('workflows.automation.singleWait')}</dt>
					<dd>
						{t('workflows.automation.waitValue', {
							duration: formatDurationForLocale(CONVERSATION_WAIT_MS, locale),
						})}
					</dd>
					<dt>{t('workflows.automation.totalLimit')}</dt>
					<dd>
						<select
							aria-label={t('workflows.automation.totalLimit')}
							value={totalMs}
							onChange={(event) => setTotalMs(Number(event.target.value))}
							className="bg-transparent"
						>
							{[
								...new Set([
									DURATION_MS.hour,
									CONVERSATION_TOTAL_MS,
									4 * DURATION_MS.hour,
									totalMs,
								]),
							]
								.sort((a, b) => a - b)
								.map((limit) => (
									<option key={limit} value={limit}>
										{formatDurationForLocale(limit, locale)}
									</option>
								))}
						</select>
						<p>
							{t('workflows.automation.latest', { time: new Date(latest).toLocaleString(locale) })}
						</p>
					</dd>
				</dl>
				<p>{t('workflows.automation.expiryBehavior')}</p>
				<button
					className="rounded border border-current/25 px-2 py-1 disabled:opacity-50"
					disabled={busy || state?.stopped}
					type="submit"
				>
					{t('workflows.automation.addFollowUp')}
				</button>
			</form>
			{error && <p role="alert">{error}</p>}
			{!state?.followUps.length && <p>{t('workflows.automation.noFollowUps')}</p>}
			{state?.followUps.map((follow) => (
				<section
					key={follow.id}
					className="rounded border border-current/25 p-3 space-y-2"
					data-testid="follow-up-card"
				>
					<h4>{follow.reason}</h4>
					<p>
						{t(
							follow.fire?.kind === 'expired'
								? 'workflows.automation.expiredState'
								: `workflows.automation.${follow.state}`
						)}
					</p>
					<p>
						{t('workflows.automation.waitValue', {
							duration: formatDurationForLocale(follow.waitLimitMs, locale),
						})}
					</p>
					<p>
						{t('workflows.automation.latest', {
							time: new Date(follow.deadline).toLocaleString(locale),
						})}
					</p>
					<p>{t('workflows.automation.expiryBehavior')}</p>
					<p>{t('workflows.automation.durable')}</p>
					{follow.fire?.late && <p>{t('workflows.automation.late')}</p>}
					{state.expired && (
						<button
							type="button"
							className="rounded border border-current/25 px-2 py-1 disabled:opacity-50"
							onClick={() => {
								const card = document.getElementById(conversationExpiryCardId(target));
								card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
								card?.focus({ preventScroll: true });
							}}
						>
							{t('workflows.automation.viewExpiry')}
						</button>
					)}
					{state.deliveries.some(
						(entry) => entry.id === `follow:${follow.id}` && entry.state === 'undeliverable'
					) && <p role="status">{t('workflows.automation.undeliverable')}</p>}
					{follow.state === 'pending' && (
						<button
							type="button"
							className="rounded border border-current/25 px-2 py-1 disabled:opacity-50"
							disabled={busy}
							onClick={() => send({ action: 'follow-cancel', id: follow.id })}
						>
							{t('workflows.automation.cancel')}
						</button>
					)}
				</section>
			))}
			{undeliverable.map((other) => (
				<section
					key={conversationKey(other.target)}
					className="rounded border border-current/25 p-3"
				>
					<h4>{t('workflows.automation.undeliverable')}</h4>
					{other.followUps
						.filter((follow) =>
							other.deliveries.some(
								(delivery) =>
									delivery.id === `follow:${follow.id}` && delivery.state === 'undeliverable'
							)
						)
						.map((follow) => (
							<p key={follow.id}>{follow.reason}</p>
						))}
				</section>
			))}
		</div>
	);
}
