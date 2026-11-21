import type { FollowUpExternalStatus } from './followUp';

/** Owner-facing facts from an app-authored turn. The original prompt remains agent input. */
export interface ConversationAutomationMarker {
	kind: 'follow-up' | 'expiry' | 'fix' | 'diagnosis';
	reason?: string;
	late: boolean;
	observation?: FollowUpExternalStatus;
}

/** Also recognizes truncated native titles, which must never name a conversation. */
export function isConversationAutomationPrompt(text: string): boolean {
	return /^\s*\[delivery:(?:follow|expiry|fix):/.test(text);
}

/** Decode only the existing app envelope, including its nested budget id, without displaying it. */
export function readConversationAutomationPrompt(
	text: string
): ConversationAutomationMarker | undefined {
	if (!isConversationAutomationPrompt(text)) return;
	const expiry = /^\s*\[delivery:expiry:/.test(text);
	const fix = /^\s*\[delivery:fix:/.test(text);
	const follow = /^\[follow-up:(?:budget:\[[^\n]*?\]:[^\n]*?|[^\]\n]+)\] ([\s\S]*?)\nEvent: /m.exec(
		text
	);
	const marker: ConversationAutomationMarker = {
		kind: expiry
			? 'expiry'
			: fix
				? text.includes('\nDiagnose why')
					? 'diagnosis'
					: 'fix'
				: 'follow-up',
		...(!expiry && follow && { reason: follow[1] }),
		late: text.includes('\nLate follow-up:'),
	};
	const observation = /^Application observation: (.+)$/m.exec(text)?.[1];
	if (observation) {
		try {
			const value: unknown = JSON.parse(observation);
			if (
				value &&
				typeof value === 'object' &&
				'state' in value &&
				['waiting', 'running', 'completed', 'unavailable'].includes(String(value.state))
			) {
				// Keep only documented observation fields. Unknown payload fields never become UI.
				const status = value as Record<string, unknown>;
				marker.observation = {
					state: status.state as FollowUpExternalStatus['state'],
					observedAt: typeof status.observedAt === 'number' ? status.observedAt : 0,
					...(typeof status.exitCode === 'number' && { exitCode: status.exitCode }),
					...Object.fromEntries(
						['status', 'conclusion', 'failingJob', 'outputTail', 'error']
							.filter((key) => typeof status[key] === 'string')
							.map((key) => [key, status[key]])
					),
				};
			}
		} catch {
			// Older/truncated native records still show the app marker, never the envelope.
		}
	}
	return marker;
}
