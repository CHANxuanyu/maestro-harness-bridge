import { stripReadOnlyPrompt } from './readOnlyPrompt';

// The length footer makes editable notes reversible even when their text quotes
// the delimiter. Length counts JavaScript code units on both sides.
const NOTE_START = '\n\n---\n\n<!-- maestro-internal-note -->\n';
const NOTE_END = /\n<!-- \/maestro-internal-note:([0-9]+) -->$/;

/** Attach a model-only note without losing the boundary of the user's text. */
export function appendTurnNote(prompt: string, note: string): string {
	return `${prompt}${NOTE_START}${note}\n<!-- /maestro-internal-note:${note.length} -->`;
}

// Frozen legacy wire templates. Do not follow edits to the configurable prompt
// files: native histories already contain these exact bytes without an envelope.
const LEGACY_NOTES = [
	{
		template:
			'[Maestro] This message also mentions {{CONSULTED_AGENTS}}. Maestro has already sent it to them and is consulting them now, in parallel with you.\n\n- Do not contact them yourself (no `maestro-cli ask` or `dispatch`) and do not conclude that they are unavailable. The consult is already running.\n- Do your own share of the work now: read, investigate, and gather what you need.\n- Do NOT write your final answer in this turn. End this turn with a short note of what you found so far.\n\nWhen the consult finishes, Maestro sends you the reply verbatim in the next message. Write your final answer then, combining your findings with theirs.\n',
		token: '{{CONSULTED_AGENTS}}',
	},
	{
		template:
			"[Maestro] The user asked for the result of this turn to go to {{HANDOFF_AGENTS}}. When this turn ends, Maestro forwards your final answer to them, together with the user's message.\n\n- Do not contact them yourself (no `maestro-cli ask`, `send`, or `dispatch`). The hand-off is automatic.\n- Do the work the user asked for first.\n- Write your final answer so it stands on its own: {{HANDOFF_AGENTS}} sees the user's message and that answer, not your tool calls or your earlier notes.\n",
		token: '{{HANDOFF_AGENTS}}',
	},
];

/** Decode one complete note; incomplete or unrecognized prose stays untouched. */
function stripTurnNote(prompt: string): string {
	const footer = NOTE_END.exec(prompt);
	if (footer) {
		const length = Number(footer[1]);
		const start = footer.index - length - NOTE_START.length;
		if (
			Number.isSafeInteger(length) &&
			start >= 0 &&
			prompt.slice(start, start + NOTE_START.length) === NOTE_START
		) {
			return prompt.slice(0, start);
		}
		return prompt;
	}
	const separator = '\n\n---\n\n';
	const start = prompt.lastIndexOf(separator);
	if (start < 0) return prompt;
	// A Windows checkout loads the prompt files with CRLF, and the wire keeps it.
	const note = prompt.slice(start + separator.length).replace(/\r\n/g, '\n');
	for (const { template, token } of LEGACY_NOTES) {
		const [prefix, following] = template.split(token);
		if (!note.startsWith(prefix)) continue;
		const end = note.indexOf(following, prefix.length);
		if (end <= prefix.length) continue;
		const names = note.slice(prefix.length, end);
		const expected = template.split(token).join(names);
		// Prompt loaders can retain the file's final newline or trim it.
		if (note === expected || note === expected.trimEnd()) return prompt.slice(0, start);
	}
	return prompt;
}

/** Decode the outgoing order: read-only suffix, consult note, handoff note. */
export function stripTurnPrompt(prompt: string): string {
	// The producer appends at most two notes, so decoding has the same bound.
	return stripReadOnlyPrompt(stripTurnNote(stripTurnNote(prompt)));
}
