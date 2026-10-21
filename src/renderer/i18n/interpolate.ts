/**
 * Placeholder substitution for UI message templates.
 *
 * Templates name their parameters in braces: `"Delete {name}?"`. A placeholder
 * with no matching parameter is left in place verbatim, so a missing argument
 * shows up on screen (and in tests) instead of silently rendering as an empty
 * string. Values are inserted as plain text; nothing is ever parsed as markup.
 */

export type MessageParamValue = string | number;
export type MessageParams = Readonly<Record<string, MessageParamValue>>;

/** Matches `{name}` placeholders. Names are identifiers: letters, digits, `_`. */
export const PLACEHOLDER_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function interpolate(template: string, params?: MessageParams): string {
	if (!params) return template;
	return template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
		const value = params[name];
		return value === undefined ? match : String(value);
	});
}

/** The placeholder names a template uses, in order of first appearance. */
export function placeholderNames(template: string): string[] {
	const names: string[] = [];
	for (const m of template.matchAll(PLACEHOLDER_PATTERN)) {
		if (!names.includes(m[1])) names.push(m[1]);
	}
	return names;
}
