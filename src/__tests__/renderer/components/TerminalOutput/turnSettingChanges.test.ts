import { describe, it, expect } from 'vitest';
import type { LogEntry } from '../../../../renderer/types';
import {
	computeTurnSettingChanges,
	isFeedReplyRow,
	sameTurnSettingChange,
} from '../../../../renderer/components/TerminalOutput/utils/turnSettingChanges';

let seq = 0;
const entry = (overrides: Partial<LogEntry>): LogEntry => ({
	id: `row-${++seq}`,
	timestamp: 1_000 + seq,
	source: 'stdout',
	text: 'text',
	...overrides,
});

const user = (overrides: Partial<LogEntry> = {}) => entry({ source: 'user', ...overrides });
const reply = (overrides: Partial<LogEntry> = {}) => entry({ source: 'stdout', ...overrides });

describe('isFeedReplyRow', () => {
	it('counts the agent answer and a cross-agent answer as replies', () => {
		expect(isFeedReplyRow(reply())).toBe(true);
		expect(isFeedReplyRow(entry({ source: 'ai' }))).toBe(true);
		expect(
			isFeedReplyRow(
				reply({
					metadata: {
						crossAgent: {
							requestId: 'r',
							fromSessionId: 's',
							fromAgentName: 'Reviewer',
							fromToolType: 'codex',
						},
					},
				})
			)
		).toBe(true);
	});

	it('excludes everything drawn around an answer, decided by fields not text', () => {
		expect(isFeedReplyRow(user())).toBe(false);
		expect(isFeedReplyRow(entry({ source: 'tool' }))).toBe(false);
		expect(isFeedReplyRow(entry({ source: 'thinking' }))).toBe(false);
		expect(isFeedReplyRow(entry({ source: 'error' }))).toBe(false);
		expect(isFeedReplyRow(entry({ source: 'stderr' }))).toBe(false);
		// The Stop marker and every other notice is a system entry.
		expect(isFeedReplyRow(entry({ source: 'system', text: 'Canceled by user' }))).toBe(false);
		// Progress notes (live and stored) and self-contained cards.
		expect(isFeedReplyRow(reply({ purpose: 'commentary' }))).toBe(false);
		expect(
			isFeedReplyRow(reply({ nativeTranscript: { messageId: 'm', channel: 'commentary' } }))
		).toBe(false);
		expect(isFeedReplyRow(reply({ retryOutageId: 'o' }))).toBe(false);
		// A reply whose text merely says "Summary:" is still a reply.
		expect(isFeedReplyRow(reply({ text: 'Summary: done. Details: none.' }))).toBe(true);
	});
});

describe('computeTurnSettingChanges', () => {
	it('reports nothing for the first stamped reply: it has no predecessor', () => {
		const first = reply({ turnModel: 'opus', turnEffort: 'high' });
		const { changes, latestReplyId } = computeTurnSettingChanges([user(), first]);
		expect(changes.size).toBe(0);
		expect(latestReplyId).toBe(first.id);
	});

	it('reports a model change and an effort change on their own axes', () => {
		const a = reply({ turnModel: 'opus', turnEffort: 'high' });
		const b = reply({ turnModel: 'sonnet', turnEffort: 'high' });
		const c = reply({ turnModel: 'sonnet', turnEffort: 'medium' });
		const d = reply({ turnModel: 'opus', turnEffort: 'low' });
		const { changes } = computeTurnSettingChanges([user(), a, user(), b, user(), c, user(), d]);
		expect(changes.get(a.id)).toBeUndefined();
		expect(changes.get(b.id)).toEqual({ model: { from: 'opus', to: 'sonnet' } });
		expect(changes.get(c.id)).toEqual({ effort: { from: 'high', to: 'medium' } });
		expect(changes.get(d.id)).toEqual({
			model: { from: 'sonnet', to: 'opus' },
			effort: { from: 'medium', to: 'low' },
		});
	});

	it('treats an unstamped reply as unknown: no change, and the baseline survives it', () => {
		const a = reply({ turnModel: 'opus' });
		const unknown = reply({});
		const same = reply({ turnModel: 'opus' });
		const changed = reply({ turnModel: 'sonnet' });
		const { changes } = computeTurnSettingChanges([a, unknown, same, changed]);
		expect(changes.has(unknown.id)).toBe(false);
		// The unknown row did not reset the baseline, so "opus" again is no change...
		expect(changes.has(same.id)).toBe(false);
		// ...and the real switch is still attributed to the reply that made it.
		expect(changes.get(changed.id)).toEqual({ model: { from: 'opus', to: 'sonnet' } });
	});

	it('never lets a cross-agent answer report or move the baseline, yet it can be newest', () => {
		const a = reply({ turnModel: 'opus' });
		const cross = reply({
			turnModel: 'gpt-other',
			metadata: {
				crossAgent: {
					requestId: 'r',
					fromSessionId: 's',
					fromAgentName: 'Reviewer',
					fromToolType: 'codex',
				},
			},
		});
		const b = reply({ turnModel: 'opus' });
		const result = computeTurnSettingChanges([a, user(), cross]);
		expect(result.changes.size).toBe(0);
		expect(result.latestReplyId).toBe(cross.id);
		// The local baseline is still "opus": the next local reply on opus is no change.
		expect(computeTurnSettingChanges([a, cross, b]).changes.size).toBe(0);
	});

	it('skips tools, progress, errors and system notices when finding the newest reply', () => {
		const answer = reply({ turnModel: 'opus' });
		const rows = [
			user(),
			answer,
			entry({ source: 'tool', turnModel: 'sonnet' }),
			reply({ purpose: 'commentary', turnModel: 'sonnet' }),
			entry({ source: 'error', turnModel: 'sonnet' }),
			entry({ source: 'system', text: 'Canceled by user' }),
		];
		const { changes, latestReplyId } = computeTurnSettingChanges(rows);
		// A stamped non-reply must not create a change on the next reply either.
		expect(changes.size).toBe(0);
		// The Stop notice is not the newest ordinary assistant reply.
		expect(latestReplyId).toBe(answer.id);
	});

	it('reports no newest reply for a conversation with none', () => {
		expect(computeTurnSettingChanges([user()]).latestReplyId).toBeNull();
		expect(computeTurnSettingChanges([]).latestReplyId).toBeNull();
	});
});

describe('sameTurnSettingChange', () => {
	it('compares by value so a rebuilt map does not defeat the row memo', () => {
		expect(sameTurnSettingChange(undefined, undefined)).toBe(true);
		expect(
			sameTurnSettingChange({ model: { from: 'a', to: 'b' } }, { model: { from: 'a', to: 'b' } })
		).toBe(true);
		expect(sameTurnSettingChange({ model: { from: 'a', to: 'b' } }, undefined)).toBe(false);
		expect(
			sameTurnSettingChange({ model: { from: 'a', to: 'b' } }, { model: { from: 'a', to: 'c' } })
		).toBe(false);
		expect(
			sameTurnSettingChange(
				{ model: { from: 'a', to: 'b' } },
				{ model: { from: 'a', to: 'b' }, effort: { from: 'x', to: 'y' } }
			)
		).toBe(false);
	});
});
