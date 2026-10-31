import type { ContextSource } from '../types/contextMerge';
import { isProgressNoteEntry } from '../utils/transcriptMessages';
import { estimateTokenCount } from '../../shared/formatters';
import { scanMentionSpans } from '../../shared/mentionPatterns';
import {
	DEFAULT_HANDOFF_BUDGET,
	type HandoffDraft,
	type HandoffProvider,
} from '../../shared/aiHandoff';

/** A copied @reference is context, not a new dispatch to an agent or file. */
function literalMentions(text: string): string {
	let result = text;
	for (const span of scanMentionSpans(text).reverse())
		result = `${result.slice(0, span.start)}\`${span.value}\`${result.slice(span.end)}`;
	return result;
}

/** No model invocation: retain recent human/assistant bodies and one line per tool. */
export function buildHandoffDraft(
	source: ContextSource,
	options: { provider: HandoffProvider; budgetTokens?: number; instruction?: string }
): HandoffDraft {
	const budgetTokens = options.budgetTokens ?? DEFAULT_HANDOFF_BUDGET;
	if (!Number.isSafeInteger(budgetTokens) || budgetTokens <= 0)
		throw new RangeError('The handoff budget must be a positive integer');
	const header = literalMentions(
		`# Handoff\nSource: ${source.name}\nProvider: ${options.provider}\nProject: ${source.projectRoot}\nNative session: ${source.agentSessionId ?? '(new)'}\n`
	);
	const instruction = literalMentions(
		options.instruction ? `\nInstruction:\n${options.instruction}\n` : ''
	);
	const entries = source.logs.flatMap((entry) => {
		if (entry.source === 'tool') {
			const name = entry.text.replace(/\s+/g, ' ').trim();
			return name
				? [
						{
							label: 'Tool: ',
							body: `${name}${entry.metadata?.toolState?.status ? ` (${entry.metadata.toolState.status})` : ''}`,
						},
					]
				: [];
		}
		if (
			!['user', 'stdout', 'ai'].includes(entry.source) ||
			isProgressNoteEntry(entry) ||
			!entry.text.trim()
		)
			return [];
		return [{ label: `${entry.source === 'user' ? 'User' : 'Assistant'}:\n`, body: entry.text }];
	});
	const notice = (count: number, characters = 0) =>
		count || characters
			? `\n[Omitted ${count} earlier entries and ${characters} characters from the oldest included entry.]\n`
			: '';
	const render = (body: string[], count: number, characters = 0) =>
		`${header}${notice(count, characters)}\n${body.join('\n\n')}${instruction}`;
	const baseLength = header.length + instruction.length + 1;
	const maxLength = budgetTokens * 4; // Same estimate as the memory panel.
	if (baseLength > maxLength)
		throw new RangeError('The source details and instruction exceed the handoff budget');
	const formatted = entries.map((entry) => entry.label + literalMentions(entry.body));
	// Count lengths once. Repeatedly rendering and dropping the oldest entry
	// would do quadratic work on a long conversation with a small budget.
	let start = entries.length;
	let bodyLength = 0;
	while (start > 0) {
		const nextLength = bodyLength + formatted[start - 1].length + (start < entries.length ? 2 : 0);
		if (baseLength + notice(start - 1).length + nextLength > maxLength) break;
		bodyLength = nextLength;
		start--;
	}
	// A short complete conversation needs no omission notice. Removing that
	// notice can make the full body fit even when a partial candidate did not.
	if (
		baseLength +
			formatted.reduce((sum, entry) => sum + entry.length, 0) +
			Math.max(0, formatted.length - 1) * 2 <=
		maxLength
	)
		start = 0;
	let omittedEntries = start;
	let omittedCharacters = 0;
	let text = render(formatted.slice(start), omittedEntries);
	if (start === entries.length && entries.length) {
		omittedEntries = entries.length - 1;
		const last = entries[entries.length - 1];
		let body = last.body;
		text = render([last.label + literalMentions(body)], omittedEntries);
		// Keep the role and the recent body tail. Escape AFTER each cut so a
		// truncated @reference cannot turn into a live dispatch on Send.
		while (text.length > maxLength && body.length) {
			const remove = Math.min(body.length, Math.max(1, text.length - maxLength));
			omittedCharacters += remove;
			body = body.slice(remove);
			if (/^[\uDC00-\uDFFF]/.test(body)) {
				body = body.slice(1);
				omittedCharacters++;
			}
			text = render([last.label + literalMentions(body)], omittedEntries, omittedCharacters);
		}
	}
	if (text.length > maxLength) throw new RangeError('The handoff budget is too small');
	return {
		text,
		estimatedTokens: estimateTokenCount(text),
		budgetTokens,
		omittedEntries,
		omittedCharacters,
	};
}
