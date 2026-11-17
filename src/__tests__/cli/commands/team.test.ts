import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { teamCommand, parseTeamSeat, registerTeamCommands } from '../../../cli/commands/team';
import { sendSimpleCommand } from '../../../cli/services/session-command';
import { config, ledger, baseline } from '../../shared/team/fixtures';

vi.mock('../../../cli/services/session-command', () => ({
	sendSimpleCommand: vi.fn(),
	failCommand: (message: string) => {
		throw new Error(message);
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.mocked(sendSimpleCommand).mockImplementation(async (payload) => ({
		ok: true,
		result: payload.channel === 'team:list' ? [config] : undefined,
	}));
});
afterEach(() => vi.restoreAllMocks());

describe('team CLI parity', () => {
	it('creates with provider-native settings, substitutions, explicit authorizations and budget', async () => {
		await teamCommand('start', [], {
			idea: 'A team idea',
			pm: 'claude-code:model:high',
			dev: 'codex:gpt:medium',
			qa: 'claude-code:other:low',
			subQa: 'codex:sub:high',
			turns: '15',
			deadline: '2026-12-01T12:00:00Z',
			allow: 'checks,push',
			json: true,
		});
		expect(sendSimpleCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				channel: 'team:create',
				args: [
					expect.objectContaining({
						idea: 'A team idea',
						turnBudget: 15,
						deadline: Date.parse('2026-12-01T12:00:00Z'),
						authorizations: { checks: true, push: true, draftPr: false, temporaryTakeover: false },
						seats: expect.objectContaining({
							qa: {
								tool: 'claude-code',
								model: 'other',
								effort: 'low',
								substitute: { tool: 'codex', model: 'sub', effort: 'high' },
							},
						}),
					}),
				],
			}),
			'bridge.response'
		);
	});
	it('uses baseline status and the same answer handler as the UI', async () => {
		vi.mocked(sendSimpleCommand).mockImplementation(async (payload) => ({
			ok: true,
			result:
				payload.channel === 'team:list'
					? [config]
					: payload.channel === 'team:status'
						? { openCards: [{ id: 'baseline:2', boundary: 'baseline' }] }
						: undefined,
		}));
		await teamCommand('baseline', ['confirm'], { json: true });
		expect(sendSimpleCommand).toHaveBeenLastCalledWith(
			{ type: 'bridge.invoke', channel: 'team:answer', args: [config.id, 'baseline:2', 'confirm'] },
			'bridge.response'
		);
	});
	it.each(['pause', 'resume', 'stop', 'accept', 'export', 'get', 'status'])(
		'routes %s through main with JSON',
		async (action) => {
			await teamCommand(action, [], { team: 'team-', json: true });
			expect(sendSimpleCommand).toHaveBeenLastCalledWith(
				{ type: 'bridge.invoke', channel: `team:${action}`, args: [config.id] },
				'bridge.response'
			);
		}
	);
	it('registers executable commander verbs and preserves multiword messages', async () => {
		const program = new Command();
		registerTeamCommands(program);
		await program.parseAsync([
			'node',
			'cli',
			'team',
			'say',
			'--to',
			'qa',
			'Please',
			'inspect',
			'--json',
		]);
		expect(sendSimpleCommand).toHaveBeenLastCalledWith(
			{ type: 'bridge.invoke', channel: 'team:say', args: [config.id, 'Please inspect', 'qa'] },
			'bridge.response'
		);
	});
	it.each([
		[
			['baseline', 'edit', 'A1', 'Parses', 'whole hours'],
			'team:baselineEdit',
			['A1', 'Parses whole hours'],
		],
		[
			['baseline', 'edit', 'A1', '--text', 'Two complete words'],
			'team:baselineEdit',
			['A1', 'Two complete words'],
		],
		[['baseline', 'diff'], 'team:baselineDiff', []],
		[
			['baseline', 'return', '--note', 'Clarify the expected output'],
			'team:baselineReturn',
			['Clarify the expected output'],
		],
		[
			['request-changes', '--note', 'Add the empty state'],
			'team:requestChanges',
			['Add the empty state'],
		],
		[['log', '--seat', 'qa'], 'team:log', ['qa']],
	] as const)('parses M2 command %j into the same main action', async (args, channel, tail) => {
		const program = new Command();
		registerTeamCommands(program);
		await program.parseAsync(['node', 'cli', 'team', ...args, '--json']);
		expect(sendSimpleCommand).toHaveBeenLastCalledWith(
			{
				type: 'bridge.invoke',
				channel,
				args: [config.id, ...tail],
			},
			'bridge.response'
		);
	});
	it.each(['decisions', 'meetings', 'changes', 'suggestions'])(
		'reads %s from the canonical ledger projection',
		async (section) => {
			vi.mocked(sendSimpleCommand).mockImplementation(async (payload) => ({
				ok: true,
				result:
					payload.channel === 'team:list' ? [config] : { config, events: ledger(...baseline) },
			}));
			await teamCommand('show', [section], { json: true });
			expect(sendSimpleCommand).toHaveBeenLastCalledWith(
				{ type: 'bridge.invoke', channel: 'team:get', args: [config.id] },
				'bridge.response'
			);
			expect(console.log).toHaveBeenCalledWith(
				section === 'decisions' ? '{"objections":[],"decisions":[],"answers":[]}' : '[]'
			);
		}
	);
	it('refuses unknown or ambiguous team ids and invalid seat settings', async () => {
		expect(() => parseTeamSeat('terminal')).toThrow();
		expect(() => parseTeamSeat('codex:model:Ultra')).toThrow('Ultra');
		vi.mocked(sendSimpleCommand).mockResolvedValue({
			ok: true,
			result: [config, { ...config, id: 'team-2' }],
		});
		await expect(teamCommand('pause', [], { json: true })).rejects.toThrow('Choose a team');
	});
});
