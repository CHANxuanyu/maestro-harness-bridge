import type { OwnerCard, TeamState } from '../../shared/team/types';
import type { TFunction } from '../i18n';

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
	return {
		...card,
		title: baseline
			? version
				? t('workflows.team.baseline', { version })
				: t('workflows.team.confirmBaseline')
			: acceptance
				? t('workflows.team.acceptResult')
				: discussion
					? t(
							card.standardChange ? 'workflows.team.standardRequest' : 'workflows.team.ownerDecides'
						)
					: permission
						? t('workflows.team.checkPermission')
						: card.title,
		body:
			baseline && payload
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
				card.standardChange && (option.id === 'approve' || option.id === 'keep')
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
				baseline && option.id === 'confirm'
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

/** Legacy follow-up receipts contain serialized external observations, not prose. */
export function presentTeamFollowUp(result: string, t: TFunction): string {
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
