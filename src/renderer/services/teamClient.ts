import type { OwnerCard, TeamState, TeamEvent } from '../../shared/team/types';
import type { TFunction } from '../i18n';
import { getAgentDisplayName } from '../../shared/agentMetadata';

export type { CreateTeamInput } from '../../shared/team/types';

/** One adapter over the real preload contract; do not restate its wire types. */
export type TeamClient = typeof window.maestro.team;
export type TeamSnapshot = NonNullable<Awaited<ReturnType<TeamClient['get']>>>;
export type TeamTranscript = NonNullable<Awaited<ReturnType<TeamClient['seatTranscript']>>>;

export function teamClient(): TeamClient | undefined {
	return window.maestro.team;
}

/** Read old JSON checkpoint bodies without exposing transport data as owner-facing prose. */
export function presentTeamOwnerCard(card: OwnerCard, state: TeamState, t: TFunction) {
	let payload: unknown = card.payload;
	let body = card.body;
	if (
		card.boundary === 'budget' &&
		body.startsWith('This is a progress report, not a completion demo.')
	) {
		body = [
			t('workflows.team.progressReport'),
			...state.criteria
				.filter((criterion) => criterion.confirmed && criterion.status !== 'pass')
				.map((criterion) => criterion.text),
		].join('\n');
	}
	if (/^[\s]*[\[{]/.test(body)) {
		try {
			payload ??= JSON.parse(body);
		} catch {
			// A truncated legacy payload is not useful owner-facing copy either.
		}
		body = '';
	}
	const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
	const brief =
		data.brief && typeof data.brief === 'object' ? (data.brief as Record<string, unknown>) : {};
	const version =
		typeof brief.version === 'number'
			? brief.version
			: (state.baseline.proposedVersion ?? state.brief?.version);
	const baseline = card.boundary === 'baseline';
	const acceptance = card.boundary === 'acceptance';
	const discussion = card.payload?.type === 'discussion';
	const permission = card.payload?.type === 'check-permission';
	const m3 =
		data.type === 'escalation' || data.type === 'permission' || data.type === 'progress-report';
	const m3Title =
		data.type === 'progress-report'
			? t('workflows.team.incompleteReport')
			: data.type === 'permission'
				? t('workflows.team.permissionTitle')
				: t('workflows.team.escalationTitle');
	const cause = card.payload?.type === 'escalation' ? card.payload.cause : undefined;
	const labels: Record<string, string> = {
		extend:
			data.type === 'progress-report'
				? t('workflows.team.extendBudget', {
						hours: card.extension?.hours ?? 0,
						turns: card.extension?.turns ?? 0,
					})
				: t('workflows.team.waitExtend'),
		gaps: t('workflows.team.acceptGaps'),
		stop: t('workflows.team.preserveStop'),
		allow: t('workflows.team.allowClass'),
		decline: cause === 'model' ? t('workflows.team.keepModel') : t('workflows.team.declineAction'),
		login: t('workflows.team.loginRestored'),
		model: t('workflows.team.authorizeModel'),
		takeover: t('workflows.team.takeoverAllow'),
	};
	const costs: Record<string, string> = {
		extend:
			data.type === 'progress-report'
				? t('workflows.team.extendCost')
				: t('workflows.team.waitExtendCost', {
						hours: Number((card.extension?.hours ?? 0).toFixed(1)),
					}),
		gaps: t('workflows.team.gapsCost'),
		stop: t('workflows.team.preserveCost'),
		allow: t('workflows.team.allowCost'),
		decline:
			cause === 'model' ? t('workflows.team.keepModelCost') : t('workflows.team.permissionDecline'),
		login: t('workflows.team.loginCost'),
		model: t('workflows.team.modelCost'),
		takeover: t('workflows.team.takeoverCost'),
	};
	return {
		...card,
		budgetNote:
			!baseline && !acceptance
				? t('workflows.team.budgetUsed', {
						used: state.usage.budgetTurns,
						total: state.config!.turnBudget,
					})
				: undefined,
		title: m3
			? m3Title
			: baseline
				? version
					? t('workflows.team.baseline', { version })
					: t('workflows.team.confirmBaseline')
				: acceptance
					? t('workflows.team.acceptResult')
					: discussion
						? t(
								card.standardChange
									? 'workflows.team.standardRequest'
									: 'workflows.team.ownerDecides'
							)
						: permission
							? t('workflows.team.checkPermission')
							: card.title,
		body: m3
			? cause
				? t(`workflows.team.escalation.${cause}`)
				: ''
			: baseline && payload
				? ''
				: acceptance
					? t('workflows.team.acceptanceBody')
					: discussion
						? card.standardChange
							? ''
							: t('workflows.team.commitmentBody')
						: permission
							? `${t('workflows.team.checkPermissionBody')} ${card.payload?.type === 'check-permission' ? `${card.payload.command}. ${t(`workflows.team.checkScope.${card.payload.boundary}`)}` : ''}`
							: body,
		question: baseline && typeof data.question === 'string' ? data.question : undefined,
		briefVersion: version,
		options: card.options.map((option) => ({
			...option,
			cost:
				m3 && costs[option.id]
					? costs[option.id]
					: card.standardChange && (option.id === 'approve' || option.id === 'keep')
						? t(
								option.id === 'approve'
									? card.standardChange.change === 'remove'
										? 'workflows.team.approveRemovalCost'
										: 'workflows.team.approveStandardCost'
									: data.failingNow === true
										? 'workflows.team.keepFailingStandardCost'
										: 'workflows.team.keepStandardCost'
							)
						: option.cost,
			label:
				m3 && labels[option.id]
					? labels[option.id]
					: baseline && option.id === 'confirm'
						? t('workflows.team.confirmBaseline')
						: baseline && option.id === 'return'
							? t('workflows.team.return')
							: acceptance && option.id === 'accept'
								? t('workflows.team.accept')
								: acceptance && option.id === 'changes'
									? t('workflows.team.requestChanges')
									: discussion && option.id === 'approve'
										? t(
												card.standardChange
													? 'workflows.team.approveStandard'
													: 'workflows.team.approveCommitment'
											)
										: discussion && option.id === 'keep'
											? t(
													card.standardChange
														? 'workflows.team.keepStandard'
														: 'workflows.team.keepCommitment'
												)
											: permission && option.id === 'once'
												? t('workflows.team.allowCheck')
												: permission && option.id === 'omit'
													? t('workflows.team.omitCheck')
													: option.label,
		})),
	};
}

/** Recovery receipts are app instructions, not member-authored conversation. */
export function presentTeamRecovery(how: string, t: TFunction): string | null {
	// The takeover card and restart inspection already explain these transitions once.
	if (how.startsWith('Restart:') || how.startsWith('Authorized takeover in a NEW conversation'))
		return null;
	const keys = {
		'Original model recovered; switched back in a separate conversation':
			'workflows.team.originalRecovered',
		'The reset condition changed; resume the suspended assignment': 'workflows.team.limitRecovered',
		'A valid turn report was ingested.': 'workflows.team.reportReceived',
		'New native results recovered without redispatching the failed model':
			'workflows.team.nativeRecovered',
		'Owner selected a model; resume from the ledger in a new conversation':
			'workflows.team.newModelReady',
		'Owner authorized temporary takeover; availability remains checked':
			'workflows.team.coverageAuthorized',
		'Owner confirmed the named login was restored': 'workflows.team.loginConfirmed',
	} as const;
	return t(keys[how as keyof typeof keys] ?? 'workflows.team.recoveryComplete');
}

/** One human wait description for feed, status cells and the Progress tab. */
export function presentTeamWait(
	wait: TeamEvent<'follow_up_registered'>,
	state: TeamState,
	t: TFunction,
	locale: string
) {
	if (wait.followUpId.startsWith('job:')) return null;
	const quota = state.unavailable.find((entry) => entry.id === wait.unavailabilityId);
	const provider =
		quota?.model?.tool ??
		(quota ? state.config!.seats[quota.configSource ?? quota.seat].tool : undefined);
	const title = wait.unavailabilityId
		? quota?.login
			? t('workflows.team.waitLogin', {
					provider: getAgentDisplayName(provider ?? state.config!.seats[wait.seat].tool),
				})
			: provider
				? t('workflows.team.waitLimit', { provider: getAgentDisplayName(provider, 'short') })
				: t('workflows.team.quotaWaitFor')
		: wait.faultId || wait.followUpId.startsWith('job-retry:')
			? t('workflows.team.recoveryWaitFor')
			: t('workflows.team.waitCondition', { condition: presentTeamText(wait.waitFor, state, t) });
	return {
		title,
		reason: wait.unavailabilityId
			? quota?.resetsAt
				? t('workflows.team.resetsAt', { time: new Date(quota.resetsAt).toLocaleString(locale) })
				: t(quota?.login ? 'workflows.team.ownerLoginNeeded' : 'workflows.team.resetUnknown')
			: wait.faultId || wait.followUpId.startsWith('job-retry:')
				? t('workflows.team.recoveryWaitReason')
				: presentTeamText(wait.reason, state, t),
	};
}

/** Legacy follow-up receipts contain serialized external observations, not prose. */
export function presentTeamFollowUp(result: string, t: TFunction): string {
	if (result === 'Model reset or fresh quota sample confirms recovery')
		return t('workflows.team.limitRecovered');
	if (result === 'Seat recovery changed the condition; cancel the fault inspection wait')
		return t('workflows.team.recoveryComplete');
	if (result.startsWith('Restart:')) return t('workflows.team.restartResume');
	if (!/^\s*[[{]/.test(result)) return result;
	try {
		const observation: unknown = JSON.parse(result);
		if (observation && typeof observation === 'object' && !Array.isArray(observation)) {
			const data = observation as Record<string, unknown>;
			return (
				[
					data.state === 'waiting' ||
					data.state === 'running' ||
					data.state === 'completed' ||
					data.state === 'unavailable'
						? t(`workflows.team.external.${data.state}`)
						: '',
					...['status', 'conclusion', 'error', 'outputTail'].map((key) =>
						typeof data[key] === 'string' ? data[key] : ''
					),
				]
					.filter(Boolean)
					.join(': ') || t('workflows.team.followUpUpdated')
			);
		}
	} catch {
		// Malformed transport data is not an owner-facing message.
	}
	return t('workflows.team.followUpUpdated');
}

/** Display prose without serialized payloads, workspace prefixes or criterion keys. */
export function presentTeamText(text: string | undefined, state: TeamState, t: TFunction): string {
	if (!text) return '';
	if (/^\s*[\[{]/.test(text)) return t('workflows.team.followUpUpdated');
	const appText = {
		'Valid report produced no new ledger facts. Name missing evidence or complete an assigned item.':
			'workflows.team.fault.idle-turn',
		'Authorized takeover in a NEW conversation; use the ledger slice and inspect the existing workspace':
			'workflows.team.takeoverContext',
		'Quota reset or a new account status sample; unchanged observations are normal waiting':
			'workflows.team.quotaWaitFor',
		'Waiting for model recovery': 'workflows.team.quotaWaitFor',
		'The bounded retry or report repair failed. Do not redispatch unchanged conditions.':
			'workflows.team.recoveryWaitReason',
		'New native results or an explicit recovery condition; app inspects without a model call':
			'workflows.team.recoveryWaitFor',
		'Missing team-report fenced block.': 'workflows.team.missingReportDetail',
		'Owner edited the criterion': 'workflows.team.ownerEditedCriterion',
		'Owner changed the criterion; recheck the current version.':
			'workflows.team.ownerChangedCriterion',
	} as const;
	const appKey = appText[text as keyof typeof appText];
	if (appKey) return t(appKey);

	if (
		text === 'No evidence recorded.' ||
		text === 'No evidence recorded for the current definition.'
	)
		return t('workflows.team.noEvidence');
	if (/^Waiting for (app|qa|pm) evidence for this criterion\.$/.test(text))
		return t('workflows.team.proofPending');
	let value = text;
	for (const root of [
		state.config?.projectRoot,
		...Object.values(state.seats).map((seat) => seat.binding?.workspace),
	]
		.filter((root): root is string => !!root)
		.sort((a, b) => b.length - a.length))
		value = value
			.split(root + '/')
			.join('')
			.split(root + '\\')
			.join('');
	for (const criterion of state.criteria) {
		if (value === criterion.id) value = criterion.text;
		value = value.split(criterion.id + ':').join(criterion.text + ':');
	}
	return value;
}
