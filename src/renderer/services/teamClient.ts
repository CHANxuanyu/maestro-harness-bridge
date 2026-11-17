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
				.map((criterion) => `${criterion.id}: ${criterion.text}`),
		].join('\n');
	}
	if (!payload && /^[\s]*[\[{]/.test(body)) {
		try {
			payload = JSON.parse(body);
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
	return {
		...card,
		title: baseline
			? version
				? t('workflows.team.baseline', { version })
				: t('workflows.team.confirmBaseline')
			: acceptance
				? t('workflows.team.acceptResult')
				: card.title,
		body: baseline && payload ? '' : acceptance ? t('workflows.team.acceptanceBody') : body,
		question: baseline && typeof data.question === 'string' ? data.question : undefined,
		briefVersion: version,
		options: card.options.map((option) => ({
			...option,
			label:
				baseline && option.id === 'confirm'
					? t('workflows.team.confirmBaseline')
					: baseline && option.id === 'return'
						? t('workflows.team.return')
						: acceptance && option.id === 'accept'
							? t('workflows.team.accept')
							: acceptance && option.id === 'changes'
								? t('workflows.team.requestChanges')
								: option.label,
		})),
	};
}

/** No speculative IPC calls: these controls become available with the extended contract. */
export const teamFeatures = { baselineEdit: false, baselineDiff: false, baselineReturn: false };
