import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerFollowUpCommand } from '../../../cli/commands/follow-up';
import { registerChecksCommand } from '../../../cli/commands/checks';
import { sendSimpleCommand } from '../../../cli/services/session-command';

vi.mock('../../../cli/services/session-command', () => ({
	sendSimpleCommand: vi.fn(),
	failCommand: (message: string) => {
		throw new Error(message);
	},
}));
vi.mock('../../../cli/commands/project-settings', () => ({
	projectSettingsTranslator: () => (key: string) => key,
}));

describe('conversation automation CLI parity', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.mocked(sendSimpleCommand).mockResolvedValue({
			ok: true,
			result: { checks: [], followUps: [] },
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});
	const parse = async (...args: string[]) => {
		const program = new Command();
		registerFollowUpCommand(program);
		registerChecksCommand(program);
		await program.parseAsync([
			'node',
			'maestro-cli',
			...args,
			'--agent',
			'owner',
			'--tab',
			'exact',
			'--json',
		]);
	};
	it.each([
		[['follow-up', 'add', '--after', '20', '--reason', 'Original reason'], 'follow-add'],
		[['follow-up', 'add', '--process', 'observed', '--reason', 'Command result'], 'follow-add'],
		[['follow-up', 'add', '--ci', '42', '--reason', 'CI result'], 'follow-add'],
		[['follow-up', 'list'], 'status'],
		[['follow-up', 'cancel', 'follow-id'], 'follow-cancel'],
		[['follow-up', 'extend'], 'extend'],
		[['follow-up', 'stop'], 'stop'],
		[['checks', 'set', '--command', 'npm test', 'npm run lint'], 'checks-set'],
		[['checks', 'run'], 'checks-run'],
		[['checks', 'status'], 'status'],
		[['checks', 'authorize', 'project'], 'authorize'],
		[['checks', 'authorize', 'once', '--check', 'c'], 'authorize'],
		[['checks', 'fix', 'auto', '--total-minutes', '120'], 'fix'],
		[['checks', 'answer', '0'], 'answer'],
		[
			[
				'checks',
				'plan',
				'--proposal',
				'{"basis":"new evidence","difference":"new experiment","expectation":"pass","candidates":[]}',
			],
			'plan',
		],
	] as const)('routes %j through the shared main service', async (args, action) => {
		await parse(...args);
		expect(sendSimpleCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'bridge.invoke',
				channel: 'conversationAutomation:execute',
				args: [
					expect.objectContaining({
						action,
						target: { kind: 'conversation', sessionId: 'owner', tabId: 'exact' },
					}),
				],
			}),
			'bridge.response'
		);
		expect(console.log).toHaveBeenCalledWith(JSON.stringify({ checks: [], followUps: [] }));
	});
	it('inherits injected caller identity without choosing an active tab', async () => {
		vi.stubEnv('MAESTRO_CALLER_AGENT_ID', 'agent');
		vi.stubEnv('MAESTRO_CALLER_TAB_ID', 'tab');
		const program = new Command();
		registerFollowUpCommand(program);
		await program.parseAsync([
			'node',
			'cli',
			'follow-up',
			'add',
			'--after',
			'20',
			'--reason',
			'from shell',
			'--json',
		]);
		expect(sendSimpleCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				args: [
					expect.objectContaining({
						caller: { agentId: 'agent', tabId: 'tab' },
						target: { kind: 'conversation', sessionId: 'agent', tabId: 'tab' },
					}),
				],
			}),
			'bridge.response'
		);
	});
	it('rejects unobservable and ambiguous events', async () => {
		await expect(parse('follow-up', 'add', '--reason', 'maybe later')).rejects.toThrow(
			'cliCondition'
		);
		await expect(
			parse('follow-up', 'add', '--after', '20', '--ci', '42', '--reason', 'ambiguous')
		).rejects.toThrow('cliCondition');
		expect(sendSimpleCommand).not.toHaveBeenCalled();
	});
});
