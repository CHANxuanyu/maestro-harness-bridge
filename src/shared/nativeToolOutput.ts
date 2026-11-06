import { compactToolOutput } from './toolOutput';

/** Only this bounded result crosses IPC. Native content never enters session state. */
export type NativeToolOutputResult =
	| { status: 'found'; text: string; totalBytes: number; omittedBytes: number }
	| { status: 'not-found' | 'too-large' | 'unavailable' | 'unsupported' | 'busy' };

export interface NativeToolOutputTarget {
	provider: string;
	projectPath: string;
	nativeSessionId: string;
	ownerAgentId: string;
	sshRemoteId?: string;
	accountDir?: string;
	lookup?: NativeToolOutputLookup;
}

/** Codex exec item counters are not rollout call IDs. Match only unique evidence. */
export interface NativeToolOutputLookup {
	command: string;
	preview: string;
	timestamp: number;
}

/** Compare bounded previews, accounting for Codex's native result envelope. */
export function nativeToolOutputMatches(preview: string, output: string): boolean {
	const parts = (value: string) => {
		const header =
			value.match(
				/^(?:Chunk ID: [^\n]*\n)?Wall time: [^\n]*\n(?:Process exited with code [^\n]*\n|Exit code: [^\n]*\n)(?:Final output|Output):\n/
			)?.[0] ?? '';
		const body = value.slice(header.length);
		const note = body.match(/\n\.\.\. \[tool output truncated, (\d+) chars total\]$/);
		return {
			length: note ? Number(note[1]) - header.length : body.length,
			prefix: note ? body.slice(0, note.index) : body,
		};
	};
	const a = parts(preview);
	const b = parts(String(compactToolOutput(output).output));
	return (
		a.length === b.length &&
		Math.min(a.prefix.length, b.prefix.length) >= 1024 &&
		(a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix))
	);
}

/** The same shell wrapper normalization used by the activity label and native lookup. */
export function nativeToolCommand(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') return undefined;
	const value =
		(input as Record<string, unknown>).command ?? (input as Record<string, unknown>).cmd;
	const command =
		Array.isArray(value) && value.every((part) => typeof part === 'string')
			? value.join(' ')
			: value;
	if (typeof command !== 'string' || !command.trim()) return undefined;
	return command.trim().replace(/^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"]?)([\s\S]*)\1$/, '$2');
}
