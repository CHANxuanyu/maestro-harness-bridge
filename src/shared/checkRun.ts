export type CheckOutcome = 'pass' | 'fail' | 'timeout' | 'canceled' | 'not-run';

export type CheckHost = { kind: 'local' } | { kind: 'ssh'; remoteId: string };

/** Application-observed evidence, never a provider's claim about a check. */
export interface CheckRun {
	id: string;
	command: string;
	cwd: string;
	host: CheckHost;
	startedAt: number;
	endedAt: number;
	exitCode: number | null;
	expectedExitCode?: number;
	outcome: CheckOutcome;
	outputTail: string;
	truncated: boolean;
	error?: string;
	testsRun?: number;
	testsSkipped?: number;
}

/** Parse runner summaries only. An unrecognized command reports unknown, never zero tests. */
export function checkTestCounts(output: string): { testsRun?: number; testsSkipped?: number } {
	const tapTotal = output.match(/^# tests (\d+)\s*$/m);
	const tapSkip = output.match(/^# (?:skipped|skip) (\d+)\s*$/m);
	if (tapTotal)
		return {
			testsRun: Number(tapTotal[1]) - Number(tapSkip?.[1] ?? 0),
			testsSkipped: Number(tapSkip?.[1] ?? 0),
		};
	const summary = output
		.split('\n')
		.reverse()
		.find((line) => /^\s*Tests:?\s+/.test(line) || /^=+.*\d+ (?:passed|failed)/.test(line));
	if (!summary) return {};
	const count = (label: string) => Number(summary.match(new RegExp(`(\\d+) ${label}`))?.[1] ?? 0);
	if (!/\d+ (passed|failed|skipped)/.test(summary)) return {};
	return {
		testsRun: count('passed') + count('failed'),
		testsSkipped: count('skipped') + count('todo'),
	};
}

export type CheckBoundary = 'outside-workspace' | 'external-write';

/** Explicit boundary declarations plus recognizable shell actions. This is not a shell sandbox. */
export function checkCommandBoundary(
	command: string,
	declared?: CheckBoundary
): CheckBoundary | undefined {
	if (declared) return declared;
	if (
		/\b(?:git\s+push|gh\s+(?:pr|release|issue)\s+(?:create|merge|edit)|npm\s+publish|curl\s+[^\n]*(?:--data|-d\b|--upload-file|-T\b|-X\s*(?:POST|PUT|PATCH|DELETE)))\b/i.test(
			command
		)
	)
		return 'external-write';
	if (
		/(?:^|[\s'"=<>])(?:\.\.[/\\]|~[/\\]|\$\{?HOME\}?|[A-Za-z]:[/\\]|\/(?!dev\/null(?:\s|$))[^\s])/m.test(
			command
		)
	)
		return 'outside-workspace';
}
