// oh-my-pi v18.12.6 @45c35e40c46166dc726ccc52f5d27f40f2449f99,
// packages/agent/src/agent-loop.ts: SyntheticToolResultDetails and
// InterruptedToolResultDetails. Error prose alone does not prove cancellation.
export function ompToolStatus(
	result: unknown,
	isError: boolean | undefined
): 'completed' | 'failed' | 'canceled' {
	if (!isError) return 'completed';
	const details = (result as { details?: Record<string, unknown> } | undefined)?.details;
	if (
		(details?.__synthetic === true &&
			details.executed === false &&
			(details.source === 'assistant_stop_aborted' || details.source === 'interrupt_skipped')) ||
		(details?.__interrupted === true &&
			details.execution === 'started' &&
			details.source === 'interrupt_skipped')
	)
		return 'canceled';
	return 'failed';
}
