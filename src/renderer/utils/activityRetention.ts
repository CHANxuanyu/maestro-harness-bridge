import { useSettingsStore } from '../stores/settingsStore';
import type { ActivityRetention } from './logEntries';

/**
 * Whether the live turn's tool calls are kept by the stream, exit and Stop
 * clear points right now. The conversation-centred layout keeps them (folded,
 * readable after the turn and after a restart); the agent layout keeps its
 * original scratch-state behaviour. Read at the moment of clearing, so a layout
 * switch applies from the next clear on.
 */
export function currentActivityRetention(): ActivityRetention {
	return { keepTools: useSettingsStore.getState().sidebarNavigationMode === 'conversations' };
}
