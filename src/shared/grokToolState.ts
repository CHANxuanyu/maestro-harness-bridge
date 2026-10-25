// grok-build 1.0.45, 2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8:
// pager/src/headless/reducer/acp.rs and shell/src/session/acp_conversion.rs.
// ACP content is defined by agent-client-protocol-schema 0.11.4 in Cargo.lock.
export function grokContentText(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined;
	const texts = content.flatMap((item) =>
		item?.type === 'content' &&
		item.content?.type === 'text' &&
		typeof item.content.text === 'string'
			? [item.content.text]
			: []
	);
	return texts.length ? texts.join('\n') : undefined;
}

export function grokNativeToolStatus(
	status: unknown,
	rawOutput?: unknown
): 'running' | 'completed' | 'failed' | 'unknown' {
	if (status === 'completed')
		return (grokBashExitCode(rawOutput) ?? 0) !== 0 ? 'failed' : 'completed';
	if (status === 'failed') return 'failed';
	if (status === 'pending' || status === 'in_progress') return 'running';
	return 'unknown';
}

// ToolOutput::Bash in tools/src/types/output.rs is internally tagged as Bash.
export function grokBashExitCode(rawOutput: unknown): number | undefined {
	if (!rawOutput || typeof rawOutput !== 'object') return undefined;
	const output = rawOutput as { type?: string; exit_code?: number };
	return output.type === 'Bash' && typeof output.exit_code === 'number'
		? output.exit_code
		: undefined;
}
