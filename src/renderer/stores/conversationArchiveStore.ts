import { create } from 'zustand';
import type { ArchivedConversation } from '../../shared/conversationArchive';

/** Main owns persistence and resolves exact account membership for every window. */
export const useConversationArchiveStore = create<{ records: ArchivedConversation[] }>(() => ({
	records: [],
}));

export async function refreshConversationArchives(): Promise<void> {
	const api = window.maestro.agentSessions.archives;
	if (api)
		useConversationArchiveStore.setState({ records: await api({ includeUnarchived: true }) });
}
