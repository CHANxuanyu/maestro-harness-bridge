import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamMemberView } from '../../../../renderer/components/Team/TeamMemberView';
import { LayerStackProvider } from '../../../../renderer/contexts/LayerStackContext';
import { TeamDiscussion } from '../../../../renderer/components/Team/TeamDiscussion';
import { TeamBaseline, BaselineDiffView } from '../../../../renderer/components/Team/TeamBaseline';
import { TeamDecisions } from '../../../../renderer/components/Team/TeamDecisions';
import {
	TeamReview,
	TeamRetro,
	TeamReviewRecord,
} from '../../../../renderer/components/Team/TeamReview';
import { TeamFeed, DemoCard } from '../../../../renderer/components/Team/TeamFeed';
import { TeamOutput } from '../../../../renderer/components/Team/TeamOutput';
import { TeamComposer } from '../../../../renderer/components/Team/TeamComposer';
import { OwnerCard } from '../../../../renderer/components/Team/OwnerCard';
import { useTeamStore } from '../../../../renderer/stores/teamStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { resetAllStores, resetStore } from '../../../helpers';
import { mockTheme } from '../../../helpers/mockTheme';
import {
	ledger,
	baseline,
	brief,
	config,
	proven,
	type EventInput,
} from '../../../shared/team/fixtures';
import { reduceLedger } from '../../../../shared/team/ledger';
import { baselineDiff } from '../../../../shared/team/policy';
import type { OwnerCard as Card } from '../../../../shared/team/types';
import type { TeamClient } from '../../../../renderer/services/teamClient';
import { team as en } from '../../../../renderer/i18n/locales/en/team';
import { team as zh } from '../../../../renderer/i18n/locales/zh-CN/team';

const bridge = vi.hoisted(() => ({ current: undefined as TeamClient | undefined }));
vi.mock('../../../../renderer/services/teamClient', async (original) => ({
	...(await original<typeof import('../../../../renderer/services/teamClient')>()),
	teamClient: () => bridge.current,
}));
const opening: EventInput = {
	kind: 'discussion_opened',
	discussionId: 'topic-id',
	actor: 'qa',
	topic: 'Choose a viewer',
	owner: 'dev',
	layer: 'implementation',
	participants: ['pm', 'dev', 'qa'],
	trigger: 'member',
};
const position: EventInput = {
	kind: 'position',
	discussionId: 'topic-id',
	seat: 'qa',
	claim: 'Secret position',
	basis: 'Fresh sample',
	wouldChangeMind: 'Contradictory sample',
};
const proposal: EventInput = {
	kind: 'proposal',
	discussionId: 'topic-id',
	proposal: 'Use the reversible viewer',
	decider: 'dev',
};
const closed: EventInput = {
	kind: 'discussion_closed',
	discussionId: 'topic-id',
	decision: 'Use viewer B',
	decider: 'dev',
	contested: true,
	dissent: 'QA retains a concern',
	actions: [],
};
const discussionState = (...entries: EventInput[]) =>
	reduceLedger(ledger(...baseline, opening, position, proposal, ...entries));

beforeEach(() => {
	resetAllStores();
	resetStore(useTeamStore);
	vi.clearAllMocks();
	useSettingsStore.setState({ uiLanguage: 'en' });
	bridge.current = {
		baselineEdit: vi.fn().mockResolvedValue({}),
		baselineDiff: vi.fn().mockResolvedValue(baselineDiff(brief, brief)),
		baselineReturn: vi.fn().mockResolvedValue(undefined),
		answer: vi.fn().mockResolvedValue(undefined),
	} as unknown as TeamClient;
});

describe('M2 discussions and decisions', () => {
	it('keeps submitted positions sealed until the response assignment opens step 3, then updates the same card', () => {
		const state = discussionState();
		const view = render(<TeamDiscussion state={state} discussion={state.discussions[0]} />);
		expect(view.container.querySelectorAll('[data-discussion-step]')).toHaveLength(2);
		expect(view.container.querySelector('[data-step]')).toHaveAttribute('data-step', '2');
		expect(screen.queryByText('Secret position')).not.toBeInTheDocument();
		expect(view.container.querySelectorAll('[data-sealed="true"]')).toHaveLength(3);
		const responding = discussionState({
			kind: 'turn_dispatched',
			seat: 'qa',
			dispatchId: 'response-turn',
			turn: 'response',
			discussionId: 'topic-id',
		});
		view.rerender(<TeamDiscussion state={responding} discussion={responding.discussions[0]} />);
		expect(screen.getByText('Secret position')).toBeInTheDocument();
		expect(view.container.querySelector('[data-step]')).toHaveAttribute('data-step', '3');
		const decided = discussionState(closed);
		view.rerender(<TeamDiscussion state={decided} discussion={decided.discussions[0]} />);
		expect(view.container.querySelectorAll('[data-card="discussion"]')).toHaveLength(1);
		expect(view.container.querySelector('[data-contested]')).toBeInTheDocument();
		expect(screen.getByText('QA retains a concern', { exact: false })).toBeInTheDocument();
	});
	it.each([
		['implementation', false, 'dev'],
		['fact', false, 'app'],
		['experience', false, 'pm'],
		['commitment', false, 'owner'],
		['implementation', true, 'owner'],
	] as const)('uses the lawful decider for %s irreversible=%s', (layer, irreversible, decider) => {
		const state = reduceLedger(
			ledger(...baseline, { ...opening, layer, reversible: !irreversible })
		);
		const { container } = render(
			<TeamDiscussion state={state} discussion={state.discussions[0]} />
		);
		expect(container.querySelector('[data-discussion-authority]')).toHaveAttribute(
			'data-discussion-authority',
			decider
		);
	});
	it.each(['en', 'zh-CN'] as const)(
		'shows pending authority and only started steps in %s',
		(locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			const strings = locale === 'en' ? en : { ...en, ...zh };
			const events = ledger(...baseline, { ...opening, actor: 'app' }, position);
			const state = reduceLedger(events);
			const view = render(<TeamDiscussion state={state} discussion={state.discussions[0]} />);
			const header = view.container.querySelector('summary')!;
			expect(header).toHaveTextContent(
				strings['workflows.team.teamWillDecide'].replace('{seat}', strings['workflows.team.dev'])
			);
			expect(header.textContent).not.toMatch(/·\s*·/);
			expect(header).not.toHaveTextContent(
				strings['workflows.team.decidedBy'].replace('{seat}', strings['workflows.team.dev'])
			);
			expect(view.container).toHaveTextContent(strings['workflows.team.raisedByApp']);
			expect(view.container.querySelectorAll('[data-discussion-step]')).toHaveLength(1);
			expect(view.container.querySelector('[data-discussion-current-step]')).toHaveAttribute(
				'data-discussion-current-step',
				'1'
			);
			expect(view.container.querySelector('h4[aria-current="step"]')).toHaveTextContent(
				strings['workflows.team.step.positions']
			);
			const decided = reduceLedger(ledger(...events, closed));
			view.rerender(<TeamDiscussion state={decided} discussion={decided.discussions[0]} />);
			expect(header).toHaveTextContent(
				strings['workflows.team.decidedBy'].replace('{seat}', strings['workflows.team.dev'])
			);
			expect(header).toHaveTextContent(closed.decision);
			expect(header).not.toHaveTextContent(
				strings['workflows.team.teamWillDecide'].replace('{seat}', strings['workflows.team.dev'])
			);
			expect(view.container.querySelectorAll('[data-discussion-step]')).toHaveLength(4);
			expect(view.container.querySelector('[data-discussion-current-step]')).toHaveAttribute(
				'data-discussion-current-step',
				'4'
			);
		}
	);
	it.each(['unchanged', 'revised'] as const)(
		'labels proposal rounds and marks %s text without repeating it',
		(change) => {
			const second = change === 'unchanged' ? proposal.proposal : 'Use the revised viewer';
			const state = discussionState({ ...proposal, round: 2, proposal: second }, closed);
			const { container } = render(
				<TeamDiscussion state={state} discussion={state.discussions[0]} />
			);
			const first = container.querySelector('[data-proposal-round="1"]')!;
			const next = container.querySelector('[data-proposal-round="2"]')!;
			expect(first).toHaveTextContent(en['workflows.team.round'].replace('{round}', '1'));
			expect(next).toHaveTextContent(en['workflows.team.round'].replace('{round}', '2'));
			expect(next).toHaveAttribute('data-unchanged', String(change === 'unchanged'));
			expect(first).toHaveTextContent(proposal.proposal);
			if (change === 'unchanged') {
				expect(next).not.toHaveTextContent(proposal.proposal);
				expect(next).toHaveTextContent(en['workflows.team.proposalUnchanged']);
			} else {
				expect(next).toHaveTextContent(second);
				expect(next).toHaveTextContent(en['workflows.team.proposalRevised']);
			}
		}
	);
	it('separates newest-first team and owner decisions, includes basis and links to the topic', () => {
		const events = ledger(
			...baseline,
			opening,
			position,
			proposal,
			closed,
			{ ...closed, discussionId: 'other', decision: 'Newest decision' },
			{ ...closed, discussionId: 'owner-topic', decider: 'owner', decision: 'Owner decision' }
		);
		const state = reduceLedger(events);
		const open = vi.fn();
		const { container } = render(
			<TeamDecisions state={state} events={events} onDiscussion={open} />
		);
		const team = container.querySelector('[data-decisions="team"]')!;
		expect(team.querySelector('[data-decision]')).toHaveTextContent('Newest decision');
		expect(team).not.toHaveTextContent('Owner decision');
		expect(container.querySelector('[data-decisions="owner"]')).toHaveTextContent('Owner decision');
		expect(team).toHaveTextContent('Fresh sample');
		fireEvent.click(within(team as HTMLElement).getAllByRole('button')[1]);
		expect(open).toHaveBeenCalledWith('topic-id');
	});
});

describe('M2 baseline and standard changes', () => {
	it.each(['en', 'zh-CN'] as const)(
		'keeps the baseline challenge scope, objections and PM answers frozen in %s',
		(language) => {
			useSettingsStore.setState({ uiLanguage: language });
			const strings = language === 'en' ? en : zh;
			const revised = {
				...brief,
				version: brief.version + 1,
				criteria: brief.criteria.map((criterion) =>
					criterion.id === 'A1' ? { ...criterion, text: 'Parses whole hours' } : criterion
				),
			};
			const events = ledger(
				...baseline,
				{
					kind: 'challenge_submitted',
					seat: 'dev',
					briefVersion: brief.version,
					objections: [{ about: 'A1', kind: 'risk', problem: 'Which hour samples?' }],
				},
				{ kind: 'brief_published', brief: revised },
				{
					kind: 'challenge_submitted',
					seat: 'qa',
					briefVersion: revised.version,
					objections: [{ about: 'A1', kind: 'risk', problem: 'What about fractional hours?' }],
					plans: [{ criterion: 'A1', how: 'Inspect whole hours', data: '1h' }],
				},
				{
					kind: 'brief_response',
					decisions: [
						{ about: 'A1', result: 'reject', reason: 'Fractional hours remain out of scope' },
					],
				}
			);
			const snapshot = reduceLedger(events);
			const card: Card = {
				id: 'challenge-baseline',
				boundary: 'baseline',
				title: 'Baseline',
				body: 'Human body',
				options: [{ id: 'confirm', label: 'Confirm' }],
				payload: {
					type: 'baseline',
					brief: revised,
					trials: [],
					challenges: snapshot.challenges,
					responses: snapshot.briefResponses,
					question: 'Confirm the integer-only boundary',
					challengeRound: { round: 2, criteria: ['A1'], diff: baselineDiff(brief, revised) },
				},
			};
			const state = reduceLedger([
				...events,
				{
					...snapshot.challenges[0],
					id: 'later-challenge',
					seq: events.length + 1,
					briefVersion: revised.version + 1,
					objections: [{ about: 'A1', kind: 'risk', problem: 'Later cycle objection' }],
				},
			]);
			const { container } = render(
				<OwnerCard card={card} state={state} teamId={config.id} answered="superseded" />
			);
			const scope = container.querySelector('[data-challenge-round="2"]')!;
			expect(scope).toHaveTextContent(
				strings['workflows.team.challengeSecond'].replace('{criteria}', 'Parses whole hours')
			);
			expect(scope).not.toHaveTextContent(brief.criteria[1].text);
			expect(container.querySelectorAll('[data-challenge-version]')).toHaveLength(2);
			const history = container.querySelector('[data-card="baseline-challenge-history"]')!;
			fireEvent.click(history.querySelector('summary')!);
			expect(history).toHaveAttribute('open');
			expect(history).toHaveTextContent('What about fractional hours?');
			expect(history).toHaveTextContent('Fractional hours remain out of scope');
			expect(history).toHaveTextContent(strings['workflows.team.objection.reject']);
			expect(history).not.toHaveTextContent('Later cycle objection');
			expect(container).toHaveTextContent('Confirm the integer-only boundary');
			expect(container).not.toHaveTextContent('briefVersion');
			expect(container.querySelector('[data-boundary-reason]')).not.toBeInTheDocument();
		}
	);
	it.each(['en', 'zh-CN'] as const)(
		'edits all three fields, returns a note and reads the backend diff using keyboard in %s',
		async (language) => {
			useSettingsStore.setState({ uiLanguage: language });
			const t = language === 'en' ? en : { ...en, ...zh };
			const state = reduceLedger(ledger(...baseline));
			const { container } = render(<TeamBaseline brief={brief} state={state} editable />);
			fireEvent.click(container.querySelector('[data-action="edit-criterion"]')!);
			const text = screen.getByLabelText(t['workflows.team.criterionText']);
			expect(text).toHaveFocus();
			// An exact browser label lookup must not include the textarea's initial text.
			const label = container.querySelector(`label[for="${text.id}"]`)!;
			expect(label.textContent).toBe(t['workflows.team.criterionText']);
			expect(text).toHaveAccessibleName(t['workflows.team.criterionText']);
			expect(text).toBeInstanceOf(HTMLTextAreaElement);
			fireEvent.change(text, { target: { value: 'Parse complete hours' } });
			screen.getByLabelText(t['workflows.team.proofKind']).focus();
			fireEvent.change(screen.getByLabelText(t['workflows.team.proofKind']), {
				target: { value: 'qa' },
			});
			expect(screen.getByLabelText(t['workflows.team.proofKind'])).toHaveFocus();
			fireEvent.change(screen.getByLabelText(t['workflows.team.proofHow']), {
				target: { value: 'Inspect sample' },
			});
			fireEvent.submit(text.closest('form')!);
			await waitFor(() =>
				expect(bridge.current!.baselineEdit).toHaveBeenCalledWith(
					config.id,
					'A1',
					'Parse complete hours',
					{ proof: 'qa', how: 'Inspect sample' }
				)
			);
			await waitFor(() =>
				expect(container.querySelector('[data-action="edit-criterion"]')).toHaveFocus()
			);
			fireEvent.click(container.querySelector('[data-action="baseline-diff"]')!);
			await waitFor(() => expect(bridge.current!.baselineDiff).toHaveBeenCalledWith(config.id));
			fireEvent.click(container.querySelector('[data-action="baseline-return"]')!);
			const note = screen.getByLabelText(t['workflows.team.returnNote']);
			expect(note).toHaveFocus();
			fireEvent.change(note, { target: { value: 'Clarify the empty state' } });
			fireEvent.submit(note.closest('form')!);
			await waitFor(() =>
				expect(bridge.current!.baselineReturn).toHaveBeenCalledWith(
					config.id,
					'Clarify the empty state'
				)
			);
			expect(state.brief).toEqual(brief);
		}
	);
	it('shows only changed fields with struck-through previous text and keeps historical versions', () => {
		const after = {
			...brief,
			version: 2,
			criteria: brief.criteria.map((c, i) =>
				i ? c : { ...c, text: 'New text', how: 'New proof method' }
			),
		};
		const { container } = render(
			<BaselineDiffView
				diff={baselineDiff(brief, after)}
				state={reduceLedger(ledger(...baseline))}
			/>
		);
		expect(container.querySelectorAll('[data-diff-criterion]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-diff-field]')).toHaveLength(2);
		expect(container.querySelectorAll('del')).toHaveLength(2);
		expect(container).not.toHaveTextContent(brief.scope);
		expect(container).not.toHaveTextContent(brief.criteria[1].text);
	});
	it.each([
		['approve', 'en'],
		['keep', 'en'],
		['approve', 'zh-CN'],
		['keep', 'zh-CN'],
	] as const)(
		'shows the old standard and failing state until an owner %s event arrives in %s',
		async (option, locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			const strings = locale === 'en' ? en : { ...en, ...zh };
			const card: Card = {
				id: 'change-card',
				title: 'Transport title',
				body: '{"failingNow":true}',
				boundary: 'commitment',
				standardChange: {
					criterionId: 'A1',
					change: 'relax',
					criterion: { ...brief.criteria[0], text: 'Relaxed criterion' },
					reason: 'A failing check',
				},
				payload: {
					type: 'discussion',
					before: brief.criteria[0],
					after: { ...brief.criteria[0], text: 'Relaxed criterion' },
					failingNow: true,
					positions: [],
					responses: [],
					proposal: 'Relax this criterion',
					boundary: 'The next step is irreversible or changes a commitment.',
				},
				options: [
					{ id: 'approve', label: 'Approve' },
					{ id: 'keep', label: 'Keep', recommended: true },
				],
				referenceVotes: 'Reference only',
			};
			const events = ledger(...baseline, { kind: 'decision_card', card });
			const state = reduceLedger(events);
			const { container } = render(<OwnerCard card={card} state={state} teamId={config.id} />);
			expect(container.querySelector('[data-standard="before"]')).toHaveTextContent(
				brief.criteria[0].text
			);
			expect(container.querySelector('[data-failing-now]')).toBeInTheDocument();
			expect(container.querySelector('[data-reference-votes]')).toBeInTheDocument();
			expect(container).not.toHaveTextContent('failingNow');
			expect(container.querySelector('[data-boundary-reason]')).toHaveTextContent(
				strings['workflows.team.commitmentBody']
			);
			expect(container.textContent?.split(strings['workflows.team.commitmentBody'])).toHaveLength(
				2
			);
			expect(container.querySelectorAll('button[data-boundary="commitment"]')).toHaveLength(2);
			const approve = container.querySelector('[data-option="approve"]')!;
			const keep = container.querySelector('[data-option="keep"]')!;
			expect(approve).toHaveTextContent(strings['workflows.team.approveStandardCost']);
			expect(keep).toHaveTextContent(strings['workflows.team.keepFailingStandardCost']);
			expect(approve).not.toHaveTextContent(card.standardChange!.reason);
			expect(keep).not.toHaveTextContent(card.standardChange!.reason);
			expect(
				container.textContent?.split(
					strings['workflows.team.boundary'].replace(
						'{boundary}',
						strings['workflows.team.boundary.commitment']
					)
				)
			).toHaveLength(2);
			fireEvent.click(container.querySelector(`[data-option="${option}"]`)!);
			await waitFor(() =>
				expect(bridge.current!.answer).toHaveBeenCalledWith(config.id, card.id, option, undefined)
			);
			expect(state.criteria[0].text).toBe(brief.criteria[0].text);
			const next = reduceLedger(
				ledger(
					...baseline,
					{ kind: 'decision_card', card },
					{ kind: 'card_answered', cardId: card.id, optionId: option },
					...(option === 'approve'
						? [
								{
									kind: 'standard_change' as const,
									criterionId: 'A1',
									change: 'relax' as const,
									before: brief.criteria[0].text,
									after: 'Relaxed criterion',
									criterion: card.standardChange!.criterion,
									reason: 'Owner approved',
									approvedBy: 'owner' as const,
								},
							]
						: [])
				)
			);
			expect(next.criteria[0].text).toBe(
				option === 'approve' ? 'Relaxed criterion' : brief.criteria[0].text
			);
		}
	);
});

describe('M2 reviews, demos and messages', () => {
	it('renders a structured follow-up receipt as a human observation', () => {
		const events = ledger(...baseline, {
			kind: 'follow_up_fired',
			followUpId: 'ci',
			result: '{"state":"completed","observedAt":123,"conclusion":"success"}',
		});
		const { container } = render(
			<TeamFeed
				state={reduceLedger(events)}
				events={events}
				theme={mockTheme}
				onChanges={vi.fn()}
			/>
		);
		expect(container).toHaveTextContent('Completed: success');
		expect(container).not.toHaveTextContent('observedAt');
	});

	it('links the seat assignment and its reply to the domain records produced by that dispatch', async () => {
		bridge.current!.seatTranscript = vi.fn().mockResolvedValue(null);
		const events = ledger(
			...baseline,
			{ kind: 'turn_dispatched', seat: 'pm', dispatchId: 'brief-turn', turn: 'brief' },
			{
				kind: 'report_accepted',
				seat: 'pm',
				dispatchId: 'brief-turn',
				report: { type: 'brief', ...brief },
			},
			{ kind: 'brief_published', brief }
		);
		events.at(-1)!.id = 'brief-turn:domain:0';
		useTeamStore.getState().mirror({ config, events });
		const { container } = render(
			<LayerStackProvider>
				<TeamMemberView
					teamId={config.id}
					seat="pm"
					state={reduceLedger(events)}
					theme={mockTheme}
				/>
			</LayerStackProvider>
		);
		await waitFor(() =>
			expect(bridge.current!.seatTranscript).toHaveBeenCalledWith(config.id, 'pm')
		);
		expect(container.querySelector('[data-turn="brief-turn"] [data-turn-reply]')).toHaveTextContent(
			brief.scope
		);
		expect(
			container.querySelector('[data-turn="brief-turn"] [data-turn-events] [data-card="brief"]')
		).toBeInTheDocument();
		expect(container.textContent).not.toContain('brief-turn');
	});

	const rejection: EventInput = {
		kind: 'review',
		actor: 'pm',
		verdict: 'reject',
		problems: [
			{
				title: 'Unreadable footer',
				location: '/project/result.html',
				criterion: 'E1',
				impact: 'Cannot read the result',
				expected: 'Readable footer',
			},
		],
		suggestions: ['Consider animation'],
	};
	const retro: EventInput = {
		kind: 'retro',
		reason: 'rejections',
		summary: 'Compare both viewers',
		progressEvidence: 'One issue resolved',
		approach: 'Independent comparison',
		basis: 'QA sample',
		difference: 'Inspect both images',
	};
	it('keeps suggestions separate, uses relative locations and renders approach plus the attempt ledger after two rejections', () => {
		const state = reduceLedger(ledger(...baseline, rejection, rejection, retro));
		const { container } = render(
			<>
				<TeamReview review={state.reviews[1]} state={state} />
				<TeamRetro retro={state.retros[0]} />
				<TeamReviewRecord state={state} />
			</>
		);
		expect(container.querySelector('[data-review-problems]')).not.toHaveTextContent(
			'Consider animation'
		);
		expect(container.querySelector('[data-review-suggestions]')).toHaveTextContent(
			'Consider animation'
		);
		expect(container).not.toHaveTextContent('/project');
		expect(container).toHaveTextContent(brief.criteria[2].text);
		expect(container.querySelector('[data-card="retro"]')).toHaveTextContent(
			'Independent comparison'
		);
		expect(container.querySelectorAll('[data-review-attempt]')).toHaveLength(3);
	});
	it('gates demos on all confirmed evidence and keeps the second demo limited to its delta', () => {
		const events = ledger(
			...proven,
			{ kind: 'review', verdict: 'pass', problems: [], suggestions: [] },
			{ kind: 'demo', criterionIds: ['A1', 'A2', 'E1'] },
			{ kind: 'demo', criterionIds: ['A2'], changes: ['Empty input'] }
		);
		const state = reduceLedger(events);
		const view = render(
			<DemoCard state={state} theme={mockTheme} active={false} onChanges={vi.fn()} />
		);
		expect(view.container.querySelector('[data-card="demo"]')).toBeInTheDocument();
		expect(view.container.querySelector('[data-demo-delta]')).toBeInTheDocument();
		expect(view.container).toHaveTextContent(brief.criteria[1].text);
		expect(view.container).not.toHaveTextContent(brief.criteria[0].text);
		view.rerender(
			<DemoCard
				state={reduceLedger(
					ledger(...baseline, { kind: 'review', verdict: 'pass', problems: [], suggestions: [] })
				)}
				theme={mockTheme}
				active={false}
				onChanges={vi.fn()}
			/>
		);
		expect(view.container.querySelector('[data-card="demo"]')).toBeNull();
	});
	it('selects the exact beforeOutputId rather than a guessed pre-review output', () => {
		const state = reduceLedger(
			ledger(
				...baseline,
				{ kind: 'output_captured', outputId: 'before', files: ['before.txt'], previews: [] },
				{ kind: 'output_captured', outputId: 'unrelated', files: ['unrelated.txt'], previews: [] },
				{
					kind: 'output_captured',
					outputId: 'now',
					beforeOutputId: 'before',
					files: ['now.txt'],
					previews: [],
				}
			)
		);
		const { container } = render(<TeamOutput state={state} theme={mockTheme} disclosure={false} />);
		fireEvent.click(screen.getByRole('radio', { name: en['workflows.team.before'], exact: true }));
		expect(container).toHaveTextContent('before.txt');
		expect(container).not.toHaveTextContent('unrelated.txt');
	});
	it('mirrors queued, delivered and handled receipts in the composer and feed without inferring completion', () => {
		const events: EventInput[] = [
			...baseline,
			{ kind: 'owner_message', messageId: 'message-id', to: 'dev', text: 'Explain the result' },
		];
		const node = () => {
			const stream = ledger(...events);
			const state = reduceLedger(stream);
			return (
				<>
					<TeamComposer state={state} />
					<TeamFeed state={state} events={stream} theme={mockTheme} onChanges={vi.fn()} />
				</>
			);
		};
		const view = render(node());
		for (const delivery of ['queued', 'delivered', 'handled'] as const) {
			if (delivery === 'delivered')
				events.push({ kind: 'message_delivered', messageId: 'message-id', seat: 'dev' });
			if (delivery === 'handled')
				events.push({
					kind: 'message_handled',
					messageId: 'message-id',
					seat: 'dev',
					summary: 'Sample explained',
				});
			view.rerender(node());
			expect(view.container.querySelector('[data-card="owner-message"]')).toHaveAttribute(
				'data-delivery',
				delivery
			);
			expect(screen.getByRole('status')).toHaveAttribute('data-delivery', delivery);
		}
	});
});
