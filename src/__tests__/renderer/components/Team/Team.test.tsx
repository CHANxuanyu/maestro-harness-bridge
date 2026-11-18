import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerStackProvider } from '../../../../renderer/contexts/LayerStackContext';
import { useTeamStore } from '../../../../renderer/stores/teamStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { TeamFeed } from '../../../../renderer/components/Team/TeamFeed';
import { deriveTeamFeed } from '../../../../renderer/components/Team/deriveTeamFeed';
import { OwnerCard } from '../../../../renderer/components/Team/OwnerCard';
import { CreateTeamModal } from '../../../../renderer/components/Team/CreateTeamModal';
import { TeamView } from '../../../../renderer/components/Team/TeamView';
import { TeamSidebar } from '../../../../renderer/components/Team/TeamSidebar';
import { TeamComposer } from '../../../../renderer/components/Team/TeamComposer';
import { reduceLedger } from '../../../../shared/team/ledger';
import type { TeamClient } from '../../../../renderer/services/teamClient';
import { defaultPath, teamConfig, decision, baselineCard, exportBrief } from './defaultPath';
import { ledger } from '../../../shared/team/fixtures';
import { mockTheme } from '../../../helpers/mockTheme';
import { resetStore, resetAllStores, createMockSession, createMockAITab } from '../../../helpers';
import type { ProviderModelCatalog } from '../../../../shared/modelCatalog';
import { openUiSurface } from '../../../../renderer/utils/openUiSurface';
import { TeamPanel } from '../../../../renderer/components/Team/TeamPanel';
import { TeamOutput } from '../../../../renderer/components/Team/TeamOutput';
import { TeamModelCatalogProvider } from '../../../../renderer/components/Team/TeamModelCatalogs';
import { SeatTag } from '../../../../renderer/components/Team/TeamPrimitives';
import { team as zh } from '../../../../renderer/i18n/locales/zh-CN/team';
import { team as en } from '../../../../renderer/i18n/locales/en/team';

const bridge = vi.hoisted(() => ({ client: undefined as TeamClient | undefined }));
vi.mock('../../../../renderer/services/teamClient', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../../renderer/services/teamClient')>()),
	teamClient: () => bridge.client,
}));

const catalog: ProviderModelCatalog = {
	provider: 'codex',
	models: [
		{
			id: 'codex',
			displayName: 'Codex model',
			description: 'Test model',
			group: 'current',
			hidden: false,
			defaultEffort: 'medium',
			efforts: [
				{ id: 'medium', description: 'Normal' },
				{ id: 'high', description: 'More' },
				{ id: 'ultra', description: 'Parallel work' },
			],
		},
	],
	effortLabel: 'Reasoning',
	followDefault: { modelId: 'codex', source: 'config' },
	source: { kind: 'codex-cache', files: [] },
	stale: false,
};
const mount = (node: React.ReactNode) => render(<LayerStackProvider>{node}</LayerStackProvider>);

beforeEach(() => {
	localStorage.removeItem('maestro.team.panelWidth');
	resetAllStores();
	resetStore(useTeamStore);
	vi.clearAllMocks();
	useSettingsStore.setState({ uiLanguage: 'en', newShell: true });
	useSessionStore.setState({
		activeSessionId: 'project',
		sessions: [
			createMockSession({
				id: 'project',
				cwd: '/project',
				projectRoot: '/project',
				aiTabs: [createMockAITab()],
			}),
		],
	});
	useTeamStore.setState({ available: true });
	bridge.client = {
		answer: vi.fn().mockResolvedValue(undefined),
		say: vi.fn().mockResolvedValue(undefined),
		seatTranscript: vi
			.fn()
			.mockResolvedValue({ provider: 'codex', nativeSessionId: 'native-dev', cwd: '/project/dev' }),
		create: vi.fn().mockResolvedValue(teamConfig),
		get: vi.fn().mockResolvedValue({ config: teamConfig, events: defaultPath }),
		pause: vi.fn().mockResolvedValue(undefined),
		accept: vi.fn().mockResolvedValue(undefined),
		export: vi.fn().mockResolvedValue('{}'),
	} as unknown as TeamClient;
	window.maestro.agents.getModelCatalog = vi.fn(async ({ provider }) => ({ ...catalog, provider }));
});

describe('prototype default path', () => {
	it('derives all seven chronological phase groups and renders every default card', () => {
		const groups = deriveTeamFeed(defaultPath);
		expect(groups.map((g) => g.phase)).toEqual([
			'clarify',
			'challenge',
			'implement',
			'verify',
			'review',
			'demo',
			'accept',
		]);
		const state = reduceLedger(defaultPath);
		const { container } = mount(
			<TeamFeed theme={mockTheme} state={state} events={defaultPath} onChanges={vi.fn()} />
		);
		for (const kind of [
			'team',
			'message',
			'brief',
			'challenge',
			'discussion',
			'owner',
			'baseline',
			'check',
			'issue',
			'quota',
			'review',
			'demo',
			'summary',
			'owner-message',
			'follow-up',
		])
			expect(container.querySelector(`[data-card="${kind}"]`), kind).not.toBeNull();
		expect(container.querySelectorAll('[data-card="review"]')).toHaveLength(2);
		expect(container.querySelectorAll('[data-card="check"]')).toHaveLength(2);
		expect(container.querySelectorAll('details[open]')).toHaveLength(0);
		expect(container.querySelector('[data-emphasis="true"]')).toBeNull();
		expect(container.querySelector('[data-card="demo"]')?.closest('details')).toBeNull();
	});
	it('keeps open owner cards visible outside completed-phase folds and answers the exact option', async () => {
		const end = defaultPath.findIndex((e) => e.kind === 'card_answered');
		const state = reduceLedger(defaultPath.slice(0, end));
		mount(
			<TeamFeed
				theme={mockTheme}
				state={state}
				events={defaultPath.slice(0, end)}
				onChanges={vi.fn()}
			/>
		);
		const card = screen.getByRole('region', { name: decision.title });
		expect(card.closest('details')).toBeNull();
		expect(card).toHaveAttribute('data-boundary', 'commitment');
		fireEvent.click(within(card).getAllByRole('button')[0]);
		await waitFor(() =>
			expect(bridge.client!.answer).toHaveBeenCalledWith(teamConfig.id, 'D2', 'folder', undefined)
		);
		expect(within(card).getAllByRole('button')).not.toHaveLength(0);
	});
});

describe('owner decisions', () => {
	it('accepts from the demo when the real backend opens its acceptance card', async () => {
		const events = [
			...defaultPath.filter((event) => event.kind !== 'terminal' && event.kind !== 'accepted'),
			...ledger({
				kind: 'decision_card',
				card: {
					id: 'acceptance',
					boundary: 'acceptance',
					title: 'Accept the demonstrated result',
					body: 'All criteria passed.',
					options: [
						{ id: 'accept', label: 'Accept the result', recommended: true },
						{ id: 'changes', label: 'Request specific changes' },
					],
				},
			}).map((event) => ({
				...event,
				id: `acceptance-${event.id}`,
				seq: defaultPath.length + event.seq,
			})),
		];
		mount(
			<TeamFeed
				state={reduceLedger(events)}
				events={events}
				theme={mockTheme}
				onChanges={vi.fn()}
			/>
		);
		const demo = document.querySelector('[data-card="demo"]') as HTMLElement;
		const accept = within(demo).getByRole('button', { name: 'Accept', exact: true });
		expect(accept).toBeEnabled();
		expect(document.querySelectorAll('[data-boundary="acceptance"]')).toHaveLength(1);
		fireEvent.click(accept);
		await waitFor(() => expect(bridge.client!.accept).toHaveBeenCalledWith(teamConfig.id));
	});
	it('orders recommended options first and rejects bare continue labels', () => {
		const state = reduceLedger(defaultPath);
		mount(
			<OwnerCard
				teamId={teamConfig.id}
				state={state}
				card={{
					...decision,
					options: [
						...decision.options,
						{ id: 'bad', label: 'Continue' },
						{ id: 'bad-zh', label: '继续' },
					],
				}}
			/>
		);
		expect(screen.getAllByRole('button')[0]).toHaveTextContent('文件夹');
		expect(screen.queryByRole('button', { name: /^Continue/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^继续/ })).toBeNull();
		expect(
			screen.getByText('An option lacks a concrete action. Wait for the team to update it.')
		).toBeVisible();
	});
	it('shows confirmation, editing, diff and return on the live baseline', () => {
		const state = reduceLedger(
			defaultPath.slice(
				0,
				defaultPath.findIndex((event) => event.kind === 'card_answered' && event.cardId === 'BASE')
			)
		);
		mount(<OwnerCard teamId={teamConfig.id} state={state} card={baselineCard} />);
		expect(screen.getAllByRole('button')).toHaveLength(state.brief!.criteria.length + 3);
		expect(screen.getByRole('button', { name: 'Confirm baseline', exact: true })).toHaveAttribute(
			'data-option',
			'confirm'
		);
		expect(screen.getByRole('region')).toHaveAttribute('data-boundary', 'baseline');
	});
});

describe('team setup', () => {
	it('pins an allowed Codex effort before creation when the native model defaults to Ultra', async () => {
		window.maestro.agents.getModelCatalog = vi.fn(async ({ provider }) => ({
			...catalog,
			provider,
			models: catalog.models.map((model) => ({ ...model, defaultEffort: 'ultra' })),
		}));
		mount(<CreateTeamModal theme={mockTheme} open onClose={vi.fn()} />);
		await waitFor(() =>
			expect(
				within(screen.getByRole('group', { name: 'Developer' })).getByTestId('model-effort-picker')
			).toHaveTextContent('Medium')
		);
		fireEvent.change(screen.getByRole('textbox', { name: 'Your idea' }), {
			target: { value: 'Allowed team effort' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));
		await waitFor(() =>
			expect(bridge.client!.create).toHaveBeenCalledWith(
				expect.objectContaining({
					seats: expect.objectContaining({ dev: { tool: 'codex', effort: 'medium' } }),
				})
			)
		);
	});
	it('defaults to four authorizations, 40 turns, no substitutes and excludes Codex Ultra', async () => {
		const close = vi.fn();
		mount(<CreateTeamModal theme={mockTheme} open onClose={close} />);
		expect(
			screen.getAllByRole('checkbox').filter((input) => (input as HTMLInputElement).checked)
		).toHaveLength(4);
		expect(screen.getByRole('spinbutton', { name: 'Turn budget' })).toHaveValue(40);
		await waitFor(() => expect(screen.getAllByTestId('model-effort-picker')).toHaveLength(3));
		const developer = screen.getByRole('group', { name: 'Developer' });
		fireEvent.click(within(developer).getByTestId('model-effort-picker'));
		expect(screen.queryByRole('option', { name: /^Ultra/ })).toBeNull();
		fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
		fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
		fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
		fireEvent.click(within(developer).getByTestId('model-effort-picker'));
		fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		expect(close).not.toHaveBeenCalled();
		fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		await waitFor(() => expect(close).toHaveBeenCalledOnce());
	});
	it('focuses the idea, traps Tab, and creates the configured team', async () => {
		mount(<CreateTeamModal theme={mockTheme} open onClose={vi.fn()} />);
		const idea = screen.getByRole('textbox', { name: 'Your idea' });
		await waitFor(() => expect(idea).toHaveFocus());
		fireEvent.change(idea, { target: { value: 'Build Markdown export' } });
		fireEvent.change(screen.getByRole('combobox', { name: 'Deadline' }), {
			target: { value: 'none' },
		});
		const start = screen.getByRole('button', { name: 'Create and start' });
		start.focus();
		fireEvent.keyDown(start, { key: 'Tab' });
		expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
		fireEvent.click(start);
		await waitFor(() =>
			expect(bridge.client!.create).toHaveBeenCalledWith(
				expect.objectContaining({
					idea: 'Build Markdown export',
					deadline: undefined,
					turnBudget: 40,
					authorizations: { checks: true, push: true, draftPr: true, temporaryTakeover: true },
				})
			)
		);
		expect(useTeamStore.getState().activeTeamId).toBe(teamConfig.id);
	});
	it('routes the creation surface only in the new shell', () => {
		expect(openUiSurface('create-team').ok).toBe(true);
		expect(useTeamStore.getState().setupOpen).toBe(true);
		openUiSurface('create-team', undefined, { close: true });
		useSettingsStore.setState({ newShell: false });
		expect(openUiSurface('create-team').ok).toBe(false);
		expect(useTeamStore.getState().setupOpen).toBe(false);
	});
	it('preserves the remote project scope and blocks an unresolved SSH host', async () => {
		const owner = useSessionStore.getState().sessions[0];
		useSessionStore.setState({
			sessions: [
				{
					...owner,
					sessionSshRemoteConfig: {
						enabled: true,
						remoteId: 'ssh-team',
						workingDirOverride: '/remote/project',
					},
				},
			],
		});
		const view = mount(<CreateTeamModal theme={mockTheme} open onClose={vi.fn()} />);
		fireEvent.change(screen.getByRole('textbox', { name: 'Your idea' }), {
			target: { value: 'Remote team' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));
		await waitFor(() =>
			expect(bridge.client!.create).toHaveBeenCalledWith(
				expect.objectContaining({
					projectRoot: '/remote/project',
					sshRemoteId: 'ssh-team',
				})
			)
		);
		view.unmount();
		useSessionStore.setState({
			sessions: [{ ...owner, sessionSshRemoteConfig: { enabled: true, remoteId: null } }],
		});
		mount(<CreateTeamModal theme={mockTheme} open onClose={vi.fn()} />);
		fireEvent.change(screen.getByRole('textbox', { name: 'Your idea' }), {
			target: { value: 'Cannot create locally' },
		});
		expect(screen.getByRole('button', { name: 'Create and start' })).toBeDisabled();
	});
});

describe('member navigation and composer', () => {
	it('keeps the stopped label visible even with an unanswered card in the ledger', () => {
		const pending = defaultPath.slice(
			0,
			defaultPath.findIndex((event) => event.kind === 'card_answered' && event.cardId === 'BASE')
		);
		useTeamStore.getState().mirror({
			config: teamConfig,
			events: ledger(...pending, { kind: 'stopped', actor: 'owner' }),
		});
		mount(<TeamSidebar theme={mockTheme} teams={[teamConfig]} />);
		const row = screen.getByRole('button', { name: teamConfig.title, exact: true });
		expect(within(row).getByRole('img')).toHaveAttribute('title', en['workflows.team.stopped']);
		expect(row).toBeVisible();
		expect(within(row).queryByLabelText(/Needs you/)).toBeNull();
		fireEvent.click(row);
		expect(useTeamStore.getState().activeTeamId).toBe(teamConfig.id);
	});
	it('opens a read-only native transcript and Esc returns focus to its seat row', async () => {
		vi.mocked(bridge.client!.seatTranscript).mockResolvedValue({
			provider: 'codex',
			nativeSessionId: 'native-dev',
			cwd: '/project/dev',
			configDir: '/isolated/account',
		});
		useTeamStore.getState().mirror({ config: teamConfig, events: defaultPath });
		useTeamStore.getState().selectTeam(teamConfig.id);
		window.maestro.agentSessions.read = vi.fn().mockResolvedValue({
			messages: [
				{
					type: 'assistant',
					content: 'Native member reply\n\n```team-report\n{"internalReceipt":"hidden"}\n```',
					uuid: 'm1',
					timestamp: new Date().toISOString(),
				},
			],
			hasMore: false,
			total: 1,
		});
		mount(
			<>
				<TeamSidebar theme={mockTheme} teams={[teamConfig]} />
				<TeamView theme={mockTheme} />
			</>
		);
		const row = screen.getByRole('button', { name: `Developer ${teamConfig.title}` });
		row.focus();
		fireEvent.click(row);
		await screen.findByText('Native member reply');
		expect(screen.queryByText(/internalReceipt/)).not.toBeInTheDocument();
		expect(window.maestro.agentSessions.read).toHaveBeenCalledWith(
			'codex',
			'/project/dev',
			'native-dev',
			{ offset: 0, limit: 50, readOnly: true, configDir: '/isolated/account' },
			undefined
		);
		expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
		fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		await waitFor(() => expect(useTeamStore.getState().activeSeat).toBeNull());
		await waitFor(() => expect(row).toHaveFocus());
	});
	it('defaults to PM and supports keyboard mentions without losing a failed draft', async () => {
		const state = reduceLedger(defaultPath.slice(0, 30));
		mount(<TeamComposer state={state} />);
		const input = screen.getByRole('textbox', { name: 'Message' });
		fireEvent.change(input, { target: { value: 'Keep the scope small' } });
		fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() =>
			expect(bridge.client!.say).toHaveBeenCalledWith(teamConfig.id, 'Keep the scope small', 'pm')
		);
		await waitFor(() => expect(input).toHaveValue(''));
		fireEvent.change(input, { target: { value: '@' } });
		fireEvent.keyDown(input, { key: 'ArrowDown' });
		fireEvent.keyDown(input, { key: 'Enter' });
		expect(input).toHaveValue('@Developer ');
		vi.mocked(bridge.client!.say).mockRejectedValueOnce(new Error('Offline'));
		fireEvent.change(input, { target: { value: '@Developer Keep filenames short' } });
		fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => expect(useTeamStore.getState().error).toBe('Offline'));
		expect(input).toHaveValue('@Developer Keep filenames short');
	});
});

describe('real backend presentation', () => {
	it.each(['en', 'zh-CN'] as const)(
		'renders human baseline copy and one escalation label in %s',
		(locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			const labels = locale === 'zh-CN' ? zh : en;
			const events = ledger(
				{ kind: 'team_created', config: teamConfig },
				{ kind: 'brief_published', actor: 'pm', brief: exportBrief },
				{ kind: 'baseline_proposed', briefVersion: 1 },
				{
					kind: 'check_run',
					command: 'npm test',
					cwd: '/synthetic/task/dev',
					batchId: 'trial:1',
					purpose: 'trial',
					exitCode: 1,
					outputTail: '',
					durationMs: 1,
					covers: ['A2'],
					evidenceId: 'private-evidence-id',
				}
			);
			const state = reduceLedger(events);
			const payload = {
				type: 'baseline' as const,
				brief: exportBrief,
				question: null,
				trials: state.checks,
			};
			const { rerender } = mount(
				<OwnerCard
					card={{ ...baselineCard, body: JSON.stringify(payload) }}
					teamId={teamConfig.id}
					state={state}
				/>
			);
			const assertBaseline = () => {
				const card = screen.getByRole('region');
				expect(card).toHaveAttribute('data-boundary', 'baseline');
				expect(card).toHaveTextContent(labels['workflows.team.baselineDryRun']);
				expect(card).toHaveTextContent(exportBrief.criteria[0].text);
				expect(card).toHaveTextContent(exportBrief.notDoing[0]);
				expect(card).not.toHaveTextContent(
					/"brief"|"trials"|private-evidence-id|\/synthetic\/task/
				);
				expect(card).not.toHaveTextContent(/Boundary:|边界：/);
				expect(
					within(card).getByRole('button', {
						name: labels['workflows.team.confirmBaseline'],
						exact: true,
					})
				).toBeEnabled();
			};
			assertBaseline();
			rerender(
				<OwnerCard
					card={{ ...baselineCard, body: 'Transport-independent human copy', payload }}
					teamId={teamConfig.id}
					state={state}
				/>
			);
			assertBaseline();
			rerender(<OwnerCard card={decision} teamId={teamConfig.id} state={state} />);
			expect(screen.getAllByText(/Boundary:|边界：/)).toHaveLength(1);
			for (const button of screen.getAllByRole('button')) {
				expect(button).not.toHaveTextContent(/Boundary:|边界：/);
				expect(button).toHaveAttribute('data-boundary', 'commitment');
			}
		}
	);

	it.each(['all', 'gaps', 'stopped'] as const)(
		'shows one visible summary for the actual %s path without a terminal event',
		(terminal) => {
			useSettingsStore.setState({ uiLanguage: 'zh-CN' });
			const path = defaultPath.slice(
				0,
				defaultPath.findIndex((event) => event.kind === 'accepted')
			);
			const events = ledger(
				...path,
				terminal === 'stopped'
					? { kind: 'stopped', actor: 'owner' }
					: {
							kind: 'accepted',
							actor: 'owner',
							...(terminal === 'gaps' ? { withGaps: ['A3'] } : {}),
						}
			);
			const state = reduceLedger(events);
			const { container, rerender } = mount(
				<TeamFeed theme={mockTheme} events={events} state={state} onChanges={vi.fn()} />
			);
			const summary = container.querySelector('[data-card="summary"]') as HTMLElement;
			expect(summary).toBeVisible();
			expect(summary.closest('details')).toBeNull();
			expect(summary).toHaveTextContent('这次协作');
			expect(summary).toHaveTextContent('按刚才实际走过的路径统计');
			expect(summary).toHaveTextContent('3 次决定，1 次主动说话');
			expect(summary).toHaveTextContent('1 次短讨论，1 个决定');
			expect(summary).toHaveTextContent('产品评审打回 1 次，复盘 0 次');
			expect(summary).toHaveTextContent('恢复 0 次，替补接手 1 次');
			expect(summary).toHaveTextContent('已用 1/40 回合');
			expect(summary).toHaveTextContent(
				terminal === 'all'
					? '已验收：全部达标'
					: terminal === 'gaps'
						? '已验收，接受了 1 项遗留'
						: '已停止：未完成'
			);
			const withTerminal = ledger(...events, {
				kind: 'terminal',
				terminal,
				residual: state.residual,
			});
			rerender(
				<TeamFeed
					theme={mockTheme}
					events={withTerminal}
					state={reduceLedger(withTerminal)}
					onChanges={vi.fn()}
				/>
			);
			expect(container.querySelectorAll('[data-card="summary"]')).toHaveLength(1);
		}
	);

	it('omits scheduler bookkeeping while preserving real member follow-ups', () => {
		const events = ledger(
			...defaultPath,
			{
				kind: 'follow_up_registered',
				followUpId: 'job:1',
				seat: 'pm',
				reason: 'Application work in progress',
				waitFor: 'prepare',
			},
			{ kind: 'follow_up_fired', followUpId: 'job:1', result: 'Application work settled' }
		);
		const groups = deriveTeamFeed(events);
		expect(
			groups
				.flatMap((group) => group.events)
				.some((event) => 'followUpId' in event && event.followUpId === 'job:1')
		).toBe(false);
		const { container } = mount(
			<TeamFeed
				theme={mockTheme}
				events={events}
				state={reduceLedger(events)}
				onChanges={vi.fn()}
			/>
		);
		expect(container).not.toHaveTextContent('Application work settled');
		expect(container.querySelector('[data-team-event]')).toHaveTextContent(teamConfig.idea);
		expect(container.querySelector('[data-card="follow-up"]')).not.toBeNull();
	});

	it('uses catalog model and vendor level names in Chinese, including hidden models and unknown fallbacks', async () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		const config = {
			...teamConfig,
			seats: {
				...teamConfig.seats,
				dev: {
					tool: 'codex' as const,
					model: 'gpt-test-id',
					effort: 'xhigh',
					customEnv: { CODEX_HOME: '/synthetic/dev-account' },
				},
			},
		};
		window.maestro.agents.getModelCatalog = vi.fn(async ({ provider }) => ({
			...catalog,
			provider,
			models: [
				{
					...catalog.models[0],
					id: 'gpt-test-id',
					displayName: 'GPT Test Display',
					hidden: true,
					efforts: [{ id: 'xhigh', displayName: 'Vendor Maximum', description: '' }],
				},
			],
		}));
		const { rerender } = mount(
			<TeamModelCatalogProvider config={config}>
				<SeatTag seat="dev" model={config.seats.dev} />
			</TeamModelCatalogProvider>
		);
		await screen.findByText('GPT Test Display · Vendor Maximum');
		expect(window.maestro.agents.getModelCatalog).toHaveBeenCalledWith({
			provider: 'codex',
			account: { customEnvVars: config.seats.dev.customEnv },
			sshRemoteId: undefined,
		});
		expect(screen.queryByText(/gpt-test-id/)).toBeNull();
		rerender(
			<TeamModelCatalogProvider config={config}>
				<SeatTag
					seat="dev"
					model={{ ...config.seats.dev, model: 'unknown-model', effort: 'unknown-level' }}
				/>
			</TeamModelCatalogProvider>
		);
		expect(screen.getByText('unknown-model · unknown-level')).toBeVisible();
	});

	it('keeps the main surface open on Esc and labels the demo action in Chinese', async () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		useTeamStore.getState().mirror({ config: teamConfig, events: defaultPath });
		useTeamStore.getState().selectTeam(teamConfig.id);
		mount(<TeamView theme={mockTheme} />);
		await screen.findByText('看改动');
		expect(screen.queryByText('ESC')).toBeNull();
		expect(screen.getByText('成员与规则')).toBeVisible();
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(useTeamStore.getState().activeTeamId).toBe(teamConfig.id);
		expect(screen.getByRole('complementary', { name: '侧面板' })).toBeVisible();
		fireEvent.click(screen.getByText('看改动'));
		expect(screen.getByRole('tab', { name: '改动' })).toHaveAttribute('aria-selected', 'true');
	});

	it.each(['/project/dev/result.txt', 'C:\\task\\dev\\result.txt'])(
		'displays a relative artifact name while reading the actual path %s',
		async (file) => {
			useSettingsStore.setState({ uiLanguage: 'zh-CN' });
			const cwd = file.startsWith('C:') ? 'C:\\task\\dev' : '/project/dev';
			const state = reduceLedger(
				ledger(
					{ kind: 'team_created', config: teamConfig },
					{ kind: 'seat_bound', seat: 'dev', workspace: cwd, model: teamConfig.seats.dev },
					{ kind: 'output_captured', outputId: 'output', files: [file], previews: [] }
				)
			);
			window.maestro.fs.readFile = vi.fn().mockResolvedValue('actual result');
			mount(<TeamOutput state={state} theme={mockTheme} />);
			fireEvent.click(screen.getByText('产出'));
			const button = screen.getByRole('button', { name: '打开 result.txt' });
			fireEvent.click(button);
			await screen.findByText('actual result');
			expect(window.maestro.fs.readFile).toHaveBeenCalledWith(file, undefined);
			expect(screen.getByTestId('team-output')).not.toHaveTextContent(cwd);
		}
	);
});

describe('third screenshot review', () => {
	it.each(['all', 'gaps', 'stopped'] as const)(
		'disables messaging after %s, exposes one export action and preserves the sidebar title',
		async (terminal) => {
			const running = defaultPath.slice(
				0,
				defaultPath.findIndex((event) => event.kind === 'accepted')
			);
			useTeamStore.getState().mirror({ config: teamConfig, events: running });
			useTeamStore.getState().selectTeam(teamConfig.id);
			const { container } = mount(
				<>
					<TeamSidebar theme={mockTheme} teams={[teamConfig]} />
					<TeamView theme={mockTheme} />
				</>
			);
			const input = screen.getByRole('textbox', { name: en['workflows.team.message'] });
			fireEvent.change(input, { target: { value: '@' } });
			expect(screen.getByRole('listbox')).toBeVisible();
			act(() =>
				useTeamStore.getState().mirror({
					config: teamConfig,
					events: ledger(
						...running,
						terminal === 'stopped'
							? { kind: 'stopped', actor: 'owner' }
							: {
									kind: 'accepted',
									actor: 'owner',
									...(terminal === 'gaps' ? { withGaps: ['A3'] } : {}),
								}
					),
				})
			);
			const composer = screen.getByTestId('team-composer');
			const finishedInput = within(composer).getByRole('textbox');
			expect(finishedInput).toBeDisabled();
			expect(finishedInput).toHaveAttribute('placeholder', en['workflows.team.finishedMessages']);
			expect(screen.queryByRole('listbox')).toBeNull();
			expect(
				within(composer).queryByRole('button', { name: en['workflows.team.send'] })
			).toBeNull();
			fireEvent.keyDown(finishedInput, { key: 'Enter' });
			expect(bridge.client!.say).not.toHaveBeenCalled();
			const exports = screen.getAllByRole('button', {
				name: en['workflows.team.export'],
				exact: true,
			});
			expect(exports).toHaveLength(1);
			expect(composer).toContainElement(exports[0]);
			fireEvent.click(exports[0]);
			await waitFor(() => expect(bridge.client!.export).toHaveBeenCalledWith(teamConfig.id));
			const row = container.querySelector(`[data-team-id="${teamConfig.id}"]`)!;
			const title = row.querySelector('[data-team-title]')!;
			const status = within(row as HTMLElement).getByRole('img');
			expect(title).toHaveTextContent(teamConfig.title);
			expect(title).toHaveClass('flex-1', 'min-w-0');
			expect(row.textContent).toBe(teamConfig.title);
			expect(status).toHaveAttribute('data-team-status', terminal);
			expect(status).toHaveClass('shrink-0', 'w-2');
			expect(status).toHaveAttribute('title', status.getAttribute('aria-label'));
			expect(row).toHaveAttribute('title', `${teamConfig.title}\n${status.getAttribute('title')}`);
		}
	);

	it('still allows a paused team to queue a message to PM', async () => {
		const state = reduceLedger(
			ledger({ kind: 'team_created', config: teamConfig }, { kind: 'paused', actor: 'owner' })
		);
		mount(<TeamComposer state={state} />);
		const input = screen.getByRole('textbox');
		expect(input).toBeEnabled();
		fireEvent.change(input, { target: { value: 'Queue this while paused' } });
		const send = screen.getByRole('button', { name: en['workflows.team.send'] });
		expect(send).toBeEnabled();
		fireEvent.click(send);
		await waitFor(() =>
			expect(bridge.client!.say).toHaveBeenCalledWith(
				teamConfig.id,
				'Queue this while paused',
				'pm'
			)
		);
	});

	it.each(['en', 'zh-CN'] as const)(
		'bounds status values and exposes the full work list in %s',
		(locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			const items = [
				'qa/views.txt',
				'result.html',
				'other.html',
				'Apply decision as dev',
				'Apply decision as pm',
				'Apply decision as qa',
			];
			const events = ledger(
				{ kind: 'team_created', config: teamConfig },
				...items.map((title, index) => ({
					kind: 'work_item' as const,
					itemId: `item-${index}`,
					title,
					owner: 'dev' as const,
					state: 'claimed' as const,
				}))
			);
			useTeamStore.getState().mirror({ config: teamConfig, events });
			useTeamStore.getState().selectTeam(teamConfig.id);
			const { container } = mount(<TeamView theme={mockTheme} />);
			const solving = container.querySelector('[data-status-cell="solving"]')!;
			expect(solving).toHaveTextContent(
				new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
					items.slice(0, 2)
				)
			);
			expect(solving).not.toHaveTextContent(items[2]);
			expect(solving.querySelector('[data-status-more]')).toHaveAttribute('data-status-more', '4');
			expect(solving.querySelector('[data-status-more]')).toHaveClass(
				'shrink-0',
				'whitespace-nowrap'
			);
			expect(solving.querySelector('[data-status-value]')).toHaveAttribute(
				'title',
				new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)
			);
			const values = container.querySelectorAll('[data-status-value]');
			expect(values).toHaveLength(4);
			for (const value of values) {
				expect(value).toHaveAttribute('title');
				expect(
					value.classList.contains('truncate') || value.querySelector('.truncate')
				).toBeTruthy();
			}
		}
	);

	it.each(['en', 'zh-CN'] as const)(
		'formats lists with %s in status, baseline and brief cards',
		(locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			const items = ['qa/sample.txt', 'result.txt'];
			const events = ledger(
				...defaultPath.filter((event) => event.kind !== 'accepted' && event.kind !== 'terminal'),
				{ kind: 'accepted', actor: 'owner', withGaps: items }
			);
			useTeamStore.getState().mirror({ config: teamConfig, events });
			useTeamStore.getState().selectTeam(teamConfig.id);
			const expected = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
				items
			);
			const { container, unmount } = mount(<TeamView theme={mockTheme} />);
			expect(container.querySelector('[data-status-cell="solving"]')).toHaveTextContent(expected);
			expect(screen.getByRole('textbox')).toHaveAttribute(
				'placeholder',
				(locale === 'en' ? en : zh)['workflows.team.finishedMessages']
			);
			unmount();
			const briefEvents = ledger(
				{ kind: 'team_created', config: teamConfig },
				{ kind: 'brief_published', actor: 'pm', brief: { ...exportBrief, notDoing: items } }
			);
			const state = reduceLedger(briefEvents);
			const view = mount(
				<>
					<OwnerCard card={baselineCard} teamId={teamConfig.id} state={state} />
					<TeamFeed theme={mockTheme} state={state} events={briefEvents} onChanges={vi.fn()} />
				</>
			);
			expect(view.container.querySelector('[data-card="baseline"]')).toHaveTextContent(expected);
			expect(view.container.querySelector('[data-card="brief"]')).toHaveTextContent(expected);
		}
	);

	it.each(['en', 'zh-CN'] as const)(
		'shows panel output immediately and retains demo disclosure in %s',
		(locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			const state = reduceLedger(defaultPath);
			const { container } = mount(
				<>
					<TeamPanel theme={mockTheme} state={state} tab="output" onTab={vi.fn()} />
					<TeamFeed theme={mockTheme} state={state} events={defaultPath} onChanges={vi.fn()} />
				</>
			);
			const panel = screen.getByRole('complementary');
			const tabs = within(panel).getAllByRole('tab');
			expect(tabs).toHaveLength(6);
			expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
			expect(tabs[0]).toHaveAttribute('aria-controls', within(panel).getByRole('tabpanel').id);
			expect(tabs[2].querySelector('[data-tab-count]')).toHaveTextContent(
				String(
					state.decisions.filter((entry) => entry.decider !== 'owner').length +
						state.statistics.ownerDecisions
				)
			);
			const panelOutput = within(panel).getByTestId('team-output');
			expect(panelOutput.querySelector('details')).toBeNull();
			expect(within(panelOutput).getAllByRole('button').length).toBeGreaterThan(0);
			expect(
				container.querySelector('[data-card="demo"] [data-testid="team-output"] > details')
			).not.toHaveAttribute('open');
		}
	);

	it('defaults to the standard right panel width and remembers keyboard resizing', () => {
		const state = reduceLedger(defaultPath);
		const defaultWidth = useSettingsStore.getInitialState().rightPanelWidth;
		const view = mount(<TeamPanel theme={mockTheme} state={state} tab="output" onTab={vi.fn()} />);
		const handle = screen.getByRole('separator');
		expect(handle).toHaveAttribute('aria-valuenow', String(defaultWidth));
		expect(screen.getByRole('complementary')).toHaveStyle({ width: `${defaultWidth}px` });
		fireEvent.keyDown(handle, { key: 'ArrowRight' });
		expect(handle).toHaveAttribute('aria-valuenow', String(defaultWidth - 16));
		view.unmount();
		mount(<TeamPanel theme={mockTheme} state={state} tab="output" onTab={vi.fn()} />);
		expect(screen.getByRole('separator')).toHaveAttribute(
			'aria-valuenow',
			String(defaultWidth - 16)
		);
		fireEvent.doubleClick(screen.getByRole('separator'));
		expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', String(defaultWidth));
	});
});

describe('fourth screenshot review', () => {
	it.each(['en', 'zh-CN'] as const)(
		'keeps header actions together and the owner badge outside phase scrolling in %s',
		(locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			const events = defaultPath.slice(
				0,
				defaultPath.findIndex((event) => event.kind === 'card_answered')
			);
			useTeamStore.getState().mirror({ config: teamConfig, events });
			useTeamStore.getState().selectTeam(teamConfig.id);
			mount(<TeamView theme={mockTheme} />);
			const header = screen.getByTestId('team-header');
			const actions = screen.getByTestId('team-header-actions');
			expect(header).toHaveStyle({ flexWrap: 'nowrap' });
			expect(actions.parentElement).toBe(header);
			expect(actions).toHaveClass('shrink-0', 'whitespace-nowrap');
			expect(within(actions).getAllByRole('button')).toHaveLength(2);
			const title = within(header).getByRole('heading');
			expect(title).toHaveClass('flex-1', 'min-w-0', 'truncate');
			expect(title.nextElementSibling).toHaveClass('min-w-0', 'truncate');
			expect(title.parentElement).toHaveClass('flex-1', 'min-w-0');
			const strip = screen.getByTestId('team-phase-strip');
			const scroller = screen.getByTestId('team-phase-scroll');
			const badge = screen.getByTestId('team-needs-you');
			expect(scroller).toHaveClass('overflow-x-auto', 'min-w-0');
			expect(strip).not.toHaveClass('overflow-x-auto');
			expect(badge.parentElement).toBe(strip);
			expect(scroller).not.toContainElement(badge);
			expect(badge).toHaveClass('flex-shrink-0', 'whitespace-nowrap');
			expect(scroller.querySelectorAll('[aria-hidden="true"]')).toHaveLength(6);
			const phases = Array.from(scroller.children).filter(
				(child) => !child.hasAttribute('aria-hidden')
			);
			expect(phases).toHaveLength(7);
			for (const phase of phases) expect(phase).not.toHaveTextContent('›');
			expect(scroller.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
		}
	);

	it('keeps the output preview on one left-aligned line and opens its panel', () => {
		useTeamStore.getState().mirror({ config: teamConfig, events: defaultPath });
		useTeamStore.getState().selectTeam(teamConfig.id);
		const { container } = mount(<TeamView theme={mockTheme} />);
		fireEvent.click(
			within(screen.getByTestId('team-header-actions')).getByRole('button', {
				name: en['workflows.team.panel'],
			})
		);
		expect(screen.queryByRole('complementary')).toBeNull();
		const preview = within(
			container.querySelector('[data-status-cell="output"]') as HTMLElement
		).getByRole('button');
		expect(preview).toHaveClass('text-left', 'truncate', 'max-w-full');
		fireEvent.click(preview);
		expect(within(screen.getByRole('complementary')).getAllByRole('tab')[0]).toHaveAttribute(
			'aria-selected',
			'true'
		);
	});
});
