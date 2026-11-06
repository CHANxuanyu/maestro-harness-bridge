import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { appendReadOnlyPrompt } from '../../../shared/readOnlyPrompt';
import {
	bindDelayedOwnSends,
	hasLegacyTranscriptEntries,
	mergeNewerEntries,
	reconcileTranscriptEntries,
	transcriptMessagesToLogEntries,
} from '../../../renderer/utils/transcriptMessages';
import { withMentionTurnNotes } from '../../../renderer/services/crossAgentMentions';
import {
	buildConsultPendingNote,
	buildHandoffPendingNote,
	loadCrossAgentConsultPrompts,
} from '../../../renderer/services/crossAgentConsultHold';

const consultTemplate = readFileSync('src/prompts/cross-agent-consult-pending.md', 'utf8');
const handoffTemplate = readFileSync('src/prompts/cross-agent-handoff-pending.md', 'utf8');

describe('read-only turns with mention notes', () => {
	it.each(['parallel', 'handoff', 'both'] as const)(
		'decodes current and already persisted %s notes after the read-only suffix',
		async (routing) => {
			const prompt = 'Check this with @Reviewer in parallel.';
			const target = { targetSessionId: 'reviewer', targetAgentName: 'Reviewer' };
			const consult = routing !== 'handoff';
			const handoff = routing !== 'parallel';
			vi.spyOn(window.maestro.prompts, 'get').mockImplementation(async (id) => ({
				success: true,
				content: id === 'cross-agent-consult-pending' ? consultTemplate : handoffTemplate,
			}));
			try {
				await loadCrossAgentConsultPrompts(true);
				const current = withMentionTurnNotes(appendReadOnlyPrompt(prompt), {
					consultTargets: consult ? [target] : [],
					handoffTargets: handoff ? [target] : [],
				});
				// Exact old append order, before notes had a decodable envelope.
				const legacy =
					appendReadOnlyPrompt(prompt) +
					(consult ? '\n\n---\n\n' + buildConsultPendingNote(consultTemplate, ['Reviewer']) : '') +
					(handoff ? '\n\n---\n\n' + buildHandoffPendingNote(handoffTemplate, ['Reviewer']) : '');
				for (const content of [legacy, current]) {
					const message = {
						uuid: 'mentioned-user',
						type: 'user',
						timestamp: '2026-11-06T12:00:00Z',
						content,
					};
					const [entry] = transcriptMessagesToLogEntries([message]);
					expect(entry.text).toBe(prompt);
					expect(message.content).toBe(content);
					expect(hasLegacyTranscriptEntries([{ ...entry, text: content }])).toBe(true);
					expect(hasLegacyTranscriptEntries([entry])).toBe(false);
					const own = {
						id: 'local-user',
						source: 'user' as const,
						text: prompt,
						timestamp: entry.timestamp - 200,
					};
					const upgraded = reconcileTranscriptEntries([entry], [own, { ...entry, text: content }]);
					const bound = bindDelayedOwnSends([entry], upgraded.logs);
					expect(mergeNewerEntries([entry], bound.logs)?.logs).toEqual([
						{ ...own, nativeTranscript: { messageId: entry.id } },
					]);
				}
			} finally {
				vi.restoreAllMocks();
			}
		}
	);

	it('decodes editable notes through the actual dispatch formatter', async () => {
		const prompt = 'Keep my exact words.\n';
		vi.spyOn(window.maestro.prompts, 'get').mockResolvedValue({
			success: true,
			content:
				'自定义协作提示：请与 {{CONSULTED_AGENTS}} 核对。\n<!-- /maestro-internal-note:123 -->',
		});
		try {
			await loadCrossAgentConsultPrompts(true);
			const content = withMentionTurnNotes(appendReadOnlyPrompt(prompt), {
				consultTargets: [{ targetSessionId: 'reviewer', targetAgentName: '复核对话' }],
				handoffTargets: [],
			});
			expect(content).toContain('请与 复核对话 核对');
			expect(
				transcriptMessagesToLogEntries([
					{ uuid: 'custom-user', type: 'user', timestamp: '2026-11-06T12:00:00Z', content },
				])[0].text
			).toBe(prompt);
		} finally {
			vi.restoreAllMocks();
		}
	});
});
