import { describe, expect, it } from 'vitest';
import { collectTurnWrites, groupChangesByTurn } from '../../shared/gitChangeTurns';
import { transcriptMessagesToLogEntries } from '../../renderer/utils/transcriptMessages';
import type { LogEntry } from '../../renderer/types';
import type { GitChanges } from '../../shared/gitChanges';

const user = (id: string, timestamp: number): LogEntry => ({
	id,
	timestamp,
	source: 'user',
	text: `${id}\nMore detail`,
});
const tool = (name: string, input: unknown, status = 'completed'): LogEntry => ({
	id: name,
	timestamp: 3,
	source: 'tool',
	text: name,
	metadata: { toolState: { status: status as 'completed', input } },
});
const snapshot = (paths: string[], root = '/repo'): GitChanges => ({
	root,
	branch: 'main',
	truncated: false,
	files: paths.map((path) => ({
		path,
		status: 'modified',
		staged: false,
		additions: 1,
		deletions: 0,
	})),
	totals: { files: paths.length, additions: paths.length, deletions: 0 },
});

describe('conversation changes by turn', () => {
	it('keeps earlier writes attached to a currently renamed file, without attributing copies', () => {
		const changes = snapshot(['new.ts', 'copy.ts']);
		changes.files[0] = { ...changes.files[0], status: 'renamed', oldPath: 'old.ts' };
		changes.files[1] = { ...changes.files[1], status: 'copied', oldPath: 'old.ts' };
		const result = groupChangesByTurn(
			changes,
			collectTurnWrites([user('u', 1), tool('Edit', { file_path: 'old.ts' })]),
			'/repo'
		);
		expect(result.groups.map((g) => [g.turnId, g.files.map((f) => f.path)])).toEqual([
			['u', ['new.ts']],
			[null, ['copy.ts']],
		]);
	});
	it('pairs Claude results, keeps successful writes, repeats shared files and leaves unmatched changes last', () => {
		const logs = transcriptMessagesToLogEntries([
			{
				type: 'user',
				content: 'First line\nDetails',
				uuid: 'u1',
				timestamp: '2026-11-06T09:00:00Z',
			},
			{
				type: 'assistant',
				content: '',
				uuid: 'a1',
				timestamp: '2026-11-06T09:00:01Z',
				toolUse: [
					{ type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path: '/repo/shared.ts' } },
					{ type: 'tool_use', id: 'write', name: 'Write', input: { file_path: 'gone.ts' } },
					{ type: 'tool_use', id: 'fail', name: 'MultiEdit', input: { file_path: 'failed.ts' } },
				],
			},
			{
				type: 'user',
				content: '',
				uuid: 'results',
				timestamp: '2026-11-06T09:00:02Z',
				toolUse: [
					{ type: 'tool_result', tool_use_id: 'edit', content: 'ok' },
					{ type: 'tool_result', tool_use_id: 'write', content: 'ok' },
					{ type: 'tool_result', tool_use_id: 'fail', content: 'denied', is_error: true },
				],
			},
		]);
		logs.push(
			user('u2', Date.parse('2026-11-06T09:01:00Z')),
			tool('MultiEdit', { file_path: 'shared.ts' }),
			tool('NotebookEdit', { notebook_path: '/repo/book.ipynb' }),
			tool('Write', { file_path: 'shared.ts' }),
			tool('Bash', { command: 'touch manual.ts' })
		);
		const result = groupChangesByTurn(
			snapshot(['shared.ts', 'book.ipynb', 'failed.ts', 'manual.ts']),
			collectTurnWrites(logs),
			'/repo'
		);
		expect(result.hasWriteRecords).toBe(true);
		expect(result.groups.map((g) => [g.turnId, g.files.map((f) => f.path)])).toEqual([
			['u2', ['shared.ts', 'book.ipynb']],
			['u1', ['shared.ts']],
			[null, ['failed.ts', 'manual.ts']],
		]);
		expect(result.groups[1]).toMatchObject({
			title: 'First line',
			timestamp: Date.parse('2026-11-06T09:00:00Z'),
		});
		expect(result.diffScope).toBe('current');
	});

	it('reads Codex apply_patch and file_change events, never commands or failed and unfinished calls', () => {
		const logs = [
			user('first', 1),
			tool(
				'apply_patch',
				'*** Begin Patch\n*** Add File: a.ts\n+x\n*** Update File: b.ts\n*** Move to: renamed.ts\n@@\n-x\n+y\n*** Delete File: deleted.ts\n*** End Patch'
			),
			user('second', 2),
			tool('functions.apply_patch', {
				patch: '*** Begin Patch\n*** Update File: a.ts\n@@\n-x\n+y\n*** End Patch',
			}),
			tool('file_change', { changes: [{ path: '/repo/c.ts', kind: 'add' }] }),
			...['error', 'failed', 'canceled', 'unknown', 'running'].map((status) =>
				tool('Write', { file_path: `${status}.ts` }, status)
			),
			tool('exec_command', { command: 'apply_patch fake.ts' }),
			tool('Write', {}),
			tool('apply_patch', 'See *** Update File: fake.ts'),
		];
		const result = groupChangesByTurn(
			snapshot(['a.ts', 'renamed.ts', 'deleted.ts', 'c.ts', 'fake.ts', 'failed.ts']),
			collectTurnWrites(logs),
			'/repo'
		);
		expect(result.groups.map((g) => g.files.map((f) => f.path))).toEqual([
			['a.ts', 'c.ts'],
			['a.ts', 'renamed.ts', 'deleted.ts'],
			['fake.ts', 'failed.ts'],
		]);
	});

	it('matches paths against the conversation cwd, preserves SSH spelling and never guesses outside the root', () => {
		const logs = [
			user('remote', 1),
			tool('Write', { file_path: './src/a.ts' }),
			tool('Write', { file_path: '/srv/repo/sibling.ts' }),
			tool('Write', { file_path: '/other/a.ts' }),
			tool('Write', { file_path: '../outside.ts' }),
			tool('Write', { file_path: 'literal\\name.ts' }),
		];
		const result = groupChangesByTurn(
			snapshot(['sub/src/a.ts', 'sibling.ts', 'a.ts', 'sub/literal\\name.ts'], '/srv/repo'),
			collectTurnWrites(logs),
			'/srv/repo/sub',
			true
		);
		expect(result.groups[0].files.map((f) => f.path)).toEqual([
			'sub/src/a.ts',
			'sibling.ts',
			'sub/literal\\name.ts',
		]);
		expect(result.groups[1].files.map((f) => f.path)).toEqual(['a.ts']);
	});

	it('normalizes Windows paths without reading a filesystem and truncates the first line', () => {
		const logs = [
			{ ...user('u', 1), text: 'x'.repeat(200) + '\nsecond' },
			tool('Write', { file_path: 'c:\\repo\\a.ts' }),
		];
		const result = groupChangesByTurn(
			snapshot(['a.ts'], 'C:/repo'),
			collectTurnWrites(logs),
			'C:\\repo'
		);
		expect(result.groups[0].files.map((f) => f.path)).toEqual(['a.ts']);
		expect(result.groups[0].title.length).toBeLessThanOrEqual(120);
	});

	it('reports no write records without attributing orphan or unknown tools', () => {
		const logs = [
			tool('Write', { file_path: 'a.ts' }),
			user('u', 1),
			tool('Read', { file_path: 'a.ts' }),
			tool('Write', {}),
		];
		const result = groupChangesByTurn(snapshot(['a.ts']), collectTurnWrites(logs), '/repo');
		expect(result.hasWriteRecords).toBe(false);
		expect(result.groups).toEqual([expect.objectContaining({ turnId: null })]);
	});
});
