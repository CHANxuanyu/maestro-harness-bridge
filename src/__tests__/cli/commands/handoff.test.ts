import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../cli/services/session-command', async (original) => ({
	...(await original<typeof import('../../../cli/services/session-command')>()),
	resolveTabEntry: vi.fn(),
	sendSimpleCommand: vi.fn(),
}));

import { handoff } from '../../../cli/commands/handoff';
import { resolveTabEntry, sendSimpleCommand } from '../../../cli/services/session-command';

describe('handoff CLI consent and result', () => {
	const output = vi.fn();
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'log').mockImplementation(output);
		vi.spyOn(console, 'error').mockImplementation(output);
		vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		vi.mocked(resolveTabEntry).mockResolvedValue({
			agentId: 'source-agent',
			tabId: 'source-tab',
		} as never);
		vi.mocked(sendSimpleCommand).mockResolvedValue({
			success: true,
			agentId: 'target-agent',
			tabId: 'new-tab',
			createdAgent: false,
			state: 'draft',
			draft: { text: 'The draft', estimatedTokens: 3 },
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it('defaults to a background draft and returns the actual target IDs and preview', async () => {
		await handoff('source-prefix', 'codex', { json: true });
		expect(resolveTabEntry).toHaveBeenCalledWith('source-prefix', undefined);
		expect(sendSimpleCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'ai_handoff',
				action: 'prepare',
				sourceAgentId: 'source-agent',
				sourceTabId: 'source-tab',
				targetProvider: 'codex',
				send: false,
				background: true,
			}),
			'ai_handoff_result'
		);
		expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
			success: true,
			agentId: 'target-agent',
			tabId: 'new-tab',
			state: 'draft',
			draft: { text: 'The draft', estimatedTokens: 3 },
		});
	});

	it('sends only with the explicit flag and forwards the instruction and budget', async () => {
		await handoff('active', 'deepseek', {
			send: true,
			focus: true,
			agent: 'source',
			instruction: 'Review the parser',
			maxTokens: '2048',
			json: true,
		});
		expect(resolveTabEntry).toHaveBeenCalledWith('active', 'source');
		expect(sendSimpleCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				targetProvider: 'deepseek',
				send: true,
				background: false,
				instruction: 'Review the parser',
				budgetTokens: 2048,
			}),
			'ai_handoff_result'
		);
	});

	it('lists available targets without asking the desktop to create or send', async () => {
		vi.mocked(sendSimpleCommand).mockResolvedValue({
			success: true,
			targets: [{ provider: 'codex', runnerId: 'existing' }],
		});
		await handoff('active', undefined, { listTargets: true, json: true });
		expect(sendSimpleCommand).toHaveBeenCalledExactlyOnceWith(
			{ type: 'ai_handoff', action: 'targets', sourceAgentId: 'source-agent' },
			'ai_handoff_result'
		);
		expect(JSON.parse(output.mock.calls[0][0]).targets).toEqual([
			{ provider: 'codex', runnerId: 'existing' },
		]);
	});

	it.each([
		{ target: undefined, options: {} },
		{ target: 'other', options: {} },
		{ target: 'codex', options: { maxTokens: '1.5' } },
		{ target: 'codex', options: { maxTokens: '0' } },
		{ target: 'codex', options: { maxTokens: 'NaN' } },
		{ target: undefined, options: { listTargets: true, send: true } },
	])('does not contact the desktop for invalid input: %j', async ({ target, options }) => {
		await handoff('source', target, { ...options, json: true });
		expect(sendSimpleCommand).not.toHaveBeenCalled();
		expect(resolveTabEntry).not.toHaveBeenCalled();
		expect(process.exit).toHaveBeenCalledWith(1);
	});
});
