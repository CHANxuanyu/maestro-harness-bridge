import type { AITab } from '../types';
import { isSessionIdLabel } from './tabHelpers';
import { isInternalDesktopEnvelope } from './transcriptMessages';

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
export function conversationDisplayTitle(tab: AITab | null | undefined): string | null {
	if (!tab) return null;
	const name = tab.name?.trim();
	if (name && !isSessionIdLabel(name, tab.agentSessionId)) return name;
	const firstUser = (tab.logs ?? []).find(
		(entry) =>
			entry.source === 'user' && !!entry.text?.trim() && !isInternalDesktopEnvelope(entry.text)
	);
	const line = firstUser?.text.trim().split('\n')[0]?.trim();
	if (!line) return null;
	return line.length > EXCERPT_LIMIT ? `${line.slice(0, EXCERPT_LIMIT - 1).trimEnd()}…` : line;
}
