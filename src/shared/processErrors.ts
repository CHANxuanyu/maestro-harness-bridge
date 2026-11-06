/**
 * Error shapes the process layer throws that callers need to recognise by
 * message rather than by type. Kept in `shared/` so the thrower and the
 * matcher cannot drift: an IPC rejection arrives in the renderer as a plain
 * `Error` whose message has been re-wrapped by Electron, so the text really is
 * the only thing left to match on.
 */

/**
 * Prefix of the refusal `ProcessManager.spawn` throws when a session already
 * owns a live agent process. Build the message with
 * `agentAlreadyRunningMessage()` and test for it with
 * `isAgentAlreadyRunningError()` - never re-type the literal.
 */
export const AGENT_ALREADY_RUNNING_PREFIX = 'Agent process already running for session';

/** Stable refusal identifiers translated by the renderer after IPC wrapping. */
export const CLAUDE_STANDARD_PERMISSION_ERRORS = {
	remote: 'CLAUDE_STANDARD_REQUIRES_LOCAL_PRINT',
	tuiBinary: 'CLAUDE_STANDARD_REQUIRES_CLAUDE_BINARY',
	conflictingArgs: 'CLAUDE_STANDARD_CONFLICTING_ARGUMENTS',
} as const;

/** Match a standard approval refusal after Electron wraps the error. */
export function isClaudeStandardPermissionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return Object.values(CLAUDE_STANDARD_PERMISSION_ERRORS).some((code) => message.includes(code));
}

/** The exact message `ProcessManager.spawn` throws for an owned session. */
export function agentAlreadyRunningMessage(sessionId: string): string {
	return `${AGENT_ALREADY_RUNNING_PREFIX} ${sessionId}`;
}

/**
 * True when a failure is that refusal, including when it arrives wrapped by
 * Electron's IPC bridge as
 * `Error invoking remote method 'process:spawn': Error: Agent process ...`.
 */
export function isAgentAlreadyRunningError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return message.includes(AGENT_ALREADY_RUNNING_PREFIX);
}
