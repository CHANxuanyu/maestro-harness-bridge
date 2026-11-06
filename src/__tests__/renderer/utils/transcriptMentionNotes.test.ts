import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { appendReadOnlyPrompt } from '../../../shared/readOnlyPrompt';
import {
	hasLegacyTranscriptEntries,
	transcriptMessagesToLogEntries,
} from '../../../renderer/utils/transcriptMessages';
import { withMentionTurnNotes } from '../../../renderer/services/crossAgentMentions';
import {
	buildConsultPendingNote,
	buildHandoffPendingNote,
	loadCrossAgentConsultPrompts,
} from '../../../renderer/services/crossAgentConsultHold';

const consultTemplate = readFileSync(
	new URL('../../../prompts/cross-agent-consult-pending.md', import.meta.url),
	'utf8'
);
const handoffTemplate = readFileSync(
	new URL('../../../prompts/cross-agent-handoff-pending.md', import.meta.url),
	'utf8'
);

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
				}
			} finally {
				vi.restoreAllMocks();
			}
		}
	);
});
