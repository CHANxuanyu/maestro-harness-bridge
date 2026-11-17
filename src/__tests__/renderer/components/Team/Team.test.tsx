import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { defaultPath, teamConfig, decision, baselineCard } from './defaultPath';
import { mockTheme } from '../../../helpers/mockTheme';
import { resetStore, resetAllStores, createMockSession, createMockAITab } from '../../../helpers';
import type { ProviderModelCatalog } from '../../../../shared/modelCatalog';
import { openUiSurface } from '../../../../renderer/utils/openUiSurface';

const bridge = vi.hoisted(() => ({ client: undefined as TeamClient | undefined }));
vi.mock('../../../../renderer/services/teamClient', () => ({
	teamClient: () => bridge.client,
	teamFeatures: { baselineEdit: false, baselineDiff: false, baselineReturn: false },
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
	it('shows baseline confirmation while extended actions are gated', () => {
		mount(
			<OwnerCard teamId={teamConfig.id} state={reduceLedger(defaultPath)} card={baselineCard} />
		);
		expect(screen.getAllByRole('button')).toHaveLength(1);
		expect(screen.getByRole('button')).toHaveTextContent('确认基线');
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
	it('opens a read-only native transcript and Esc returns focus to its seat row', async () => {
		useTeamStore.getState().mirror({ config: teamConfig, events: defaultPath });
		useTeamStore.getState().selectTeam(teamConfig.id);
		window.maestro.agentSessions.read = vi.fn().mockResolvedValue({
			messages: [
				{
					type: 'assistant',
					content: 'Native member reply',
					uuid: 'm1',
					timestamp: new Date().toISOString(),
				},
			],
			hasMore: false,
			total: 1,
		});
		mount(
			<>
				<TeamSidebar theme={mockTheme} projectKey="path:local:/project" />
				<TeamView theme={mockTheme} />
			</>
		);
		const row = screen.getByRole('button', { name: `Developer ${teamConfig.title}` });
		row.focus();
		fireEvent.click(row);
		await screen.findByText('Native member reply');
		expect(window.maestro.agentSessions.read).toHaveBeenCalledWith(
			'codex',
			'/project/dev',
			'native-dev',
			{ offset: 0, limit: 50, readOnly: true },
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
