/**
 * The error a session read or search rejects with when the agent's selected
 * account dir (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, ...) no longer exists.
 *
 * The session browser has to tell this apart from "no matching sessions": an
 * empty result would read as the account having no history, when in fact the
 * account cannot be read at all, and nothing may fall back to the default
 * account in its place. Electron passes only the message of an IPC rejection,
 * and wraps it ("Error invoking remote method ..."), so the marker is matched
 * as a substring. Import-free so main and the renderer share it.
 */

export const ACCOUNT_UNAVAILABLE_MARKER = 'MAESTRO_ACCOUNT_UNAVAILABLE';

export function accountUnavailableError(): Error {
	return new Error(`${ACCOUNT_UNAVAILABLE_MARKER}: the selected account directory is missing`);
}

export function isAccountUnavailableError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	return message.includes(ACCOUNT_UNAVAILABLE_MARKER);
}
