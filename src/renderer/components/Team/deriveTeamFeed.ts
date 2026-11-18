import type { LedgerEvent, TeamPhase } from '../../../shared/team/types';

export interface TeamFeedGroup {
	id: string;
	phase: TeamPhase;
	events: LedgerEvent[];
}

/** Presentation ordering only. All facts and counters come from reduceLedger. */
export function deriveTeamFeed(events: readonly LedgerEvent[]): TeamFeedGroup[] {
	const groups: TeamFeedGroup[] = [];
	let phase: TeamPhase = 'clarify';
	let group: TeamFeedGroup | undefined;
	for (const event of events) {
		// Scheduler bookkeeping is not a member follow-up or owner-facing conversation.
		if (
			(event.kind === 'follow_up_registered' || event.kind === 'follow_up_fired') &&
			(event.followUpId.startsWith('job:') || event.followUpId.startsWith('job-retry:'))
		)
			continue;
		if (
			event.kind === 'report_accepted' &&
			['position', 'proposal', 'response', 'retro', 'message'].includes(event.report.type)
		)
			continue;
		if (event.kind === 'phase_changed') {
			phase = event.to;
			group = undefined;
			continue;
		}
		switch (event.kind) {
			case 'team_created':
			case 'report_accepted':
			case 'brief_published':
			case 'challenge_submitted':
			case 'brief_response':
			case 'baseline_proposed':
			case 'baseline_confirmed':
			case 'discussion_opened':
			case 'standard_change':
			case 'check_run':
			case 'issue_opened':
			case 'quota_exhausted':
			case 'substitute_took_over':
			case 'review':
			case 'retro':
			case 'demo':
			case 'decision_card':
			case 'owner_message':
			case 'follow_up_registered':
			case 'follow_up_fired':
			case 'member_fault':
			case 'member_recovered':
			case 'terminal':
			case 'changes_requested':
			case 'paused':
			case 'resumed':
			case 'stopped':
				if (!group) {
					group = { id: event.id, phase, events: [] };
					groups.push(group);
				}
				group.events.push(event);
		}
	}
	return groups;
}
