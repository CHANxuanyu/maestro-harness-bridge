import { Command } from 'commander';
import { registerNewShellCli } from '../../../cli/commands/new-shell';
import { beforeEach, expect, it, vi } from 'vitest';
import {
	sidebarSearch,
	tabLiveRead,
	queueForceSend,
	projectSettingsSurface,
} from '../../../cli/commands/new-shell';
import { tabNew, tabShow } from '../../../cli/commands/tab';
import { nativeHistory } from '../../../cli/commands/native-history';
import { openModal } from '../../../cli/commands/open-modal';
import { sessionList } from '../../../cli/commands/session';
import { withMaestroClient } from '../../../cli/services/maestro-client';
import { invokeNativeHistory } from '../../../cli/services/agent-sessions';

vi.mock('../../../cli/services/maestro-client', () => ({ withMaestroClient: vi.fn() }));
vi.mock('../../../cli/services/agent-sessions', () => ({ invokeNativeHistory: vi.fn() }));
vi.mock('../../../cli/services/storage', () => ({
	resolveAgentId: (id: string) => id,
	readActiveAgentId: () => 'previous-owner',
	readSettingValue: () => 'en',
	readSessions: () => [{ id: 'owner', cwd: '/project', projectRoot: '/project' }],
	getSessionById: () => ({
		id: 'owner',
		cwd: '/project',
		projectRoot: '/project',
		toolType: 'codex',
	}),
}));
const send = vi.fn();
const tabs = [{ tabId: 'current-tab', agentId: 'owner', active: true, current: true }];
beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error('exit');
	});
	send.mockImplementation(async (payload) =>
		payload.type === 'list_desktop_sessions'
			? { success: true, sessions: tabs }
			: {
					success: true,
					data: { tabId: 'created', query: payload.configPatch?.newShellCommand?.text },
				}
	);
	vi.mocked(withMaestroClient).mockImplementation(async (run) =>
		run({ sendCommand: send } as never)
	);
});

it('sets and clears sidebar search without a persisted inventory read', async () => {
	await sidebarSearch('needle', { agent: 'owner', json: true });
	expect(send).toHaveBeenLastCalledWith(
		{
			type: 'update_session_config',
			sessionId: 'owner',
			configPatch: { newShellCommand: { action: 'sidebar-search', text: 'needle' } },
		},
		'update_session_config_result',
		65000
	);
	await sidebarSearch(undefined, { clear: true, json: true });
	expect(send.mock.calls.at(-1)![0].configPatch.newShellCommand.text).toBe('');
	expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0])).toMatchObject({ query: '' });
});
it('rejects conflicting sidebar arguments', async () => {
	await expect(sidebarSearch('needle', { clear: true })).rejects.toThrow('exit');
	expect(send).not.toHaveBeenCalled();
});
it.each(['tasks', 'refresh'] as const)('routes %s to the live tab owner', async (action) => {
	await tabLiveRead(action, 'active', { json: true });
	expect(send.mock.calls.at(-1)![0]).toEqual({
		type: 'update_session_config',
		sessionId: 'owner',
		configPatch: { newShellCommand: { action, tabId: 'current-tab' } },
	});
});
it('creates and splits with one mutating command and a numeric ratio', async () => {
	await tabNew({ agent: 'owner', split: true, ratio: '0.6', prompt: 'hello', json: true });
	expect(send).toHaveBeenCalledTimes(1);
	expect(send.mock.calls[0][0].configPatch.newShellCommand).toEqual({
		action: 'new-split',
		ratio: 0.6,
		prompt: 'hello',
	});
	expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toMatchObject({ tabId: 'created' });
});
it.each([
	{ ratio: '0.6' },
	{ split: true, ratio: 'NaN' },
	{ split: true, ratio: '0.9' },
	{ split: true, background: true },
])('rejects invalid split options %j', async (options) => {
	await expect(tabNew({ agent: 'owner', ...options })).rejects.toThrow('exit');
	expect(send).not.toHaveBeenCalled();
});
it('routes project settings open and close through the registered surface', async () => {
	await openModal('project-settings', { path: '/project', json: true });
	expect(send.mock.calls.at(-1)![0]).toMatchObject({
		sessionId: 'owner',
		configPatch: { newShellCommand: { action: 'project-settings', path: '/project' } },
	});
	await projectSettingsSurface({ close: true, json: true });
	expect(send.mock.calls.at(-1)![0]).toMatchObject({
		configPatch: { newShellCommand: { action: 'project-settings', close: true } },
	});
});
it('lets the server resolve an item-only force send from live windows', async () => {
	await queueForceSend('item', { json: true });
	expect(send.mock.calls[0][0]).toEqual({
		type: 'update_session_config',
		sessionId: 'active',
		configPatch: { newShellCommand: { action: 'force-send', itemId: 'item' } },
	});
});
it('reports the renderer rejection instead of a successful force send', async () => {
	send.mockResolvedValue({ success: false, error: 'This message has no tab left to run on' });
	await expect(queueForceSend('item', { json: true })).rejects.toThrow('exit');
	expect(vi.mocked(console.log).mock.calls[0][0]).toContain(
		'This message has no tab left to run on'
	);
});
it.each([
	'message-id',
	JSON.stringify({ role: 'user', text: 'needle', timestamp: '2026-01-01T00:00:00Z' }),
])('opens a hit with locator %s', async (locator) => {
	const conversation = {
		nativeSessionId: 'native',
		provider: 'codex',
		ownerId: 'owner',
		projectPath: '/project',
	};
	vi.mocked(invokeNativeHistory).mockResolvedValue({ conversations: [conversation] });
	await nativeHistory('open-hit', 'owner', 'native', { message: locator, json: true });
	expect(send.mock.calls[0][0].configPatch.newShellCommand).toMatchObject({
		action: 'open-hit',
		hit: {
			conversation,
			message: locator.startsWith('{') ? JSON.parse(locator) : { uuid: 'message-id' },
		},
	});
});
it('reads current from live acknowledgement despite a stale active owner on disk', async () => {
	await tabShow('active', { json: true });
	expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0]).tab.tabId).toBe('current-tab');
	await sessionList({ json: true });
	expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0]).sessions).toEqual(tabs);
});
it('does not turn a failed live inventory into an empty successful list', async () => {
	send.mockResolvedValue({ success: false, error: 'Owner did not respond' });
	await expect(sessionList({ json: true })).rejects.toThrow('exit');
	expect(vi.mocked(console.log).mock.calls[0][0]).toContain('Owner did not respond');
});
it('keeps the provider choice when creating directly in a split', async () => {
	await tabNew({ agent: 'owner', split: true, provider: 'codex', json: true });
	expect(send).toHaveBeenCalledTimes(1);
	expect(send.mock.calls[0][0].configPatch.newShellCommand).toEqual({
		action: 'new-split',
		provider: 'codex',
	});
});

it.each([
	[['ui', 'sidebar-search', 'needle', '--json'], 'sidebar-search'],
	[['ui', 'sidebar-search', '--clear', '--json'], 'sidebar-search'],
	[['tab', 'tasks', 'current-tab', '--json'], 'tasks'],
	[['tab', 'refresh', 'current-tab', '--json'], 'refresh'],
	[['open', 'project-settings', '--path', '/project', '--json'], 'project-settings'],
	[['open', 'project-settings', '--close', '--json'], 'project-settings'],
	[['tab', 'new', '--agent', 'owner', '--split', '--ratio', '0.6', '--json'], 'new-split'],
	[['queue', 'force-send', 'item', '--json'], 'force-send'],
	[
		['native-history', 'open-hit', 'owner', 'native', '--message', 'message-id', '--json'],
		'open-hit',
	],
] as const)('parses the registered command %j', async (argv, action) => {
	const program = new Command().exitOverride();
	program.command('native-history <action> [session] [id]').option('--json').action(nativeHistory);
	program.command('open [surface]').option('--json').action(openModal);
	program.command('queue');
	program
		.command('tab')
		.command('new')
		.requiredOption('--agent <id>')
		.option('--json')
		.action(tabNew);
	registerNewShellCli(program);
	vi.mocked(invokeNativeHistory).mockResolvedValue({
		conversations: [
			{ nativeSessionId: 'native', provider: 'codex', ownerId: 'owner', projectPath: '/project' },
		],
	});
	await program.parseAsync([...argv], { from: 'user' });
	expect(send.mock.calls.at(-1)![0].configPatch.newShellCommand.action).toBe(action);
});
