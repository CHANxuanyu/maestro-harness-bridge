import { describe, expect, it } from 'vitest';
import {
	conversationDisplayTitle,
	fitConversationTitle,
} from '../../../renderer/utils/conversationTitle';
import { createMockAITab } from '../../helpers/mockTab';

const measure = (text: string) =>
	Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7), 0);

describe('new shell conversation titles', () => {
	it.each([
		['# Fix `draft` with **care** and *tests*', 'Fix draft with care and tests'],
		['## [修复草稿](https://example.invalid) __保存__', '修复草稿 保存'],
		['[Review][details] and ~~old~~ `code`', 'Review and old code'],
		['# broken `fence', 'broken fence'],
	])('strips formatting from %s without changing the classic title', (name, plain) => {
		const tab = createMockAITab({ name });
		expect(conversationDisplayTitle(tab, true)).toBe(plain);
		expect(conversationDisplayTitle(tab)).toBe(name);
		expect(tab.name).toBe(name);
	});
	it('keeps a long first-message tail in the one title source', () => {
		const text = '# ' + 'shared context '.repeat(20) + '`distinct tail`';
		const tab = createMockAITab({
			name: null,
			logs: [{ id: 'user', source: 'user', text, timestamp: 1 }],
		});
		expect(conversationDisplayTitle(tab, true)).toBe(
			'shared context '.repeat(20) + 'distinct tail'
		);
		expect(conversationDisplayTitle(tab)!.length).toBeLessThanOrEqual(80);
	});
	it.each(['tail', 'middle', 'Chinese'])('keeps eight %s differences visible at 264px', (kind) => {
		const titles = Array.from({ length: 8 }, (_, i) =>
			kind === 'Chinese'
				? '同一工作树里修复窗口关闭保存草稿的问题：第' + i + '种情况'
				: 'Fix the shared long conversation prefix ' +
					(kind === 'middle' ? i + ' and the shared long suffix' : 'case ' + i)
		);
		// 264px sidebar minus indent, padding, provider, marker, time and gaps.
		const width = 264 - 144;
		const labels = titles.map((title) => fitConversationTitle(title, titles, width, measure));
		expect(new Set(labels).size).toBe(8);
		for (const label of labels) expect(measure(label)).toBeLessThanOrEqual(width);
	});
	it('does not cut a title that fits, or split a supplementary character', () => {
		expect(fitConversationTitle('Fix draft', [], 120, measure)).toBe('Fix draft');
		const label = fitConversationTitle('🧪'.repeat(30) + ' tail', [], 120, measure);
		expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
	});
});
