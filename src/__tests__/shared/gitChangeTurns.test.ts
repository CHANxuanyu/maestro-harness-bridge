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
	it.each(['~/repo/sub', '$HOME/repo/sub', '/alias/repo/sub'])(
		'uses execution cwd for the %s alias',
		(cwd) => {
			const changes = {
				...snapshot(['sub/a.ts', 'sub/b.ts', 'outside.ts'], '/home/dev/repo'),
				executionCwd: '/home/dev/repo/sub',
			};
			const result = groupChangesByTurn(
				changes,
				collectTurnWrites([
					user('alias', 1),
					tool('Write', { file_path: 'a.ts' }),
					tool('Write', { file_path: `${cwd}/b.ts` }),
					tool('Write', { file_path: '~/another/outside.ts' }),
				]),
				cwd,
				true
			);
			expect(
				result.groups.map((group) => [group.turnId, group.files.map((file) => file.path)])
			).toEqual([
				['alias', ['sub/a.ts', 'sub/b.ts']],
				[null, ['outside.ts']],
			]);
		}
	);
	it.each(['Write', 'apply_patch'])(
		'retains %s paths before native display input is capped',
		(name) => {
			const input =
				name === 'Write'
					? { file_path: 'large.ts', content: 'x'.repeat(5000) }
					: `*** Begin Patch\n*** Add File: large.ts\n+${'x'.repeat(5000)}\n*** End Patch`;
			const logs = transcriptMessagesToLogEntries([
				{
					type: 'user',
					content: 'Large write',
					uuid: 'large-turn',
					timestamp: '2026-11-06T09:00:00Z',
				},
				{
					type: 'assistant',
					content: '',
					uuid: 'call',
					timestamp: '2026-11-06T09:00:01Z',
					toolUse: [{ type: 'tool_use', id: 'write', name, input }],
				},
				{
					type: 'user',
					content: '',
					uuid: 'result',
					timestamp: '2026-11-06T09:00:02Z',
					toolUse: [{ type: 'tool_result', tool_use_id: 'write', content: 'ok' }],
				},
			]);
			expect(typeof logs[1].metadata?.toolState?.input).toBe('string');
			expect(String(logs[1].metadata?.toolState?.input).length).toBeLessThanOrEqual(4000);
			expect(collectTurnWrites(logs)).toEqual([
				{
					turnId: 'large-turn',
					title: 'Large write',
					timestamp: Date.parse('2026-11-06T09:00:00Z'),
					paths: ['large.ts'],
				},
			]);
			logs[1].metadata!.toolState!.status = 'error';
			expect(collectTurnWrites(logs)).toEqual([]);
		}
	);
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
