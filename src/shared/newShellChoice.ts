/** Persist the preference beside the boolean in the same settings write. */
export function newShellChoicePatch(value: unknown): {
	newShell: boolean;
	newShellChoice: 'new' | 'classic';
} {
	if (typeof value !== 'boolean') throw new Error('newShell must be a boolean');
	return { newShell: value, newShellChoice: value ? 'new' : 'classic' };
}

/** Conf materialized the old false default, so unmarked values carry no intent. */
export function migrateNewShellChoice(settings: Record<string, unknown>): {
	newShell: true;
	newShellChoice: 'auto';
} | null {
	if (['auto', 'new', 'classic'].includes(String(settings.newShellChoice))) return null;
	return { newShell: true, newShellChoice: 'auto' };
}
