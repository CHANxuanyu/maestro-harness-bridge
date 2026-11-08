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
	tuiMode: 'CLAUDE_STANDARD_UNAVAILABLE_WITH_TUI',
	remote: 'CLAUDE_STANDARD_REQUIRES_LOCAL_PRINT',
	tuiBinary: 'CLAUDE_STANDARD_REQUIRES_CLAUDE_BINARY',
	conflictingArgs: 'CLAUDE_STANDARD_CONFLICTING_ARGUMENTS',
} as const;

/** Shared catalogs keep main, CLI and renderer refusals identical. */
export const CLAUDE_STANDARD_PERMISSION_MESSAGES = {
	en: {
		'workflows.sessions.standardSpawnRefused':
			'This conversation uses TUI Wrapper or Dynamic, so Standard cannot take effect. Choose Read-only or Full Access, or switch to claude -p.',
		'workflows.sessions.standardPrintNotice':
			'Unavailable with TUI Wrapper or Dynamic: maestro-p skips confirmations. Approving each step needs claude -p.',
		'workflows.sessions.standardTransportRefused':
			'Standard is unavailable over SSH or with custom permission overrides. Choose Read-only or Full Access, or use local claude -p without permission overrides.',
	},
	'zh-CN': {
		'workflows.sessions.standardSpawnRefused':
			'这条对话使用 TUI 包装器或动态切换，标准权限无法生效。请改用只读或完全访问，或改用 claude -p。',
		'workflows.sessions.standardPrintNotice':
			'TUI 包装器和动态切换模式下不可用：maestro-p 会跳过确认。要逐次批准，需要改用 claude -p。',
		'workflows.sessions.standardTransportRefused':
			'SSH 或自定义权限参数下无法使用标准权限。请选择只读或完全访问，或使用本机 claude -p 并移除自定义权限参数。',
	},
} as const;

/** Match stable core codes and localized IPC errors without importing renderer code. */
export function claudeStandardPermissionMessageKey(
	error: unknown
):
	| 'workflows.sessions.standardSpawnRefused'
	| 'workflows.sessions.standardTransportRefused'
	| undefined {
	const message = error instanceof Error ? error.message : String(error ?? '');
	for (const key of [
		'workflows.sessions.standardSpawnRefused',
		'workflows.sessions.standardTransportRefused',
	] as const) {
		if (
			Object.values(CLAUDE_STANDARD_PERMISSION_MESSAGES).some((catalog) =>
				message.includes(catalog[key])
			)
		)
			return key;
	}
	if (
		[CLAUDE_STANDARD_PERMISSION_ERRORS.tuiMode, CLAUDE_STANDARD_PERMISSION_ERRORS.tuiBinary].some(
			(code) => message.includes(code)
		)
	)
		return 'workflows.sessions.standardSpawnRefused';
	if (
		[
			CLAUDE_STANDARD_PERMISSION_ERRORS.remote,
			CLAUDE_STANDARD_PERMISSION_ERRORS.conflictingArgs,
		].some((code) => message.includes(code))
	)
		return 'workflows.sessions.standardTransportRefused';
	return undefined;
}

export function isClaudeStandardPermissionError(error: unknown): boolean {
	return claudeStandardPermissionMessageKey(error) !== undefined;
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
