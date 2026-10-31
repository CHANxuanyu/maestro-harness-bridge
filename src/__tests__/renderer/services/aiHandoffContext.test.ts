import { describe, expect, it } from 'vitest';
import { buildHandoffDraft } from '../../../renderer/services/aiHandoffContext';
import { extractTabContext } from '../../../renderer/utils/contextExtractor';
import { createMockAITab } from '../../helpers/mockTab';
import { createMockSession } from '../../helpers/mockSession';
import { estimateTokenCount } from '../../../shared/formatters';
import { scanMentionSpans } from '../../../shared/mentionPatterns';
import type { LogEntry } from '../../../renderer/types';

const log = (id: string, source: LogEntry['source'], text: string): LogEntry => ({
	id,
	source,
	text,
	timestamp: 1,
});
function context(logs: LogEntry[]) {
	return extractTabContext(
		createMockAITab({ id: 'source-tab', agentSessionId: 'native-source', name: 'Parser', logs }),
		'Claude',
		createMockSession({ id: 'source-agent', projectRoot: '/project' })
	);
}

describe('handoff draft from the existing tab context', () => {
	it('keeps the source and answer bodies, makes each tool one line, and leaves source bytes alone', () => {
		const source = context([
			log('u', 'user', 'Keep this question.\nAnd its second line.'),
			{
				...log('t', 'tool', 'Read'),
				metadata: {
					toolState: {
						status: 'completed',
						input: { file_path: '/large-file' },
						output: 'RAW TOOL NOISE'.repeat(1000),
					},
				},
			},
			log('a', 'stdout', 'Keep this answer.\nAnd its code.'),
			log('think', 'thinking', 'PRIVATE REASONING'),
			log('err', 'stderr', 'TRANSPORT NOISE'),
			log('sys', 'system', 'SYSTEM NOISE'),
			{ ...log('progress', 'stdout', 'PROGRESS NOISE'), purpose: 'commentary' },
		]);
		const before = JSON.stringify(source);
		const draft = buildHandoffDraft(source, { provider: 'claude-code' });
		expect(draft.text).toContain('Claude / Parser');
		expect(draft.text).toContain('native-source');
		expect(draft.text).toContain('/project');
		expect(draft.text).toContain('Keep this question.\nAnd its second line.');
		expect(draft.text).toContain('Keep this answer.\nAnd its code.');
		expect(draft.text.split('\n').filter((line) => line.includes('Read'))).toHaveLength(1);
		expect(draft.text).not.toMatch(/NOISE|PRIVATE REASONING|file_path/);
		expect(draft.omittedEntries).toBe(0);
		expect(draft.estimatedTokens).toBe(estimateTokenCount(draft.text));
		expect(JSON.stringify(source)).toBe(before);
	});

	it('keeps recent bodies inside the budget and reports the omitted entries', () => {
		const source = context([
			log('old', 'user', 'OLD CONTENT '.repeat(3000)),
			log('u', 'user', 'The most recent question.'),
			log('a', 'ai', 'The most recent answer.'),
		]);
		const draft = buildHandoffDraft(source, { provider: 'codex', budgetTokens: 256 });
		expect(draft.estimatedTokens).toBeLessThanOrEqual(256);
		expect(draft.omittedEntries).toBe(1);
		expect(draft.text).not.toContain('OLD CONTENT');
		expect(draft.text).toContain('The most recent question.');
		expect(draft.text).toContain('The most recent answer.');
		expect(draft.text).toMatch(/omitted/i);
	});

	it('retains the tail of an oversized newest body, including literal mentions', () => {
		const draft = buildHandoffDraft(
			context([
				log('old', 'user', 'Old request'),
				log('last', 'ai', `${'x'.repeat(8000)} @Reviewer Latest answer.`),
			]),
			{ provider: 'deepseek', budgetTokens: 256 }
		);
		expect(draft.estimatedTokens).toBeLessThanOrEqual(256);
		expect(draft.text).toContain('Latest answer.');
		expect(draft.omittedEntries).toBe(1);
		expect(draft.omittedCharacters).toBeGreaterThan(0);
		expect(draft.text).toContain('Assistant:\n');
		expect(scanMentionSpans(draft.text)).toEqual([]);
	});

	it('accepts an exact-fit budget without reserving an omission notice it does not need', () => {
		const source = context([log('u', 'user', 'x')]);
		const full = buildHandoffDraft(source, { provider: 'codex' });
		const exact = buildHandoffDraft(source, {
			provider: 'codex',
			budgetTokens: full.estimatedTokens,
		});
		expect(exact.text).toBe(full.text);
		expect(exact.omittedEntries).toBe(0);
	});

	it('quotes historical mentions even inside fences instead of dispatching to other agents', () => {
		const text = 'Ask @Reviewer about @src/parser.ts.\n```\n@Other\n```\nAlready `@Quoted`.';
		const source = context([log('u', 'user', text)]);
		const draft = buildHandoffDraft(source, {
			provider: 'claude-code',
			instruction: 'Continue the repair, mentioning @Reviewer literally.',
		});
		expect(draft.text).toContain('@Reviewer');
		expect(draft.text).toContain('@src/parser.ts');
		expect(draft.text).toContain('Continue the repair');
		expect(scanMentionSpans(draft.text)).toEqual([]);
		expect(source.logs[0].text).toBe(text);
	});

	it.each([0, -1, 1.5, NaN, Infinity])('rejects an invalid budget: %s', (budgetTokens) => {
		expect(() => buildHandoffDraft(context([]), { provider: 'codex', budgetTokens })).toThrow();
	});

	it('does not silently drop an instruction that cannot fit in the budget', () => {
		expect(() =>
			buildHandoffDraft(context([log('u', 'user', 'hello')]), {
				provider: 'codex',
				budgetTokens: 256,
				instruction: 'Instruction '.repeat(1000),
			})
		).toThrow(/budget/i);
	});
});
