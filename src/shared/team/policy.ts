import { resolveAgentAccountKey, resolveAgentBillingCredential } from '../providerProfiles';
import { getModelFamily } from '../modelFamily';
import { isPathAtOrUnderRoot, normalizeWorktreePath } from '../worktreePaths';
import { decideNext, judgeAttempts, type Candidate } from '../progressRules';
import { truncateText } from '../formatters';
import type {
	BaselineDiff,
	Brief,
	LedgerActor,
	OutputCapture,
	SeatRole,
	SeatModel,
	StandardChangeRequest,
	TeamDiscussion,
	TeamIssue,
	TeamState,
	TeamTopic,
	TurnKind,
} from './types';

/** Effort changes do not make an exhausted model available. */
export function sameTeamModel(a: SeatModel, b: SeatModel): boolean {
	return a.tool === b.tool && a.model === b.model;
}

/** Quota belongs to the launch account, not to a turn kind or a native conversation. */
export function teamModelUnavailable(
	state: TeamState,
	model: SeatModel,
	source: SeatRole
): boolean {
	return state.unavailable.some((entry) => {
		const original = state.config!.seats[entry.configSource ?? entry.seat];
		const target = state.config!.seats[source];
		return (
			sameTeamModel(entry.model ?? original, model) &&
			resolveAgentAccountKey(model.tool, original.customEnv, undefined) ===
				resolveAgentAccountKey(model.tool, target.customEnv, undefined) &&
			resolveAgentBillingCredential(model.tool, original.customEnv ?? {})?.id ===
				resolveAgentBillingCredential(model.tool, target.customEnv ?? {})?.id
		);
	});
}

/** Ordered, authorized recovery choices. All escalation uses the common decision rules. */
export function teamRecoveryDecision(state: TeamState, seat: SeatRole, temporary: boolean) {
	const config = state.config!;
	const health = state.seats[seat];
	const unavailable = state.unavailable.filter((q) => q.seat === seat).at(-1);
	const choices: Array<{ model: SeatModel; source: SeatRole; temporary: boolean }> = [];
	const substitute = config.seats[seat].substitute;
	if (substitute)
		choices.push({
			model: substitute,
			source:
				(['pm', 'qa', 'dev'] as SeatRole[]).find(
					(role) => role !== seat && sameTeamModel(config.seats[role], substitute)
				) ?? seat,
			temporary: false,
		});
	if (temporary) {
		const family = (model: SeatModel) =>
			getModelFamily(model.model ?? (model.tool === 'claude-code' ? 'claude' : model.tool));
		const devFamily = family(state.seats.dev.model ?? config.seats.dev);
		for (const source of (['pm', 'qa', 'dev'] as SeatRole[]).sort(
			(a, b) =>
				Number(family(config.seats[a]) === devFamily) -
				Number(family(config.seats[b]) === devFamily)
		)) {
			if (source !== seat) choices.push({ model: config.seats[source], source, temporary: true });
		}
	}
	const available = choices.filter((c) => !teamModelUnavailable(state, c.model, c.source));
	const candidates: Candidate[] = available.map((c, i) => ({
		key: `takeover:${i}`,
		plan: `Use ${c.model.tool}${c.model.model ? ` ${c.model.model}` : ''} in a new conversation`,
		basis: c.temporary
			? 'Team model and temporary takeover authorization'
			: 'Explicitly selected substitute',
	}));
	if (
		!unavailable?.login &&
		(config.deadline === undefined ||
			unavailable?.resetsAt === undefined ||
			unavailable.resetsAt < config.deadline)
	)
		candidates.push({
			key: 'wait',
			plan: 'Wait for the original model to recover',
			basis: 'Waiting remains within the deadline',
		});
	if (unavailable?.login)
		candidates.push({
			key: 'login',
			plan: `Restore the ${health.model?.tool ?? config.seats[seat].tool} login for ${seat}`,
			boundary: 'login',
			cost: 'Owner signs in to this seat account; independent work continues.',
			recommended: true,
		});
	else {
		if (!temporary)
			candidates.push({
				key: 'takeover',
				plan: 'Authorize temporary takeover by a model already in this team',
				boundary: 'permission',
				cost: 'Use an independent new conversation and existing team model quota.',
				recommended: true,
			});
		candidates.push({
			key: 'extend',
			plan: 'Extend the deadline to wait for the original model',
			boundary: 'budget',
			cost: `Delivery moves past ${unavailable?.resetsAt ? new Date(unavailable.resetsAt).toISOString() : 'the current deadline'}.`,
		});
	}
	if (candidates.filter((c) => c.boundary).length < 2)
		candidates.push({
			key: 'stop',
			plan: 'Stop and preserve the task branch',
			boundary: 'budget',
			cost: 'The unfinished work remains in the ledger; no new model is used.',
		});
	return {
		decision: decideNext(judgeAttempts(['model unavailable'], []), { candidates }),
		choices: available,
	};
}

/** Permissions belong to the assignment, not the seat's usual role. Repairs never redo work. */
export function teamTurnPermission(seat: SeatRole, turn: TurnKind): 'readonly' | 'full' {
	return (seat === 'dev' && (turn === 'work' || turn === 'fix')) ||
		(seat === 'qa' && (turn === 'qa_prep' || turn === 'reverify'))
		? 'full'
		: 'readonly';
}

/** Only changed fields are shown. Previous versions remain immutable in the ledger. */
export function baselineDiff(before: Brief | null, after: Brief): BaselineDiff {
	const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
	return {
		fromVersion: before?.version ?? null,
		toVersion: after.version,
		...(!same(before?.scope, after.scope)
			? { scope: { before: before?.scope ?? '', after: after.scope } }
			: {}),
		...(!same(before?.notDoing, after.notDoing)
			? { notDoing: { before: before?.notDoing ?? [], after: after.notDoing } }
			: {}),
		criteria: [
			...new Set([
				...(before?.criteria ?? []).map((c) => c.id),
				...after.criteria.map((c) => c.id),
			]),
		]
			.map((id) => ({
				id,
				before: before?.criteria.find((c) => c.id === id),
				after: after.criteria.find((c) => c.id === id),
			}))
			.filter((c) => !same(c.before, c.after)),
		...(!same(before?.checks, after.checks)
			? { checks: { before: before?.checks ?? [], after: after.checks } }
			: {}),
	};
}

/** Lexical spelling only. Main checks real paths before accepting QA file claims. */
export function teamWorkspaceRelativePath(
	value: string,
	workspace?: string,
	directory = ''
): string | undefined {
	const windows = !!workspace && (/^[a-z]:[\\/]/i.test(workspace) || workspace.startsWith('\\\\'));
	if (value.includes('\0') || (!windows && value.includes('\\'))) return;
	const separated = normalizeWorktreePath(value, !windows);
	if (separated.split('/').includes('..')) return;
	const normalized = separated
		.split('/')
		.filter((part) => part !== '.')
		.join('/');
	let relative = normalized;
	if (/^(\/|[a-z]:)/i.test(normalized)) {
		if (!workspace) return;
		const root = normalizeWorktreePath(workspace, !windows);
		if (
			!isPathAtOrUnderRoot(
				windows ? normalized.toLowerCase() : normalized,
				windows ? root.toLowerCase() : root
			)
		)
			return;
		relative = normalized.slice(root.length).replace(/^\//, '');
	}
	if (relative.includes(':') || relative.startsWith('/')) return;
	if (directory && !relative.startsWith(`${directory}/`)) return;
	return relative;
}

/** QA artifacts belong to QA even when the criterion also names developer files. */
export function teamOutputLocation(
	target: string,
	workspaces: { dev?: string; qa?: string }
): { workspace: 'dev' | 'qa'; target: string } {
	const qa = teamWorkspaceRelativePath(target, workspaces.qa, 'qa');
	if (qa) return { workspace: 'qa', target: qa };
	const dev = teamWorkspaceRelativePath(target, workspaces.dev);
	// An explicit dev/qa/... absolute path must not become a relative QA claim.
	return { workspace: 'dev', target: dev && !dev.startsWith('qa/') ? dev : target };
}

/** References and descriptions share one source for validation and model prompts. */
export function teamEvidenceCatalog(state: TeamState): Array<{ id: string; description: string }> {
	const entries = [
		...state.checks.flatMap((c) =>
			c.notRun
				? []
				: [c.id, c.evidenceId].map((id) => ({
						id,
						description: `Check ${c.command}: exit ${c.exitCode}${c.timedOut ? ', timed out' : ''}`,
					}))
		),
		...state.outputs.flatMap((o) =>
			[o.outputId, ...o.files, ...o.previews].map((id) => ({
				id,
				description:
					id === o.outputId
						? `Captured output: ${o.files.length} files, ${o.previews.length} previews`
						: `Captured ${o.previews.includes(id) ? 'preview' : 'file'}: ${id}`,
			}))
		),
		...state.criteria.flatMap((c) =>
			c.evidence.flatMap((e) =>
				[e.eventId, e.evidence].map((id) => ({
					id,
					description: `Criterion ${c.id}: ${e.evidence}`,
				}))
			)
		),
	];
	const catalog = new Map<string, { id: string; description: string }>();
	for (const entry of entries)
		if (!catalog.has(entry.id))
			catalog.set(entry.id, {
				...entry,
				description: truncateText(entry.description.replace(/\s+/g, ' '), 240),
			});
	return [...catalog.values()];
}

/** With a discussion, return only evidence not already used before this proposal. */
export function teamEvidence(state: TeamState, discussion?: TeamDiscussion): string[] {
	const used = discussion
		? [
				...(discussion.opened?.evidence ?? []),
				...discussion.positions.flatMap((p) => p.evidence ?? []),
				...discussion.responses
					.filter((r) => r.seq < (discussion.proposals.at(-1)?.seq ?? Infinity))
					.flatMap((r) => (r.evidence ? [r.evidence] : [])),
			]
		: [];
	return teamEvidenceCatalog(state)
		.map((e) => e.id)
		.filter((id) => !used.includes(id));
}

/** One full challenge, then at most one round on the first PM revision's changed criteria. */
export function teamChallengeRound(state: TeamState) {
	const ownerEpoch = Math.max(
		state.baseline.edits.at(-1)?.seq ?? 0,
		state.baseline.returns.at(-1)?.seq ?? 0,
		state.standardChanges.filter((c) => c.approvedBy === 'owner').at(-1)?.seq ?? 0
	);
	const firstChallenge = state.challenges.find((c) => c.seq > ownerEpoch);
	const original = state.briefs.find((b) => b.version === firstChallenge?.briefVersion);
	const revision =
		original &&
		state.briefs.find(
			(b) => b.version > original.version && baselineDiff(original, b).criteria.length > 0
		);
	const response = firstChallenge && state.briefResponses.find((r) => r.seq > firstChallenge.seq);
	const diff = original && revision ? baselineDiff(original, revision) : undefined;
	const changed = diff?.criteria.map((c) => c.id) ?? [];
	const second = !!response && changed.length > 0;
	return {
		ownerEpoch,
		epoch: second ? response.seq : ownerEpoch,
		round: second ? 2 : 1,
		criteria: second ? changed : (state.brief?.criteria.map((c) => c.id) ?? []),
		diff: second ? diff : undefined,
	};
}

export function discussionDecider(discussion: TeamDiscussion): LedgerActor {
	const opened = discussion.opened!;
	if (opened.reversible === false || opened.layer === 'commitment') return 'owner';
	if (opened.layer === 'fact') return 'app';
	if (opened.layer === 'implementation') return 'dev';
	if (opened.layer === 'testing') return 'qa';
	return 'pm';
}

export function topicRejection(topic: TeamTopic, state: TeamState): string | undefined {
	const question = (topic.question ?? topic.topic).trim().toLowerCase();
	const previous = state.discussions.filter(
		(d) =>
			d.decision &&
			(d.id === topic.reopens ||
				(d.opened?.question ?? d.opened?.topic)?.trim().toLowerCase() === question)
	);
	const known = teamEvidence(state);
	if (topic.evidence?.some((e) => !known.includes(e)))
		return 'Topic evidence must reference a recorded observation.';
	if (!previous.length) return;
	const used = previous.flatMap((d) => [
		...(d.opened?.evidence ?? []),
		...d.positions.flatMap((p) => p.evidence ?? []),
		...d.responses.flatMap((r) => (r.evidence ? [r.evidence] : [])),
	]);
	const decidedAt = Math.max(...previous.map((d) => d.decision!.seq));
	const fresh = [
		...state.checks.filter((c) => c.seq > decidedAt).flatMap((c) => [c.id, c.evidenceId]),
		...state.outputs
			.filter((o) => o.seq > decidedAt)
			.flatMap((o) => [o.outputId, ...o.files, ...o.previews]),
		...state.criteria.flatMap((c) =>
			c.evidence.filter((e) => e.seq > decidedAt).flatMap((e) => [e.eventId, e.evidence])
		),
	];
	if (!topic.evidence?.some((e) => !used.includes(e) && fresh.includes(e)))
		return 'A decided question cannot reopen without new recorded evidence.';
}

/** Same-vendor agreement is one reference, with unknown vendors grouped conservatively. */
export function referenceVotes(discussion: TeamDiscussion, state: TeamState): string {
	const round = discussion.proposals.at(-1)?.round ?? discussion.proposals.length;
	const responses = discussion.responses.filter((r) => (r.round ?? 1) === round);
	const groups = new Map<string, Set<string>>();
	for (const response of responses) {
		const model = state.seats[response.seat].model ?? state.config?.seats[response.seat];
		const family = getModelFamily(
			model?.model ?? (model?.tool === 'claude-code' ? 'claude' : (model?.tool ?? ''))
		);
		const families = groups.get(response.result) ?? new Set<string>();
		families.add(family);
		groups.set(response.result, families);
	}
	return (
		[...groups]
			.map(
				([result, families]) =>
					`${responses.filter((r) => r.result === result).length} ${result} (${families.size} vendor group${families.size === 1 ? '' : 's'})`
			)
			.join('; ') + '. Reference only; same-vendor agreement is not independent.'
	);
}

/** R1-3 requires a dev estimate, not PM asserting that the cost is small. */
export function pmMayChange(
	change: StandardChangeRequest,
	state: TeamState,
	discussion?: TeamDiscussion
): boolean {
	const old = state.criteria.find((c) => c.id === change.criterionId);
	if (
		!['add', 'tighten'].includes(change.change) ||
		!change.withinMeaning?.trim() ||
		!change.criterion
	)
		return false;
	if (change.change === 'add' ? !!old : !old) return false;
	if (old && !change.criterion.text.startsWith(old.text)) return false;
	if (discussion?.responses.some((r) => r.baselineViolation)) return false;
	if (
		old &&
		(old.proof !== change.criterion.proof ||
			old.how !== change.criterion.how ||
			JSON.stringify(old.locations) !== JSON.stringify(change.criterion.locations))
	)
		return false;
	// Changing existing numerical examples is a commitment change, even if labelled tightening.
	if (
		old &&
		JSON.stringify(old.text.match(/\d+(?:\.\d+)?/g)) !==
			JSON.stringify(change.criterion.text.match(/\d+(?:\.\d+)?/g))
	)
		return false;
	const estimate = discussion?.positions.find((p) => p.seat === 'dev');
	return (
		estimate?.extraTurns !== undefined &&
		estimate.preservesDeadline === true &&
		estimate.extraTurns <= (state.config?.turnBudget ?? 0) - state.usage.turns
	);
}

/** An empty capture, or a missing named viewer, cannot support a review. */
export function missingOutputLocations(state: TeamState, output?: OutputCapture): string[] {
	if (output?.error) return [`App output capture failed: ${output.error}`];
	if (!output || (!output.files.length && !output.previews.length))
		return ['No real output captured'];
	const visualMissing = state.criteria
		.filter(
			(c) => (c.experience || c.proof === 'pm') && !c.locations?.length && !output.previews.length
		)
		.map((c) => `${c.id}: no rendered preview or screenshot`);
	return [
		...visualMissing,
		...state.criteria.flatMap((criterion) =>
			(criterion.locations ?? [])
				.filter(
					(location) =>
						!output.locations?.some(
							(item) =>
								item.criterion === criterion.id &&
								JSON.stringify(item.location) === JSON.stringify(location) &&
								!item.error &&
								(location.kind === 'file' ? !!item.file : !!item.preview)
						)
				)
				.map((location) => `${criterion.id}: ${location.label} (${location.target})`)
		),
	];
}

export function teamReadyForDemo(state: TeamState): boolean {
	return (
		state.baseline.confirmedVersion !== null &&
		state.criteria.length > 0 &&
		state.criteria.every((c) => c.confirmed && c.status === 'pass') &&
		!state.issues.some(isOpenTeamIssue) &&
		state.reviews.at(-1)?.verdict === 'pass' &&
		!missingOutputLocations(state, state.outputs.at(-1)).length &&
		!state.discussions.some((d) => d.opened && !d.decision) &&
		!state.pendingMessages.length
	);
}

export function topicParticipants(topic: TeamTopic): SeatRole[] {
	const owner =
		topic.layer === 'implementation'
			? 'dev'
			: topic.layer === 'testing'
				? 'qa'
				: (topic.owner ?? 'pm');
	return [...new Set([owner, ...topic.participants])];
}

/** Superseded commitments stay visible in history, never relabelled as verified. */
export function isOpenTeamIssue(issue: TeamIssue): boolean {
	return issue.state !== 'verified-pass' && issue.state !== 'superseded';
}
