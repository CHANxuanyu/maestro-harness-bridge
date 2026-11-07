/**
 * Normalize a worktree path for equality checks across process and platform
 * boundaries. This does not resolve relative paths; callers that operate on a
 * local filesystem must resolve them against the same cwd used by Git first.
 */
export function normalizeWorktreePath(
	path: string,
	posix = false,
	caseInsensitiveWindows = false
): string {
	// SSH paths preserve literal backslashes. Local UNC paths retain their
	// semantic double separator; ordinary redundant separators collapse.
	const hasUncPrefix = !posix && /^[\\/]{2}[^\\/]/.test(path);
	// Windows drive letters share one spelling for local comparisons.
	const separated = posix
		? path
		: path.replace(/\\/g, '/').replace(/^[a-z]:/, (drive) => drive.toUpperCase());
	const collapsed = separated.replace(/\/+/g, '/');
	let normalized = hasUncPrefix ? `/${collapsed}` : collapsed;
	// Project identities opt into Windows filesystem case semantics. Existing
	// callers keep their comparison contract, and SSH always remains POSIX.
	if (!posix && caseInsensitiveWindows && (hasUncPrefix || /^[A-Za-z]:/.test(normalized)))
		normalized = normalized.toLowerCase();
	if (normalized === '/' || (!posix && /^[A-Za-z]:\/$/.test(normalized))) return normalized;
	return normalized.replace(/\/+$/, '');
}

/** Compare POSIX worktree prefixes without matching similarly named siblings. */
export function isPathAtOrUnderRoot(path: string, root: string): boolean {
	const candidate = normalizeWorktreePath(path, true);
	const base = normalizeWorktreePath(root, true);
	return candidate === base || candidate.startsWith(base === '/' ? '/' : `${base}/`);
}
