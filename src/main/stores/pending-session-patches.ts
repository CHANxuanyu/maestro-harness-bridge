/**
 * Main-process writes to an agent that a window owns.
 *
 * A project tool configuration saved from the CLI or the Project settings dialog
 * is written to the sessions store by main, and only then announced to the
 * windows. A flush the owning window already had in flight still carries the
 * values from before the change, and because `sessions:setMany` / `setAll`
 * replace whole agents, that flush would put the old values back on disk. The
 * window applies the announcement a moment later and writes again, so the disk
 * recovers, but a read in between (the CLI's `show agent`) reports the old value.
 *
 * So main remembers what it wrote until the window's copy shows it has caught up.
 * For each patched field of an incoming agent:
 * - the patched value: the window has it; stop guarding that field;
 * - a value from before the patch: a stale copy; keep the patched value;
 * - anything else: a newer edit made in the window after it caught up; it wins.
 */

type FieldValues = Record<string, unknown>;

interface PendingEntry {
	/** The values main wrote, by field. */
	fields: FieldValues;
	/** Serialized values a stale window copy may still hold, by field. */
	stale: Record<string, Set<string>>;
}

/** Stable serialization so object-valued fields (env vars) compare by content. */
function serialize(value: unknown): string {
	if (value === undefined || value === null) return 'null';
	if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${serialize(item)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

export interface PendingSessionPatches {
	/** Record a patch BEFORE it is written, with the agent's values before it. */
	note(sessionId: string, fields: FieldValues, previous: FieldValues): void;
	/** Forget a patch that was rolled back. */
	forget(sessionIds: Iterable<string>): void;
	/** Restore guarded fields on a stale incoming copy of an agent. */
	apply<T extends { id: string }>(session: T): T;
}

export function createPendingSessionPatches(limit = 500): PendingSessionPatches {
	const pending = new Map<string, PendingEntry>();
	return {
		note(sessionId, fields, previous) {
			const entry = pending.get(sessionId) ?? { fields: {}, stale: {} };
			for (const [key, value] of Object.entries(fields)) {
				// A window may still hold the value from before this patch, or the value
				// of an earlier patch it has not caught up with either.
				const stale = entry.stale[key] ?? new Set<string>();
				stale.add(serialize(key in entry.fields ? entry.fields[key] : previous[key]));
				stale.add(serialize(previous[key]));
				stale.delete(serialize(value));
				entry.stale[key] = stale;
				entry.fields[key] = value;
			}
			pending.delete(sessionId);
			pending.set(sessionId, entry);
			// Bounded: an agent its window never writes again keeps an entry, and a
			// process runs for days. The oldest guard is the least likely to matter.
			while (pending.size > limit) pending.delete(pending.keys().next().value as string);
		},
		forget(sessionIds) {
			for (const id of sessionIds) pending.delete(id);
		},
		apply(session) {
			const entry = pending.get(session.id);
			if (!entry) return session;
			let result = session;
			for (const key of Object.keys(entry.fields)) {
				const incoming = serialize((session as Record<string, unknown>)[key]);
				if (entry.stale[key]?.has(incoming)) {
					result = { ...result, [key]: entry.fields[key] };
					continue;
				}
				// Caught up, or a newer edit: either way the window is now the authority.
				delete entry.fields[key];
				delete entry.stale[key];
			}
			if (Object.keys(entry.fields).length === 0) pending.delete(session.id);
			return result;
		},
	};
}
