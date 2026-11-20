import type { AITab } from '../types';
import { stripMarkdown } from '../../shared/markdown';
import { isSessionIdLabel } from './tabHelpers';
import { isInternalDesktopEnvelope } from './transcriptMessages';
import { isConversationAutomationPrompt } from '../../shared/conversationAutomationPrompt';

/** Longest first-message excerpt used as a title before it is cut. */
const EXCERPT_LIMIT = 80;

/**
 * What a conversation is called in the Main Window header when the Left Bar
 * lists conversations: the name the tab carries (auto-named, renamed, or the
 * native title it was opened with), else the first line of the first thing the
 * user said. `null` means there is nothing to call it yet, and the caller shows
 * its "New conversation" label.
 *
 * Never the provider id label (`8535E0E3`): a recorded id fallback is not a
 * name (see `isSessionIdLabel`), and an id in a heading reads as an error.
 */
export function conversationDisplayTitle(
	tab: Pick<AITab, 'name' | 'agentSessionId' | 'logs'> | null | undefined,
	plainText = false
): string | null {
	if (!tab) return null;
	const name = tab.name?.trim();
	if (
		name &&
		!isSessionIdLabel(name, tab.agentSessionId) &&
		!isConversationAutomationPrompt(name)
	) {
		const title = plainText ? plainConversationTitle(name) : name;
		if (title) return title;
	}
	const firstUser = (tab.logs ?? []).find(
		(entry) =>
			entry.source === 'user' &&
			!!entry.text?.trim() &&
			!isInternalDesktopEnvelope(entry.text) &&
			!entry.automationTurn &&
			!isConversationAutomationPrompt(entry.text)
	);
	const line = firstUser?.text.trim().split('\n')[0]?.trim();
	if (!line) return null;
	// Keep the distinguishing tail; row layout, not the title source, cuts it.
	if (plainText) return plainConversationTitle(line) || null;
	return line.length > EXCERPT_LIMIT ? `${line.slice(0, EXCERPT_LIMIT - 1).trimEnd()}…` : line;
}

/** Plain display text only; never rewrite the stored/native conversation name. */
function plainConversationTitle(value: string): string {
	return stripMarkdown(value)
		.replace(/!?\[([^\]]+)\](?:\[[^\]]*\])/g, '$1')
		.replace(/[#`*]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Fit a title using the actual label width and font. Prefer both ends. If that
 * hides the only difference from a peer, show the end of its unique prefix.
 * The full canonical title stays on the row's tooltip and in the header.
 */
export function fitConversationTitle(
	title: string,
	peers: readonly string[],
	width: number,
	measure: (text: string) => number
): string {
	if (width <= 0 || measure(title) <= width) return title;
	const chars = Array.from(title);
	const middle = (text: string): string => {
		const points = Array.from(text);
		let low = 0;
		let high = points.length - 1;
		while (low < high) {
			const count = Math.ceil((low + high) / 2);
			const head = Math.ceil(count / 2);
			const tail = count - head;
			const candidate =
				points.slice(0, head).join('') + '…' + (tail ? points.slice(-tail).join('') : '');
			if (measure(candidate) <= width) low = count;
			else high = count - 1;
		}
		const head = Math.ceil(low / 2);
		const tail = low - head;
		return points.slice(0, head).join('') + '…' + (tail ? points.slice(-tail).join('') : '');
	};
	const label = middle(title);
	const others = peers.filter((peer) => peer !== title);
	if (!others.some((peer) => middle(peer) === label)) return label;

	// The first character after the longest shared prefix distinguishes this
	// title even when all eight conversations share a long prefix AND suffix.
	let end = 1;
	for (const peer of others) {
		const points = Array.from(peer);
		let shared = 0;
		while (shared < chars.length && chars[shared] === points[shared]) shared++;
		end = Math.max(end, Math.min(chars.length, shared + 1));
	}
	const suffix = end < chars.length ? '…' : '';
	let start = end - 1;
	while (start > 0) {
		const candidate = (start > 1 ? '…' : '') + chars.slice(start - 1, end).join('') + suffix;
		if (measure(candidate) > width) break;
		start--;
	}
	return (start ? '…' : '') + chars.slice(start, end).join('') + suffix;
}
