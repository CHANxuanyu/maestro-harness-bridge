import {
	baselineDiff,
	isOpenTeamIssue,
	topicParticipants,
	topicRejection,
	teamEvidence,
	supersededDecisionBaseline,
} from '../../shared/team/policy';
import type {
	StandardChangeRequest,
	TeamTopic,
	LedgerEvent,
	TeamEvent,
	TeamReport,
	TeamState,
} from '../../shared/team/types';

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
	const topic = (value: TeamTopic, trigger = 'member', change?: StandardChangeRequest) => {
		const rejection = topicRejection(value, state);
		if (rejection) {
			add({ kind: 'topic_rejected', actor: 'app', topic: value, reason: rejection });
			return;
		}
		if (value.kind === 'standard') {
			const issueId = `${dispatch.dispatchId}:standard:${events.length}`;
			add({
				kind: 'issue_opened',
				actor: 'app',
				issueId,
				title: value.topic,
				criterionId: value.criterionId,
				issueKind: 'standard',
				steps: [value.why],
			});
			const baselineVersion = supersededDecisionBaseline(value, state);
			if (baselineVersion) {
				add({
					kind: 'standard_issue_resolved',
					actor: 'app',
					issueId,
					baselineVersion,
					reason: `Confirmed baseline v${baselineVersion} supersedes pre-baseline decisions. Apply its criterion without changing the standard.`,
				});
				return;
			}
			value = {
				...value,
				owner: 'pm',
				layer: 'product',
				participants: ['pm', ...value.participants],
			};
			trigger = 'standard-issue';
		}
		const participants = topicParticipants(value);
		add({
			kind: 'discussion_opened',
			actor: 'app',
			discussionId: `${dispatch.dispatchId}:discussion:${events.length}`,
			topic: value.topic,
			owner: participants[0],
			participants,
			trigger,
			layer: value.layer ?? 'product',
			reversible: value.reversible ?? true,
			question: value.question ?? value.topic,
			evidence: value.evidence?.filter((e) => teamEvidence(state).includes(e)) ?? [],
			unverifiedBasis: value.evidence?.filter((e) => !teamEvidence(state).includes(e)) ?? [],
			reopens: value.reopens,
			change,
		});
	};
	const standardChange = (change: StandardChangeRequest) =>
		topic(
			{
				topic: `Standard change: ${change.criterionId}`,
				why: change.reason,
				participants: ['pm', 'dev', 'qa'],
				owner: 'pm',
				layer: ['add', 'tighten'].includes(change.change) ? 'product' : 'commitment',
				// Each definition is a separate question. The old decision cannot authorize another edit.
				question: JSON.stringify([change.criterionId, change.change, change.criterion]),
			},
			'standard-change',
			change
		);
	// Before the owner confirms a baseline the brief is a draft (PRD 6.6 R1-1): a
	// standard question or criterion edit raised in a challenge is a point for PM's
	// answer (6.4), not a discussion or a commitment card of its own.
	const draft = !state.baseline.confirmedVersion && !!state.brief;
	const foldedIntoChallenge = draft && report.type === 'challenge';
	const draftObjections = () =>
		foldedIntoChallenge
			? [
					...(typeof report.topic === 'object' && report.topic.kind === 'standard'
						? [
								{
									about: report.topic.criterionId ?? report.topic.topic,
									problem: [report.topic.topic, report.topic.why, report.topic.question]
										.filter(Boolean)
										.join(' '),
									kind: 'unverifiable' as const,
								},
							]
						: []),
					...(report.standardChanges ?? []).map((change) => ({
						about: change.criterionId,
						problem: `Proposed ${change.change}: ${change.criterion?.text ?? 'remove this criterion'}. ${change.reason}`,
						kind: 'unreasonable' as const,
					})),
				]
			: [];
	/** PM edits a draft criterion by publishing the next brief version, never by a standard change. */
	const draftRevision = (changes: StandardChangeRequest[]) => {
		const criteria = [...state.brief!.criteria];
		for (const change of changes) {
			const index = criteria.findIndex((c) => c.id === change.criterionId);
			if (change.change === 'remove') {
				if (index >= 0) criteria.splice(index, 1);
			} else if (change.criterion) {
				if (index >= 0) criteria[index] = change.criterion;
				else criteria.push(change.criterion);
			}
		}
		brief({ ...state.brief!, criteria });
	};
	const brief = (value: NonNullable<Extract<TeamReport, { type: 'respond' }>['brief']>) => {
		const next = {
			...value,
			version: (state.brief?.version ?? 0) + 1,
			criteria: value.criteria.map((c) => ({
				...c,
				...(state.brief?.criteria.find((old) => old.id === c.id)?.byOwner ? { byOwner: true } : {}),
			})),
		};
		const diff = baselineDiff(state.brief, next);
		const latestResponse = state.briefResponses.at(-1)?.seq ?? 0;
		if (
			report.type === 'respond' &&
			latestResponse &&
			(state.baseline.returns.at(-1)?.seq ?? 0) < latestResponse &&
			!diff.scope &&
			!diff.notDoing &&
			!diff.criteria.length &&
			!diff.checks
		)
			return;
		add({ kind: 'brief_published', actor, brief: next });
	};

	const issues = (items: Extract<TeamReport, { type: 'verify' }>['issues']) => {
		for (const [index, issue] of items.entries()) {
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
			if (issue.kind === 'standard')
				topic(
					{
						topic: issue.title,
						why: issue.actual ?? issue.title,
						participants: ['pm', actor],
						owner: 'pm',
					},
					'standard-issue'
				);
		}
	};
	switch (report.type) {
		case 'recovery':
			break;
		case 'wrap_up':
			add({
				kind: 'wrap_up',
				actor,
				generatedBy: 'pm',
				summary: report.summary,
				priorities: report.priorities,
			});
			break;
		case 'wait':
			break;
		case 'brief':
			brief(report);
			break;
		case 'challenge':
			add({
				kind: 'challenge_submitted',
				actor,
				seat: actor,
				objections: [...report.objections, ...draftObjections()],
				plans: report.plans,
				briefVersion: state.brief?.version,
			});
			break;
		case 'respond':
			add({ kind: 'brief_response', actor, decisions: report.decisions });
			if (report.brief && !state.baseline.confirmedVersion) brief(report.brief);
			else if (report.brief) {
				for (const old of state.criteria) {
					const next = report.brief.criteria.find((c) => c.id === old.id);
					if (!next || next.text !== old.text || next.proof !== old.proof || next.how !== old.how)
						standardChange({
							criterionId: old.id,
							change: next ? 'modify' : 'remove',
							criterion: next,
							reason: 'PM proposed a revised confirmed brief',
						});
				}
				for (const next of report.brief.criteria.filter(
					(c) => !state.criteria.some((old) => old.id === c.id)
				))
					standardChange({
						criterionId: next.id,
						change: 'add',
						criterion: next,
						reason: 'PM proposed an additional criterion',
					});
			}
			for (const decision of report.decisions.filter((d) => d.result === 'discuss'))
				topic(
					{ topic: decision.about, why: decision.reason, participants: ['pm', 'dev', 'qa'] },
					'challenge'
				);
			break;
		case 'work':
			if (report.waiting?.needs?.length)
				topic(
					{
						topic: report.waiting.waitFor,
						why: report.waiting.reason,
						participants: ['dev', ...report.waiting.needs],
					},
					'blocked-member'
				);
			for (const item of state.workItems.filter(
				(item) =>
					item.owner === 'dev' &&
					item.state === 'claimed' &&
					(report.claimsComplete || report.done.includes(item.itemId))
			))
				add({ ...item, kind: 'work_item', actor, state: 'done' });
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
			for (const [index, problem] of report.problems.entries()) {
				const existing = state.issues.find(
					(i) =>
						isOpenTeamIssue(i) &&
						i.opened.reviewId &&
						i.opened.criterionId === problem.criterion &&
						i.opened.location === problem.location &&
						i.opened.expected === problem.expected
				);
				if (existing) continue;
				const issueId = `${dispatch.dispatchId}:review:${index}`;
				add({
					kind: 'issue_opened',
					actor,
					issueId,
					title: problem.title,
					criterionId: problem.criterion,
					issueKind: 'defect',
					steps: [`Inspect ${problem.location}`],
					location: problem.location,
					impact: problem.impact,
					expected: problem.expected,
					actual: problem.impact,
					reviewId: dispatch.dispatchId,
				});
				add({
					kind: 'work_item',
					actor: 'app',
					itemId: issueId,
					title: problem.title,
					owner: 'dev',
					state: 'claimed',
					criterionId: problem.criterion,
				});
			}

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
			add({
				kind: 'demo',
				actor,
				criterionIds: state.demos.length
					? [
							...new Set(
								state.standardChanges
									.filter((c) => c.seq > state.demos.at(-1)!.seq)
									.map((c) => c.criterionId)
							),
						]
					: state.criteria.map((c) => c.id),
				changes: state.standardChanges.map((c) => c.id),
				contested: state.decisions.filter((d) => d.contested).map((d) => d.id),
				suggestions: state.suggestions,
				withEvidence: state.criteria.filter((c) => c.confirmed && c.status === 'pass').length,
				total: state.criteria.filter((c) => c.confirmed).length,
			});
			break;
		case 'topic':
			topic(report);
			break;
		case 'position':
			add({
				...report,
				kind: 'position',
				actor,
				seat: actor,
				evidence: report.evidence?.filter((e) => teamEvidence(state).includes(e)),
				unverifiedBasis: report.evidence?.filter((e) => !teamEvidence(state).includes(e)),
			});
			break;
		case 'proposal':
			add({ ...report, kind: 'proposal', actor, round: dispatch.round ?? 1 });
			break;
		case 'response': {
			const evidence =
				report.evidence && teamEvidence(state).includes(report.evidence)
					? report.evidence
					: undefined;
			const baselineViolation = state.criteria.some(
				(c) => c.confirmed && c.id === report.baselineViolation
			)
				? report.baselineViolation
				: undefined;
			const discussion = state.discussions.find((d) => d.id === report.discussionId);
			const unsupported =
				report.result === 'insist' &&
				!baselineViolation &&
				!(evidence && teamEvidence(state, discussion).includes(evidence));
			add({
				...report,
				kind: 'response',
				actor,
				seat: actor,
				round: dispatch.round ?? 1,
				evidence,
				baselineViolation,
				unverifiedBasis: [
					...(report.evidence && !evidence ? [report.evidence] : []),
					...(report.baselineViolation && !baselineViolation ? [report.baselineViolation] : []),
				],
				...(unsupported
					? ({
							result: 'reserve',
							requestedResult: 'insist',
							evidenceConclusion:
								'No new recorded evidence or confirmed baseline violation; retained as a reservation for the lawful decider.',
						} as const)
					: {}),
			});
			break;
		}
		case 'retro':
			add({
				kind: 'retro',
				actor,
				discussionId: report.discussionId,
				reason:
					state.discussions.find((d) => d.id === report.discussionId)?.opened?.trigger ===
					'no-progress'
						? 'no-progress'
						: 'rejections',
				problemId: state.discussions.find((d) => d.id === report.discussionId)?.opened?.problemId,
				summary: report.causes,
				approach: report.approach,
				basis: report.basis,
				difference: report.difference,
				progressEvidence: report.progressEvidence,
			});
			break;
		case 'message':
			for (const receipt of report.messages) {
				const message = state.pendingMessages.find((m) => m.messageId === receipt.messageId)!;
				if (receipt.scope && actor !== 'pm') {
					add({
						kind: 'message_forwarded',
						actor,
						messageId: message.messageId,
						from: actor,
						summary: report.summary,
					});
					continue;
				}
				if (
					receipt.scope &&
					!state.standardChanges.some((c) => c.ownerMessageId === message.messageId)
				) {
					const change = receipt.change ?? 'add';
					const criterionId =
						change === 'add' ? `owner:${message.messageId}` : receipt.criterionId!;
					add({
						kind: 'standard_change',
						actor: 'owner',
						approvedBy: 'owner',
						ownerMessageId: message.messageId,
						criterionId,
						change,
						before: state.criteria.find((c) => c.id === criterionId)?.text,
						after:
							change === 'remove'
								? undefined
								: change === 'add'
									? message.text
									: receipt.criterion!.text,
						reason: message.text,
						criterion:
							change === 'remove'
								? undefined
								: {
										...receipt.criterion,
										id: criterionId,
										text: change === 'add' ? message.text : receipt.criterion!.text,
										proof: receipt.criterion?.proof ?? 'qa',
										how: receipt.criterion?.how ?? 'Independently verify the owner request',
										byOwner: true,
									},
					});
					add({
						kind: 'work_item',
						actor: 'app',
						itemId: criterionId,
						title: message.text,
						owner: 'dev',
						state: 'claimed',
						criterionId,
					});
				}
				add({
					kind: 'message_handled',
					actor: 'app',
					messageId: message.messageId,
					seat: actor,
					summary: report.summary,
				});
			}
			for (const resolved of report.resolvedStandards ?? [])
				add({ kind: 'standard_issue_resolved', actor, ...resolved });
			break;
	}
	if (
		report.type !== 'topic' &&
		![
			'position',
			'proposal',
			'response',
			'retro',
			'challenge',
			'wrap_up',
			'wait',
			'recovery',
		].includes(report.type)
	)
		for (const item of state.workItems.filter(
			(item) => item.discussionId && item.owner === actor && item.state === 'claimed'
		))
			add({ ...item, kind: 'work_item', actor, state: 'done' });
	if (
		typeof report.topic === 'object' &&
		!(foldedIntoChallenge && report.topic.kind === 'standard')
	)
		topic(report.topic);
	if (report.standardChanges?.length) {
		if (foldedIntoChallenge) {
			// Already recorded as objections for PM's answer.
		} else if (draft && actor === 'pm') draftRevision(report.standardChanges);
		else for (const change of report.standardChanges) standardChange(change);
	}

	for (const action of report.requestedActions ?? [])
		add({ kind: 'action_requested', actor, ...action });
	return events.map((event, index) => ({ ...event, id: `${dispatch.dispatchId}:domain:${index}` }));
}
