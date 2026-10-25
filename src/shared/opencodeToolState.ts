// OpenCode 1.19.4, anomalyco/opencode@148842ef7cb1bc34192b3fff57d0f9721ab9c801:
// packages/schema/src/v1/session.ts (ToolState),
// packages/opencode/src/session/processor.ts (cleanup's interrupted marker).
export interface OpenCodeToolState {
	status?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	metadata?: Record<string, unknown>;
}

/** Both stdout and history expose the same native input, result and outcome. */
export function normalizeOpenCodeToolState(
	state?: OpenCodeToolState
): OpenCodeToolState | undefined {
	if (state?.status !== 'error') return state;
	return {
		...state,
		status: state.metadata?.interrupted === true ? 'canceled' : 'failed',
		output: state.error,
	};
}
