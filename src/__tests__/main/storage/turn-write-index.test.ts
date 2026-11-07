import { describe, expect, it, vi } from 'vitest';
import { createNativeTurnWriteReader } from '../../../main/storage/turn-write-index';
import type { AgentSessionStorage, SessionMessage } from '../../../main/agents/session-storage';
import * as conversion from '../../../shared/transcriptEntries';

describe('independent native turn index', () => {
	it('reuses closed turns but pairs a late result even after a later user turn', async () => {
		const convert = vi.spyOn(conversion, 'transcriptMessagesToLogEntries');
		const timestamp = '2026-11-06T09:00:00Z';
		const messages: SessionMessage[] = [
			{ type: 'user', uuid: 'first', timestamp, content: 'First' },
			{
				type: 'assistant',
				uuid: 'done',
				timestamp,
				content: '',
				toolUse: [
					{ tool: 'Write', state: { status: 'completed', input: { file_path: 'first.ts' } } },
				],
			},
			{ type: 'user', uuid: 'second', timestamp, content: 'Second' },
			{
				type: 'assistant',
				uuid: 'pending',
				timestamp,
				content: '',
				toolUse: [
					{ type: 'tool_use', id: 'pending', name: 'Write', input: { file_path: 'second.ts' } },
				],
			},
			{ type: 'user', uuid: 'third', timestamp, content: 'Third' },
		];
		let revision = 'one';
		const storage = {
			getTranscriptRevision: vi.fn(async () => revision),
			readSessionMessages: vi.fn(async () => ({
				messages: [...messages],
				total: messages.length,
				hasMore: false,
			})),
		} as unknown as AgentSessionStorage;
		const read = createNativeTurnWriteReader();
		try {
			expect(
				(await read('claude-code', storage, '/repo', 'native', { configDir: '/fixture' })).map(
					(turn) => turn.paths
				)
			).toEqual([['first.ts']]);
			messages.push({
				type: 'user',
				uuid: 'result',
				timestamp,
				content: '',
				toolUse: [{ type: 'tool_result', tool_use_id: 'pending', content: 'ok' }],
			});
			revision = 'two';
			expect(
				(await read('claude-code', storage, '/repo', 'native', { configDir: '/fixture' })).map(
					(turn) => turn.paths
				)
			).toEqual([['second.ts'], ['first.ts']]);
			expect(convert.mock.calls.map(([input]) => input.length)).toEqual([5, 4]);
			await read('claude-code', storage, '/repo', 'native', { configDir: '/fixture' });
			expect(storage.readSessionMessages).toHaveBeenCalledTimes(2);
			await read('claude-code', storage, '/repo', 'native', { configDir: '/different-fixture' });
			expect(storage.readSessionMessages).toHaveBeenCalledTimes(3);
		} finally {
			convert.mockRestore();
		}
	});

	it('never probes a remote Claude path locally and never accepts a partial page', async () => {
		const storage = {
			getTranscriptRevision: vi.fn(),
			readSessionMessages: vi.fn(async () => ({ messages: [], total: 600, hasMore: true })),
		} as unknown as AgentSessionStorage;
		const remote = {
			id: 'remote',
			enabled: true,
			name: 'Fixture',
			host: 'fixture.invalid',
			port: 22,
			username: 'fixture',
		};
		await expect(
			createNativeTurnWriteReader()(
				'claude-code',
				storage,
				'~/repo',
				'native',
				{ configDir: '~/account' },
				remote
			)
		).rejects.toThrow('TURN_WRITES_INCOMPLETE');
		expect(storage.getTranscriptRevision).not.toHaveBeenCalled();
		expect(storage.readSessionMessages).toHaveBeenCalledWith(
			'~/repo',
			'native',
			{ configDir: '~/account', readOnly: true, offset: 0, limit: Number.MAX_SAFE_INTEGER },
			remote
		);
	});
});
