import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reduceLedger } from '../../../../shared/team/ledger';
import { ledger, baseline, proven, config, type EventInput } from '../../../shared/team/fixtures';
import { judgeAttempts } from '../../../../shared/progressRules';
import type { OwnerCard as Card, MemberFaultKind } from '../../../../shared/team/types';
import { useModalStore } from '../../../../renderer/stores/modalStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { useTeamStore } from '../../../../renderer/stores/teamStore';
import { resetAllStores, resetStore } from '../../../helpers';
import { mockTheme } from '../../../helpers/mockTheme';
import {
	TeamSeatHealth,
	TeamSeatIdentity,
	TeamLogin,
} from '../../../../renderer/components/Team/TeamHealth';
import { TeamAppStatus, TeamAttempts } from '../../../../renderer/components/Team/TeamProgress';
import { TeamSummary } from '../../../../renderer/components/Team/TeamSummary';
import { OwnerCard } from '../../../../renderer/components/Team/OwnerCard';
import { TeamView } from '../../../../renderer/components/Team/TeamView';
import { TeamSidebar } from '../../../../renderer/components/Team/TeamSidebar';
import { TeamPanel } from '../../../../renderer/components/Team/TeamPanel';
import { TeamComposer } from '../../../../renderer/components/Team/TeamComposer';
import { FeedEvent } from '../../../../renderer/components/Team/TeamFeed';
import { deriveTeamFeed } from '../../../../renderer/components/Team/deriveTeamFeed';
import { team as en } from '../../../../renderer/i18n/locales/en/team';
import { team as zh } from '../../../../renderer/i18n/locales/zh-CN/team';
import { LayerStackProvider } from '../../../../renderer/contexts/LayerStackContext';
import type { TeamClient } from '../../../../renderer/services/teamClient';

const bridge = vi.hoisted(() => ({ client: undefined as TeamClient | undefined }));
vi.mock('../../../../renderer/services/teamClient', async (original) => ({
	...(await original<typeof import('../../../../renderer/services/teamClient')>()),
	teamClient: () => bridge.client,
}));
const snapshot = (...entries: EventInput[]) => reduceLedger(ledger(...baseline, ...entries));
beforeEach(() => {
	resetAllStores();
	resetStore(useTeamStore);
	vi.clearAllMocks();
	useSettingsStore.setState({ uiLanguage: 'en' });
	bridge.client = {
		answer: vi.fn(async () => {}),
		assignResidual: vi.fn(async () => {}),
		say: vi.fn(async () => ({})),
	} as unknown as TeamClient;
});

describe('M3 seat health', () => {
	it.each<MemberFaultKind>([
		'turn-failed',
		'missing-report',
		'bad-report',
		'session-broken',
		'model-unavailable',
		'login-expired',
		'idle-turn',
	])('shows %s with detail and never disguises it as working', (fault) => {
		const state = snapshot({
			kind: 'member_fault',
			seat: 'pm',
			fault,
			detail: 'Specific observation',
		});
		state.seats.pm.activeDispatchIds.push('repair');
		const view = render(<TeamSeatHealth state={state} seat="pm" detail />);
		expect(view.container.querySelector('[data-seat-health]')).toHaveAttribute(
			'data-seat-health',
			fault
		);
		expect(view.container.querySelector('.animate-spin')).toBeNull();
		expect(view.container.querySelector('[data-seat-health]')).toHaveAttribute(
			'title',
			expect.stringContaining('Specific observation')
		);
		expect(view.container.querySelector('[data-fault]')).toHaveAttribute('data-fault', fault);
	});
	it('distinguishes active work, normal wait and temporary coverage', () => {
		const state = snapshot(
			{
				kind: 'seat_bound',
				seat: 'pm',
				workspace: '/project/dev',
				model: { tool: 'codex', model: 'covered-model' },
				reason: 'temporary',
				configSource: 'dev',
			},
			{
				kind: 'substitute_took_over',
				seat: 'pm',
				model: { tool: 'codex', model: 'covered-model' },
				temporary: true,
			}
		);
		state.seats.pm.activeDispatchIds.push('working');
		const view = render(
			<>
				<TeamSeatIdentity state={state} seat="pm" />
				<TeamSeatHealth state={state} seat="pm" detail />
			</>
		);
		expect(view.container.querySelector('[data-takeover]')).toHaveAttribute(
			'data-takeover',
			'temporary'
		);
		expect(view.container.querySelector('[data-seat-identity]')).toHaveTextContent(
			en['workflows.team.coveredBy']
		);
		expect(screen.getByText(en['workflows.team.switchBack'])).toBeVisible();
		expect(view.container.querySelector('.animate-spin')).not.toBeNull();
		state.seats.pm.activeDispatchIds = [];
		state.followUps = ledger({
			kind: 'follow_up_registered',
			followUpId: 'wait',
			seat: 'pm',
			reason: 'External job',
			waitFor: 'CI',
		}).filter((e) => e.kind === 'follow_up_registered');
		view.rerender(<TeamSeatHealth state={state} seat="pm" />);
		expect(view.container.querySelector('[data-seat-health]')).toHaveAttribute(
			'data-seat-health',
			'waiting'
		);
		expect(view.container.querySelector('.animate-spin')).toBeNull();
	});
});

describe.each(['en', 'zh-CN'] as const)('M3 cards in %s', (language) => {
	it('renders an app status, missing proof and wait recheck from the ledger', () => {
		useSettingsStore.setState({ uiLanguage: language });
		const state = snapshot(
			{ kind: 'member_fault', seat: 'pm', fault: 'model-unavailable' },
			{
				kind: 'follow_up_registered',
				followUpId: 'job:internal',
				seat: 'pm',
				waitFor: 'capture:internal',
				reason: 'Application work in progress',
			},
			{
				kind: 'follow_up_registered',
				followUpId: 'wait',
				seat: 'pm',
				waitFor: 'Quota reset',
				reason: 'No substitute',
				untilMs: 1200000,
			}
		);
		const view = render(<TeamAppStatus state={state} />);
		expect(view.container.querySelector('[data-card="app-status"]')).toBeVisible();
		expect(view.container.querySelector('[data-next-check]')).toHaveAttribute(
			'data-next-check',
			'1200000'
		);
		expect(view.container).toHaveTextContent(state.criteria[0].text);
		const labels = language === 'en' ? en : zh;
		expect(view.container).toHaveTextContent(labels['workflows.team.appStatus']);
		expect(view.container).toHaveTextContent(labels['workflows.team.waitCadence']);
		expect(view.container).not.toHaveTextContent('capture:internal');
	});
	it('renders permission scope, one boundary, costs and an IPC answer', async () => {
		useSettingsStore.setState({ uiLanguage: language });
		const card: Card = {
			id: 'permission:push',
			boundary: 'permission',
			title: 'Backend title',
			body: 'Backend prose',
			payload: {
				type: 'permission',
				action: 'push',
				detail: 'Push the reviewed work',
				branch: 'team/task',
				touchesMain: false,
			},
			options: [
				{ id: 'decline', label: 'Decline' },
				{ id: 'allow', label: 'Allow', recommended: true },
			],
		};
		const state = snapshot({ kind: 'decision_card', card });
		const view = render(<OwnerCard card={card} state={state} teamId={config.id} />);
		expect(view.container.querySelector('[data-touches-main]')).toHaveAttribute(
			'data-touches-main',
			'false'
		);
		expect(view.container.querySelector('[data-card="permission"]')).toHaveTextContent('team/task');
		const buttons = view.container.querySelectorAll('button[data-option]');
		expect(buttons[0]).toHaveAttribute('data-option', 'allow');
		expect(buttons[0]).not.toHaveTextContent(language === 'en' ? 'Boundary' : '边界');
		fireEvent.click(buttons[0]);
		await waitFor(() =>
			expect(bridge.client!.answer).toHaveBeenCalledWith(config.id, card.id, 'allow', undefined)
		);
	});
	it('keeps unfinished report separate from a demo with recommended extension and real gaps', () => {
		useSettingsStore.setState({ uiLanguage: language });
		const state = snapshot();
		const card: Card = {
			id: 'budget',
			boundary: 'budget',
			title: 'Incomplete',
			body: 'Human report',
			extension: { hours: 1, turns: 10 },
			payload: {
				type: 'progress-report',
				missing: state.criteria.map((c) => ({
					id: c.id,
					text: c.text,
					status: c.status,
					reason: c.reason,
				})),
				changes: [],
				contested: [],
				suggestions: [],
				evidenceChanges: [],
			},
			options: [
				{ id: 'extend', label: 'Extend', recommended: true },
				{ id: 'gaps', label: 'Accept gaps' },
				{ id: 'stop', label: 'Stop' },
			],
		};
		const view = render(<OwnerCard card={card} state={state} teamId={config.id} />);
		const report = view.container.querySelector('[data-card="progress-report"]')!;
		expect(report.firstElementChild).toHaveAttribute('data-report-disclaimer');
		expect(report).toHaveTextContent((language === 'en' ? en : zh)['workflows.team.progressFirst']);
		expect(report.querySelectorAll('[data-missing-criterion]')).toHaveLength(3);
		expect(view.container.querySelector('[data-card="demo"]')).toBeNull();
		expect(view.container.querySelector('[data-option="extend"]')).toHaveAttribute(
			'data-primary',
			'true'
		);
	});
});

it('shows all attempt verdicts, repeat identity and diagnosis basis without internal keys', () => {
	const state = snapshot();
	state.problems.internal = {
		initialFailures: ['broken'],
		candidates: [],
		decision: { kind: 'gather', why: '' } as never,
		progress: judgeAttempts(
			['broken'],
			[
				{ id: 'one', fingerprint: 'same', failures: ['broken'], basis: 'First hypothesis' },
				{ id: 'two', fingerprint: 'same', failures: ['broken'], difference: 'No difference' },
				{
					id: 'retro',
					fingerprint: 'diagnosis',
					failures: ['broken'],
					diagnosis: true,
					basis: 'New evidence',
					difference: 'Inspect another cause',
					expectation: 'A passing sample',
				},
				{ id: 'fixed', fingerprint: 'new', failures: [] },
			]
		),
	};
	const view = render(<TeamAttempts state={state} />);
	expect(
		[...view.container.querySelectorAll('[data-verdict]')].map((node) =>
			node.getAttribute('data-verdict')
		)
	).toEqual(['first', 'dup', 'diagnosis', 'solved']);
	expect(view.container).toHaveTextContent('Repeat of #1');
	expect(view.container).toHaveTextContent('New evidence');
	expect(view.container).not.toHaveTextContent('internal');
});

it('lists remembered grants and a bill with canonical per-seat and total values', () => {
	const state = snapshot({
		kind: 'card_answered',
		actor: 'owner',
		cardId: 'permission:push',
		optionId: 'allow',
	});
	state.usage = {
		turns: 4,
		budgetTurns: 3,
		inputTokens: 1000,
		outputTokens: 200,
		costUsd: 0.4,
		durationMs: 2000,
		turnsWithCost: 3,
		turnsWithTokens: 3,
	};
	state.seats.pm.usage = { ...state.usage };
	const view = render(<TeamPanel state={state} theme={mockTheme} tab="members" onTab={() => {}} />);
	expect(view.container.querySelector('[data-grant="push"]')).not.toBeNull();
	const total = view.container.querySelector('[data-cost-seat="total"]')!;
	expect(total.querySelector('[data-turns]')).toHaveAttribute('data-turns', '4');
	expect(total.querySelector('[data-cost]')).toHaveAttribute('data-cost', '0.4');
	expect(total.querySelector('[data-input]')).toHaveAttribute('data-input', '1000');
	expect(total.querySelector('[data-duration]')).toHaveAttribute('data-duration', '2000');
});

it('keeps gaps unmet and assigns their owner through the shared client', async () => {
	const state = snapshot(
		{ kind: 'residual_item', itemId: 'gap', text: 'A1: Needs proof', owner: null },
		{ kind: 'accepted', actor: 'owner', withGaps: ['A1: Needs proof'] }
	);
	const view = render(<TeamSummary state={state} />);
	expect(state.criteria[0].status).not.toBe('pass');
	expect(view.container.querySelector('[data-residual]')).toHaveTextContent('Parses hours');
	fireEvent.change(screen.getByLabelText(en['workflows.team.followUpOwner']), {
		target: { value: 'Alex' },
	});
	fireEvent.click(screen.getByRole('button', { name: en['workflows.team.saveOwner'] }));
	await waitFor(() =>
		expect(bridge.client!.assignResidual).toHaveBeenCalledWith(config.id, 'gap', 'Alex')
	);
});

it.each(['all', 'gaps', 'stopped'] as const)(
	'disables messages in %s and keeps paused messages enabled',
	(terminal) => {
		const state = reduceLedger(
			ledger(...(terminal === 'all' ? proven : baseline), {
				kind: 'terminal',
				terminal,
				residual: [],
			})
		);
		const view = render(
			<LayerStackProvider>
				<TeamComposer state={state} />
			</LayerStackProvider>
		);
		expect(screen.getByRole('textbox')).toBeDisabled();
		view.rerender(
			<LayerStackProvider>
				<TeamComposer state={snapshot({ kind: 'paused' })} />
			</LayerStackProvider>
		);
		expect(screen.getByRole('textbox')).toBeEnabled();
	}
);

it('renders one restart note per inspection and informational wrap-up', () => {
	const events = ledger(
		...baseline,
		{
			kind: 'workspace_inspected',
			dispatchId: 'dispatch',
			revision: 'internal-hash',
			status: ' M result.txt',
			recentCommits: '',
			reason: 'restart',
		},
		{ kind: 'wrap_up', summary: 'Finish proof', priorities: ['A1'], generatedBy: 'pm' }
	);
	const state = reduceLedger(events);
	const groups = deriveTeamFeed(events);
	const view = render(
		<>
			{groups
				.flatMap((group) => group.events)
				.filter((event) => event.kind === 'workspace_inspected' || event.kind === 'wrap_up')
				.map((event) => (
					<FeedEvent
						key={event.id}
						event={event}
						state={state}
						events={events}
						theme={mockTheme}
						onChanges={() => {}}
					/>
				))}
		</>
	);
	expect(view.container.querySelectorAll('[data-card="restart"]')).toHaveLength(1);
	expect(view.container.querySelector('[data-card="wrap-up"]')).toHaveTextContent('Parses hours');
	expect(view.container.querySelector('[data-card="wrap-up"] button')).toBeNull();
	expect(view.container).not.toHaveTextContent('internal-hash');
});

it('opens the existing login dialog for the failed account and keeps recovery confirmation separate', () => {
	const state = snapshot({
		kind: 'quota_exhausted',
		seat: 'pm',
		model: { tool: 'codex' },
		configSource: 'dev',
		login: true,
	});
	state.config = {
		...state.config!,
		seats: {
			...state.config!.seats,
			dev: {
				tool: 'codex',
				customPath: '/synthetic/codex',
				customEnv: { CODEX_HOME: '/synthetic/dev-account' },
			},
		},
	};
	const view = render(<TeamLogin state={state} seat="pm" />);
	fireEvent.click(view.getByRole('button'));
	expect(useModalStore.getState().modals.get('reauth')?.data).toMatchObject({
		host: {
			toolType: 'codex',
			customPath: '/synthetic/codex',
			customEnvVars: { CODEX_HOME: '/synthetic/dev-account' },
		},
	});
	expect(bridge.client!.answer).not.toHaveBeenCalled();
});

it('renders every tried availability path and both boundaries once outside the options', () => {
	const state = snapshot();
	const card: Card = {
		id: 'availability',
		boundary: 'permission',
		boundaries: ['permission', 'budget'],
		title: 'Internal heading',
		body: 'Human body',
		payload: {
			type: 'escalation',
			cause: 'availability',
			stuck: 'Provider refused the turn',
			paths: ['refused', 'no substitute', 'no authority'],
			recommendation: 'Temporary takeover',
		},
		options: [
			{ id: 'takeover', label: 'Take over', recommended: true },
			{ id: 'extend', label: 'Wait' },
		],
	};
	const view = render(<OwnerCard card={card} state={state} teamId={config.id} />);
	expect(view.container.querySelectorAll('[data-card="escalation"] li')).toHaveLength(3);
	expect(view.container.querySelector('[data-boundary="permission"]')).toHaveTextContent(
		en['workflows.team.escalation.availability']
	);
	for (const button of view.container.querySelectorAll('[data-option]')) {
		expect(button).not.toHaveTextContent('Boundary:');
		expect(button).not.toHaveTextContent(/^continue$/i);
	}
	expect(view.container.textContent?.match(/Boundary:/g)).toHaveLength(1);
});

describe.each(['en', 'zh-CN'] as const)('M3 screenshot corrections in %s', (language) => {
	beforeEach(() => useSettingsStore.setState({ uiLanguage: language }));
	it('localizes recovery receipts and renders the takeover explanation only once', () => {
		const events = ledger(
			...baseline,
			{
				kind: 'substitute_took_over',
				seat: 'pm',
				model: { tool: 'codex', model: 'covering-model' },
				temporary: true,
			},
			...[
				'Authorized takeover in a NEW conversation; use the ledger slice and inspect the existing workspace',
				'A valid turn report was ingested.',
				'Original model recovered; switched back in a separate conversation',
				'Owner selected a model; resume from the ledger in a new conversation',
				'Owner confirmed the named login was restored',
			].map((how) => ({ kind: 'member_recovered' as const, seat: 'pm' as const, how }))
		);
		const state = reduceLedger(events);
		const view = render(
			<>
				{events.slice(baseline.length).map((event) => (
					<FeedEvent
						key={event.id}
						event={event}
						events={events}
						state={state}
						theme={mockTheme}
						onChanges={() => {}}
					/>
				))}
			</>
		);
		const labels = language === 'en' ? en : zh;
		expect(view.container.querySelectorAll('[data-card="quota"]')).toHaveLength(1);
		expect(view.container).toHaveTextContent(labels['workflows.team.reportReceived']);
		expect(view.container).toHaveTextContent(labels['workflows.team.loginConfirmed']);
		expect(view.container).not.toHaveTextContent(/ledger slice|NEW conversation|was ingested/);
	});
	it('shows the wait provider, reset and next check instead of backend sampling instructions', () => {
		const events = ledger(
			...baseline,
			{
				kind: 'quota_exhausted',
				seat: 'pm',
				model: { tool: 'claude-code' },
				resetsAt: 50_000_000,
				detail: 'Internal quota detail',
			},
			{
				kind: 'follow_up_registered',
				followUpId: 'quota-wait',
				seat: 'pm',
				waitFor:
					'Quota reset or a new account status sample; unchanged observations are normal waiting',
				reason: 'Internal quota detail',
				untilMs: 20_000_000,
			}
		);
		const wait = events.at(-1)!;
		if (wait.kind === 'follow_up_registered')
			wait.unavailabilityId = events.find((event) => event.kind === 'quota_exhausted')!.id;
		const state = reduceLedger(events);
		const view = render(<TeamAppStatus state={state} />);
		const labels = language === 'en' ? en : zh;
		expect(view.container).toHaveTextContent(
			labels['workflows.team.waitLimit'].replace('{provider}', 'Claude')
		);
		expect(view.container).toHaveTextContent(new Date(50_000_000).toLocaleString(language));
		expect(view.container.querySelector('[data-next-check]')).toHaveAttribute(
			'data-next-check',
			'20000000'
		);
		expect(view.container).not.toHaveTextContent(
			/status sample|Internal quota|unchanged observations/
		);
	});
	it('labels workspaces and keeps sidebar coverage on one line with the model in a tooltip', () => {
		const events = ledger(
			...baseline,
			...(['pm', 'dev', 'qa'] as const).map((seat) => ({
				kind: 'seat_bound' as const,
				seat,
				workspace: seat === 'qa' ? '/project/qa' : '/project/dev',
				model: config.seats[seat],
			})),
			{
				kind: 'substitute_took_over',
				seat: 'pm',
				model: { tool: 'codex', model: 'covering-model' },
				temporary: true,
			}
		);
		const state = reduceLedger(events);
		useTeamStore.getState().mirror({ config, events });
		const view = render(
			<LayerStackProvider>
				<TeamPanel state={state} theme={mockTheme} tab="members" onTab={() => {}} />
				<TeamSidebar theme={mockTheme} teams={[config]} />
			</LayerStackProvider>
		);
		const labels = language === 'en' ? en : zh;
		for (const seat of ['pm', 'dev', 'qa'])
			expect(view.container.querySelector(`[data-workspace="${seat}"]`)).toHaveTextContent(
				labels[seat === 'qa' ? 'workflows.team.qaWorktree' : 'workflows.team.devWorktree']
			);
		expect(screen.queryByText(/^dev$|^qa$/)).toBeNull();
		const row = view.container.querySelector('[data-team-seat="pm"]')!;
		expect(row.querySelector('[data-compact]')).toHaveClass('whitespace-nowrap');
		expect(row.querySelector('[title]')).toHaveAttribute(
			'title',
			expect.stringContaining('covering-model')
		);
		expect(row).not.toHaveTextContent('covering-model');
	});
	it.each(['turns', 'deadline', 'pause'] as const)(
		'distinguishes %s from an owner pause',
		(mode) => {
			const teamConfig = {
				...config,
				turnBudget: mode === 'turns' ? 1 : 40,
				deadline: mode === 'deadline' ? 1500 : undefined,
			};
			const events = ledger(
				{ kind: 'team_created', config: teamConfig },
				...baseline.slice(1),
				{
					kind: 'turn_dispatched',
					seat: 'dev',
					dispatchId: 'used',
					turn: 'work',
					promptDigest: '',
				},
				{ kind: 'turn_finished', seat: 'dev', dispatchId: 'used', exitCode: 0, durationMs: 1 },
				{ kind: 'paused', actor: 'owner' }
			);
			useTeamStore.setState({ now: 2000 });
			useTeamStore.getState().mirror({ config: teamConfig, events });
			useTeamStore.getState().selectTeam(config.id);
			const view = render(
				<LayerStackProvider>
					<TeamView theme={mockTheme} />
				</LayerStackProvider>
			);
			const labels = language === 'en' ? en : zh;
			const paused = mode === 'pause';
			expect(screen.getByTestId('team-header')).toHaveAttribute(
				'data-control-state',
				paused ? 'paused' : 'budget'
			);
			expect(view.container.querySelector('[data-status-cell="now"]')).toHaveTextContent(
				labels[paused ? 'workflows.team.paused' : 'workflows.team.budgetBlocked']
			);
			if (paused)
				expect(
					screen.getByRole('button', { name: labels['workflows.team.resume'], exact: true })
				).toBeEnabled();
			else
				expect(
					screen.queryByRole('button', { name: labels['workflows.team.resume'], exact: true })
				).toBeNull();
			expect(
				screen.getByRole('textbox', { name: labels['workflows.team.message'], exact: true })
			).toBeEnabled();
		}
	);
});
