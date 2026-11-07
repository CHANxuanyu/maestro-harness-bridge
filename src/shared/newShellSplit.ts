/** References existing conversations, including ones owned by different providers. */
export interface SplitConversationRef {
	sessionId: string;
	tabId: string;
}

export interface NewShellSplit {
	left: SplitConversationRef;
	right: SplitConversationRef;
	ratio: number;
}

export const NEW_SHELL_SPLIT_MIN_WIDTH = 1180;
export const NEW_SHELL_SPLIT_MIN_CONTENT_WIDTH = 720;

/** Settings can come from an older install or an edited file. */
export function readNewShellSplit(value: unknown): NewShellSplit | null {
	if (!value || typeof value !== 'object') return null;
	const { left, right, ratio } = value as NewShellSplit;
	if (
		!left ||
		!right ||
		typeof left.sessionId !== 'string' ||
		!left.sessionId ||
		typeof right.sessionId !== 'string' ||
		!right.sessionId ||
		typeof left.tabId !== 'string' ||
		!left.tabId ||
		typeof right.tabId !== 'string' ||
		!right.tabId ||
		left.tabId === right.tabId ||
		!Number.isFinite(ratio) ||
		ratio < 0.2 ||
		ratio > 0.8
	)
		return null;
	return { left, right, ratio };
}
