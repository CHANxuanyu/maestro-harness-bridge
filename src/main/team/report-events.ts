import type { LedgerEvent, TeamEvent, TeamReport, TeamState } from '../../shared/team/types';

/** Event payloads share the public ledger union, rather than a second wire schema. */
export type TeamEventInput = LedgerEvent extends infer E
	? E extends LedgerEvent
		? Omit<E, 'seq' | 'id' | 'at'> & { id?: string; at?: number }
		: never
	: never;

/** Stable receipt-relative IDs make a partially ingested report safe to replay. */
export function reportEvents(
	dispatch: TeamEvent<'turn_dispatched'>,
	report: TeamReport,
	state: TeamState
): TeamEventInput[] {
	const events: TeamEventInput[] = [];
	const actor = dispatch.seat;
	const add = (event: TeamEventInput) => events.push(event);
	const brief = (value: NonNullable<Extract<TeamReport, { type: 'respond' }>['brief']>) =>
		add({
			kind: 'brief_published',
			actor,
			brief: { ...value, version: (state.brief?.version ?? 0) + 1 },
		});
	const issues = (items: Extract<TeamReport, { type: 'verify' }>['issues']) => {
		for (const [index, issue] of items.entries())
			add({
				kind: 'issue_opened',
				actor,
				issueId: `${dispatch.dispatchId}:issue:${index}`,
				title: issue.title,
				criterionId: issue.criterion,
				issueKind: issue.kind,
				steps: issue.steps,
				expected: issue.expected,
				actual: issue.actual,
			});
	};
	switch (report.type) {
		case 'brief':
			brief(report);
			break;
		case 'challenge':
			add({
				kind: 'challenge_submitted',
				actor,
				seat: actor,
				objections: report.objections,
				plans: report.plans,
			});
			break;
		case 'respond':
			add({ kind: 'brief_response', actor, decisions: report.decisions });
			if (report.brief && !state.baseline.confirmedVersion) brief(report.brief);
			break;
		case 'work':
			for (const title of report.done)
				add({
					kind: 'work_item',
					actor,
					itemId: `dev:${title}`,
					title,
					owner: 'dev',
					state: 'done',
				});
			break;
		case 'qa_prep':
			for (const title of report.tests)
				add({ kind: 'work_item', actor, itemId: `qa:${title}`, title, owner: 'qa', state: 'done' });
			break;
		case 'verify':
			issues(report.issues);
			break;
		case 'fix':
			for (const issueId of report.fixed)
				add({ kind: 'issue_fixed', actor, issueId, summary: report.summary });
			break;
		case 'reverify':
			for (const result of report.results)
				add({
					kind: 'issue_verified',
					actor,
					issueId: result.issue,
					pass: result.pass,
					evidence: result.evidence,
				});
			issues(report.newIssues);
			break;
		case 'review': {
			const output = state.outputs.at(-1);
			if (output)
				for (const criterion of state.criteria.filter((c) => c.proof === 'pm'))
					add({
						kind: 'criterion_evidence',
						actor,
						criterionId: criterion.id,
						pass: !report.problems.some((p) => p.criterion === criterion.id),
						source: 'pm',
						evidence: output.outputId,
					});
			add({
				kind: 'review',
				actor,
				verdict: report.verdict,
				problems: report.problems,
				suggestions: report.suggestions,
			});
			break;
		}
		case 'demo':
			add({ kind: 'demo', actor });
			break;
		case 'topic':
			break;
	}
	if (dispatch.mode === 'diagnose')
		add({
			kind: 'retro',
			actor,
			reason: 'no-progress',
			problemId: dispatch.problemId,
			summary:
				report.type === 'fix'
					? (report.summary ?? report.attempt?.basis ?? 'Diagnosis recorded')
					: 'Diagnosis recorded',
			progressEvidence: JSON.stringify(report),
		});
	return events.map((event, index) => ({ ...event, id: `${dispatch.dispatchId}:domain:${index}` }));
}
