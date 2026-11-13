/**
 * Main-process writes to an agent that a window owns.
 *
 * A project tool configuration saved from the CLI or the Project settings dialog
 * is written to the sessions store by main, and only then announced to the
 * windows. A flush the owning window already had in flight still carries the
 * values from before the change, and because `sessions:setMany` / `setAll`
 * replace whole agents, that flush would put the old values back on disk. A read
 * in between (the CLI's `show agent`) then reports the old configuration.
 *
 * Comparing values cannot tell a stale copy from a deliberate change back to the
 * old value, so every such write bumps the agent's `configRevision`. The patch the
 * window receives carries the new revision, so once the window has applied it,
 * every later copy it writes carries that revision too. An incoming copy with an
 * older revision is stale: the fields main patched are taken from disk instead.
 * A copy with the current revision is the window's own and wins, including a
 * deliberate return to an earlier value.
 */

export const CONFIG_REVISION_KEY = 'configRevision';

interface PendingEntry {
	revision: number;
	/** Field names main patched since a window last showed this revision. */
	fields: Set<string>;
}

export interface PendingSessionPatches {
	/** The revision to stamp on a new main-process patch of this agent. */
	nextRevision(stored: Record<string, unknown> | undefined): number;
	/** Record a patch BEFORE it is written: its revision and the fields it sets. */
	note(sessionId: string, revision: number, fields: Iterable<string>): void;
	/** Forget a patch that was rolled back. */
	forget(sessionIds: Iterable<string>): void;
	/** Take main's patched fields from `stored` when `incoming` is an older copy. */
	apply<T extends { id: string }>(incoming: T, stored: Record<string, unknown> | undefined): T;
}

function revisionOf(session: Record<string, unknown> | undefined): number {
	const value = session?.[CONFIG_REVISION_KEY];
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function createPendingSessionPatches(limit = 500): PendingSessionPatches {
	const pending = new Map<string, PendingEntry>();
	return {
		nextRevision(stored) {
			return revisionOf(stored) + 1;
		},
		note(sessionId, revision, fields) {
			const entry = pending.get(sessionId) ?? { revision, fields: new Set<string>() };
			entry.revision = revision;
			for (const field of fields) entry.fields.add(field);
			pending.delete(sessionId);
			pending.set(sessionId, entry);
			// Bounded: an agent no window writes again keeps an entry, and a process
			// runs for days. The oldest guard is the least likely to matter.
			while (pending.size > limit) pending.delete(pending.keys().next().value as string);
		},
		forget(sessionIds) {
			for (const id of sessionIds) pending.delete(id);
		},
		apply(incoming, stored) {
			const entry = pending.get(incoming.id);
			if (!entry) return incoming;
			if (revisionOf(incoming as Record<string, unknown>) >= entry.revision) {
				// The window has applied the patch; from here on its copy is the authority.
				pending.delete(incoming.id);
				return incoming;
			}
			if (!stored) return incoming;
			const restored: Record<string, unknown> = { [CONFIG_REVISION_KEY]: entry.revision };
			for (const field of entry.fields) restored[field] = stored[field];
			return { ...incoming, ...restored };
		},
	};
}
