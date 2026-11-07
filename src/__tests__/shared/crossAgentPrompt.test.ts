import { describe, expect, it } from 'vitest';
import { buildCrossAgentPrompt, stripCrossAgentPrompt } from '../../shared/crossAgentPrompt';
import type { CrossAgentRequest } from '../../shared/crossAgentTypes';

const request: CrossAgentRequest = {
	requestId: 'r',
	sourceSessionId: 'source',
	sourceTabId: 'tab',
	targetSessionId: 'target',
	userPrompt: '检查队列。然后检查停止。',
	transcript: [],
	strategy: { kind: 'full' },
	createdAt: 0,
};

describe('cross-agent wire compatibility', () => {
	it.each([false, true])('reads both old and framed envelopes, writable %s', (writable) => {
		for (const sourceCwd of [undefined, '~/remote/project']) {
			for (const handoffAnswer of [undefined, '', 'Result']) {
				for (const transcript of [[], [{ source: 'user', text: 'Context' }]]) {
					for (const sourceAgentName of [undefined, 'Source "quoted"']) {
						const prompt = buildCrossAgentPrompt(
							{ ...request, sourceCwd, handoffAnswer, transcript, sourceAgentName },
							writable
						);
						expect(stripCrossAgentPrompt(prompt)).toBe(request.userPrompt);
						const legacy = prompt.replace(/\n<!-- maestro-cross-agent:\d+:\d+ -->$/, '');
						expect(stripCrossAgentPrompt(legacy)).toBe(request.userPrompt);
					}
				}
			}
		}
	});

	it.each([undefined, 'Result'])(
		'preserves quoted delimiters in transcript and question, handoff %s',
		(handoffAnswer) => {
			const quoted = buildCrossAgentPrompt({ ...request, handoffAnswer });
			const userPrompt = `Explain this envelope:\n${quoted}\n\n**Result from the source agent:**\nkeep this too`;
			const prompt = buildCrossAgentPrompt({
				...request,
				userPrompt,
				handoffAnswer,
				transcript: [{ source: 'user', text: quoted }],
			});
			expect(stripCrossAgentPrompt(prompt)).toBe(userPrompt);
			expect(stripCrossAgentPrompt(userPrompt)).toBe(userPrompt);
		}
	);

	it('requires a complete handoff with instruction and result sections', () => {
		const prompt = buildCrossAgentPrompt({ ...request, handoffAnswer: 'Result' }).replace(
			/\n<!-- maestro-cross-agent:\d+:\d+ -->$/,
			''
		);
		for (const partial of [prompt.split('\n\n**The user')[0], prompt.split('\n\n**Result')[0]]) {
			expect(stripCrossAgentPrompt(partial)).toBe(partial);
		}
	});

	it('does not accept unknown headers, damaged grants or invalid length footers', () => {
		const prompt = buildCrossAgentPrompt({ ...request, sourceCwd: '/project' });
		for (const damaged of [
			prompt.replace('You are being', 'You were being'),
			prompt.replace('READ files', 'DELETE files'),
			prompt.replace(/:\d+ -->$/, ':99999999999999999999 -->'),
		]) {
			expect(stripCrossAgentPrompt(damaged)).toBe(damaged);
		}
	});

	it.each([undefined, 'Result'])(
		'preserves ambiguous legacy quoted boundaries, handoff %s',
		(handoffAnswer) => {
			const marker =
				handoffAnswer === undefined
					? '**Question from the user (relayed via the source agent):**'
					: '**Result from the source agent:**';
			const prompt = buildCrossAgentPrompt({
				...request,
				handoffAnswer,
				userPrompt: `Explain this marker:\n\n${marker}\nquoted text`,
				transcript: [{ source: 'user', text: `Earlier quote:\n\n${marker}\ncontext` }],
			}).replace(/\n<!-- maestro-cross-agent:\d+:\d+ -->$/, '');
			expect(stripCrossAgentPrompt(prompt)).toBe(prompt);
		}
	);

	it('pins the existing no-transcript body before the additive length footer', () => {
		expect(buildCrossAgentPrompt(request).split('\n<!-- maestro-cross-agent:')[0]).toBe(
			'You are being consulted by another agent in Maestro. There is no prior conversation to read - the question below is self-contained.\n\n**Question from the user (relayed via the source agent):**\n' +
				request.userPrompt
		);
	});
});
