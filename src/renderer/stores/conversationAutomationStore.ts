import { create } from 'zustand';
import {
	conversationKey,
	type ConversationAutomationState,
} from '../../shared/conversationAutomation';

/** A projection of main-process evidence, never a second scheduler. */
export const useConversationAutomationStore = create<{
	states: Record<string, ConversationAutomationState>;
	replace: (states: ConversationAutomationState[]) => void;
}>((set) => ({
	states: {},
	replace: (states) =>
		set({
			states: Object.fromEntries(states.map((state) => [conversationKey(state.target), state])),
		}),
}));
