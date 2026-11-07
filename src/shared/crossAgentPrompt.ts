import type { CrossAgentRequest, CrossAgentTranscriptEntry } from './crossAgentTypes';
import { escapeRegExp } from './stringUtils';

// Code-unit offsets make quoted markers reversible without altering legacy prose.
const CROSS_AGENT_FOOTER_PREFIX = '\n<!-- maestro-cross-agent:';
const CROSS_AGENT_FOOTER = new RegExp(
	escapeRegExp(CROSS_AGENT_FOOTER_PREFIX) + '([0-9]+):([0-9]+) -->$'
);

// These templates are a persisted wire format. Keep legacy text readable.
/** Header prepended to a consult that forwards the source agent's transcript. */
const CONSULT_HEADER =
	'You are being consulted by another agent in Maestro. Below is the conversation transcript so far, followed by a question.';

/**
 * Header for a consult with no transcript behind it - `maestro-cli ask`, whose
 * whole point is a FRESH context: the calling agent writes a self-contained
 * question rather than relaying a conversation. Announcing a transcript that
 * isn't there sends the target hunting for context it will never find.
 */
const CONSULT_HEADER_NO_TRANSCRIPT =
	'You are being consulted by another agent in Maestro. There is no prior conversation to read - the question below is self-contained.';

/**
 * Access grant appended to the header when the source agent forwards its working
 * directory. The consult runs in the TARGET agent's own cwd, so this is the only
 * pointer it has to the user's project.
 *
 * Consults only; a hand-off uses `handoffGrant`. Two modes, gated by the
 * `crossAgentMentionsWritable` setting (default off).
 * The user-facing names for them are CONSULT and DELEGATION, so the grant text
 * uses those words rather than only "read-only" / "read/write":
 * - Consult (read-only, default): grant read but not write. This is advisory text
 *   ONLY; the real enforcement is `readOnlyMode: true` on the router spawn
 *   (`--permission-mode plan` for Claude Code, `--sandbox read-only` for Codex,
 *   ...). Both must stay in agreement: consults used to spawn read-write while
 *   saying this, and targets took the write path anyway. We also tell the target
 *   how the user can lift the restriction, so a "make this change" request gets a
 *   useful answer instead of a silent no-op.
 * - Delegation (read/write): the user opted in, so we drop the write prohibition
 *   and let the target edit files (spawns with `readOnlyMode: false`).
 */
function cwdGrant(sourceCwd: string, writable: boolean): string {
	if (writable) {
		return (
			`The user is working in the directory \`${sourceCwd}\`. ` +
			'You have permission to READ and MODIFY files under that directory to answer. ' +
			'The user has enabled read/write cross-agent mentions, so this is a DELEGATION rather ' +
			'than a consult: you may apply changes directly.'
		);
	}
	return (
		`The user is working in the directory \`${sourceCwd}\`. ` +
		'You have permission to READ files under that directory to inform your answer. ' +
		'Do NOT modify or create files: this is a one-shot READ-ONLY consultation, so if changes ' +
		'are needed, describe them in your reply and let the user apply them. If the user is asking ' +
		'you to make changes directly, tell them cross-agent mentions are consults (read-only) by ' +
		'default and they can turn them into delegations in Settings > General > Cross-Agent ' +
		'Mentions (set Consult or Delegate to Read/Write).'
	);
}

/**
 * Access grant for a HAND-OFF. Not `cwdGrant`: that text calls the request a
 * consultation and points at the SOURCE directory as the place to change, while
 * a hand-off asks the target to act on a result in its OWN workspace (where it
 * runs). Gated by `crossAgentHandoffsWritable` (default on), separately from
 * consults, because passing work on is the point of a hand-off. Same contract as
 * `cwdGrant`: the text must agree with `permissionMode` on the router spawn.
 */
function handoffGrant(sourceCwd: string | undefined, writable: boolean): string {
	const source = sourceCwd
		? `The source agent worked in \`${sourceCwd}\`; you may READ files there for context. `
		: '';
	if (writable) {
		return (
			source +
			'You may READ and MODIFY files in your own workspace to act on the result: save what ' +
			"you learn, update notes, apply changes. Do not modify the source agent's files."
		);
	}
	return (
		source +
		'This hand-off is READ-ONLY: do not modify or create files. Describe what you would ' +
		'change, and tell the user hand-offs can write when Settings > General > Cross-Agent ' +
		'Mentions > Hand-offs is set to Read/Write.'
	);
}

/** Prefix for the relayed user question, appended after the transcript. */
const QUESTION_PREFIX = '**Question from the user (relayed via the source agent):**';

/**
 * Header for a HAND-OFF: the source agent already did the work, and the user
 * asked for its result to come to this agent. Saying so up front matters - the
 * consult header reads as "answer this question", and a target that thinks it
 * is being asked will redo the work instead of acting on the result.
 */
function handoffHeader(sourceAgentName: string | undefined, hasTranscript: boolean): string {
	const source = sourceAgentName ? `the agent "${sourceAgentName}"` : 'another agent';
	const context = hasTranscript
		? "Below is the conversation that led up to it, then the user's instruction, then the result."
		: "Below is the user's instruction, then the result.";
	return (
		`You are receiving a hand-off in Maestro. The user asked ${source} to do some work and ` +
		`forward the result to you. ${context} Act on the result as the instruction asks; do not ` +
		'redo the work it describes.'
	);
}

/** Prefixes for the two halves of a hand-off. */
const HANDOFF_INSTRUCTION_PREFIX = "**The user's instruction (relayed via the source agent):**";
const handoffResultPrefix = (sourceAgentName: string | undefined) =>
	`**Result from ${sourceAgentName ? sourceAgentName : 'the source agent'}:**`;

/** Human-readable role label for a transcript entry's source. */
function roleLabel(source: string): string {
	switch (source) {
		case 'user':
			return '**User:**';
		case 'ai':
			return '**Assistant:**';
		case 'system':
			return '**System:**';
		default:
			// tool / thinking / stdout / stderr / error - only surfaced when they
			// carry visible text (see serializeTranscript), labelled generically.
			return '**Note:**';
	}
}

/**
 * Serialize a windowed transcript into a single human-readable block.
 * Entries with no visible text are dropped; tool/thinking entries only survive
 * if they carry visible text.
 */
export function serializeTranscript(transcript: CrossAgentTranscriptEntry[]): string {
	const parts: string[] = [];
	for (const entry of transcript) {
		const text = entry.text?.trim();
		if (!text) continue;
		parts.push(`${roleLabel(entry.source)} ${text}`);
	}
	return parts.join('\n');
}

/**
 * Build the full outgoing prompt: header + serialized transcript + the relayed
 * user question. Exported for unit testing.
 */
export function buildCrossAgentPrompt(request: CrossAgentRequest, writable = false): string {
	const transcriptBlock = serializeTranscript(request.transcript);
	if (request.handoffAnswer !== undefined) {
		const intro = handoffHeader(request.sourceAgentName, !!transcriptBlock);
		const header = `${intro}\n\n${handoffGrant(request.sourceCwd, writable)}`;
		const sections = [
			header,
			...(transcriptBlock ? [transcriptBlock] : []),
			`${HANDOFF_INSTRUCTION_PREFIX}\n${request.userPrompt}`,
			`${handoffResultPrefix(request.sourceAgentName)}\n${request.handoffAnswer}`,
		];
		const prompt = sections.join('\n\n');
		const start =
			header.length +
			(transcriptBlock ? transcriptBlock.length + 2 : 0) +
			2 +
			HANDOFF_INSTRUCTION_PREFIX.length +
			1;
		return `${prompt}${CROSS_AGENT_FOOTER_PREFIX}${start}:${request.userPrompt.length} -->`;
	}
	const intro = transcriptBlock ? CONSULT_HEADER : CONSULT_HEADER_NO_TRANSCRIPT;
	const header = request.sourceCwd ? `${intro}\n\n${cwdGrant(request.sourceCwd, writable)}` : intro;
	const sections = [header];
	if (transcriptBlock) {
		sections.push(transcriptBlock);
	}
	sections.push(`${QUESTION_PREFIX}\n${request.userPrompt}`);
	const prompt = sections.join('\n\n');
	return `${prompt}${CROSS_AGENT_FOOTER_PREFIX}${prompt.length - request.userPrompt.length}:${request.userPrompt.length} -->`;
}

// Match the complete producer prefix, including its access grant and whether it
// promised a transcript. A heading or an excerpt alone is never an envelope.
const WIRE_VALUE = '\u0000';
const ENVELOPE_PREFIXES = [false, true].flatMap((hasTranscript) => {
	const transcript = hasTranscript
		? '\\*\\*(?:User|Assistant|System|Note):\\*\\* [\\s\\S]*?\\n\\n'
		: '';
	const consultGrant = [false, true]
		.map((writable) =>
			escapeRegExp(cwdGrant(WIRE_VALUE, writable)).replace(WIRE_VALUE, '[\\s\\S]*?')
		)
		.join('|');
	const handoffGrantPattern = [undefined, WIRE_VALUE]
		.flatMap((cwd) =>
			[false, true].map((writable) =>
				escapeRegExp(handoffGrant(cwd, writable)).replace(WIRE_VALUE, '[\\s\\S]*?')
			)
		)
		.join('|');
	return [
		{
			handoff: false,
			pattern:
				escapeRegExp(hasTranscript ? CONSULT_HEADER : CONSULT_HEADER_NO_TRANSCRIPT) +
				'\\n\\n(?:(?:' +
				consultGrant +
				')\\n\\n)?' +
				transcript +
				escapeRegExp(QUESTION_PREFIX) +
				'\\n',
		},
		...[undefined, WIRE_VALUE].map((name) => ({
			handoff: true,
			pattern:
				escapeRegExp(handoffHeader(name, hasTranscript)).replace(WIRE_VALUE, '([\\s\\S]*?)') +
				'\\n\\n(?:' +
				handoffGrantPattern +
				')\\n\\n' +
				transcript +
				escapeRegExp(HANDOFF_INSTRUCTION_PREFIX) +
				'\\n',
		})),
	].map(({ handoff, pattern }) => ({
		handoff,
		hasTranscript,
		legacy: new RegExp('^' + pattern),
		framed: new RegExp('^' + pattern + '$'),
	}));
});

/** Recover one complete consult or handoff envelope, preserving quoted prose. */
export function stripCrossAgentPrompt(text: string): string {
	const footer = CROSS_AGENT_FOOTER.exec(text);
	const start = footer ? Number(footer[1]) : 0;
	const length = footer ? Number(footer[2]) : 0;
	if (
		footer &&
		(!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start + length > footer.index)
	)
		return text;
	for (const variant of ENVELOPE_PREFIXES) {
		const match = footer ? variant.framed.exec(text.slice(0, start)) : variant.legacy.exec(text);
		if (!match) continue;
		const questionStart = match[0].length;
		const resultMarker = '\n\n' + handoffResultPrefix(match[1]) + '\n';
		if (footer) {
			const end = start + length;
			if (
				variant.handoff
					? !text.slice(end, footer.index).startsWith(resultMarker)
					: end !== footer.index
			)
				return text;
			return text.slice(questionStart, end);
		}
		// Legacy bodies did not escape delimiters. Preserve ambiguous records
		// rather than deleting part of a quoted question or result.
		if (!variant.handoff) {
			if (
				variant.hasTranscript &&
				text.indexOf('\n\n' + QUESTION_PREFIX + '\n', questionStart) >= 0
			)
				return text;
			return text.slice(questionStart);
		}
		const resultStart = text.indexOf(resultMarker, questionStart);
		if (resultStart >= 0) {
			if (text.indexOf(resultMarker, resultStart + resultMarker.length) >= 0) return text;
			return text.slice(questionStart, resultStart);
		}
	}
	return text;
}
