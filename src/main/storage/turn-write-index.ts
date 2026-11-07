import type {
	AgentSessionStorage,
	SessionMessage,
	SessionReadOptions,
} from '../agents/session-storage';
import type { SshRemoteConfig } from '../../shared/types';
import { collectTurnWrites, type TurnWrites } from '../../shared/gitChangeTurns';
import { transcriptMessagesToLogEntries } from '../../shared/transcriptEntries';

interface IndexedTranscript {
	messages: SessionMessage[];
	tailStart: number;
	prefix: TurnWrites[];
	turns: TurnWrites[];
}

/** One bounded main-process index shared by panel and CLI, never a display-window cache. */
export function createNativeTurnWriteReader() {
	const cache = new Map<string, { revision: string | null; value: Promise<IndexedTranscript> }>();
	return async (
		provider: string,
		storage: AgentSessionStorage,
		projectPath: string,
		nativeId: string,
		options: Pick<SessionReadOptions, 'configDir'>,
		remote?: SshRemoteConfig
	): Promise<TurnWrites[]> => {
		const key = JSON.stringify([provider, projectPath, nativeId, options.configDir, remote]);
		// Claude's revision probe is local-only. Its remote read remains explicitly remote.
		const revision =
			storage.getTranscriptRevision && (!remote || provider === 'codex')
				? await storage.getTranscriptRevision(projectPath, nativeId, options, remote)
				: null;
		const previous = cache.get(key);
		if (revision !== null && previous?.revision === revision) return (await previous.value).turns;
		const value = (async (): Promise<IndexedTranscript> => {
			const prior = await previous?.value.catch(() => undefined);
			const result = await storage.readSessionMessages(
				projectPath,
				nativeId,
				{
					...options,
					readOnly: true,
					offset: 0,
					limit: Number.MAX_SAFE_INTEGER,
				},
				remote
			);
			if (result.hasMore) throw new Error('TURN_WRITES_INCOMPLETE');
			const messages = result.messages;
			// Canonical incremental readers retain unchanged message objects. Re-convert
			// only the open turn and appended turns, where later results can complete calls.
			const reuse =
				prior &&
				messages.length >= prior.tailStart &&
				prior.messages
					.slice(0, prior.tailStart)
					.every((message, index) => messages[index] === message);
			const start = reuse ? prior.tailStart : 0;
			const logs = transcriptMessagesToLogEntries(messages.slice(start));
			const turns = [...collectTurnWrites(logs), ...(reuse ? prior.prefix : [])];
			let currentUser: string | undefined;
			let pendingUser: string | undefined;
			for (const entry of logs) {
				if (entry.source === 'user') currentUser = entry.id;
				const state = entry.metadata?.toolState;
				if (
					currentUser &&
					!pendingUser &&
					state?.writePaths?.length &&
					(state.status === undefined || state.status === 'unknown')
				)
					pendingUser = currentUser;
			}
			const openUser = pendingUser ?? currentUser;
			const tailStart = openUser
				? Math.max(
						0,
						messages.findIndex((message) => message.uuid === openUser)
					)
				: start;
			const closedIds = new Set(messages.slice(0, tailStart).map((message) => message.uuid));
			return {
				messages,
				turns,
				tailStart,
				prefix: turns.filter((turn) => closedIds.has(turn.turnId)),
			};
		})();
		const entry = { revision, value };
		cache.delete(key);
		cache.set(key, entry);
		while (cache.size > 32) cache.delete(cache.keys().next().value!);
		try {
			return (await value).turns;
		} catch (error) {
			if (cache.get(key) === entry) cache.delete(key);
			throw error;
		}
	};
}
