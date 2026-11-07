/**
 * Persisted wire suffix for a read-only turn. Keep these bytes compatible with
 * existing native history. Production and transcript decoding share this format.
 */
export const READ_ONLY_PROMPT_SUFFIX =
	'\n\n---\n\nIMPORTANT: You are in read-only/plan mode. Do NOT write a plan file. Instead, return your plan directly to the user in beautiful markdown formatting.';

/** Append once per outgoing turn, even when the user quoted the same text. */
export function appendReadOnlyPrompt(prompt: string): string {
	return prompt + READ_ONLY_PROMPT_SUFFIX;
}

/** Strip one complete trailing suffix only, preserving quotes and partial text. */
export function stripReadOnlyPrompt(prompt: string): string {
	return prompt.endsWith(READ_ONLY_PROMPT_SUFFIX)
		? prompt.slice(0, -READ_ONLY_PROMPT_SUFFIX.length)
		: prompt;
}
