import { ipcRenderer } from 'electron';
import type {
	AutomationRequest,
	ConversationAutomationState,
	ConversationDelivery,
} from '../../shared/conversationAutomation';

export function createConversationAutomationApi() {
	return {
		execute: (request: AutomationRequest): Promise<ConversationAutomationState> =>
			ipcRenderer.invoke('conversationAutomation:execute', request),
		list: (): Promise<ConversationAutomationState[]> =>
			ipcRenderer.invoke('conversationAutomation:list'),
		ready: (): Promise<void> => ipcRenderer.invoke('conversationAutomation:ready'),
		acknowledge: (id: string, error?: string): Promise<void> =>
			ipcRenderer.invoke('conversationAutomation:ack', id, error),
		onChanged: (callback: () => void): (() => void) => {
			ipcRenderer.on('conversationAutomation:changed', callback);
			return () => {
				ipcRenderer.removeListener('conversationAutomation:changed', callback);
			};
		},
		onTurn: (callback: (delivery: ConversationDelivery) => void): (() => void) => {
			const handler = (_event: unknown, delivery: ConversationDelivery) => callback(delivery);
			ipcRenderer.on('conversationAutomation:turn', handler);
			return () => {
				ipcRenderer.removeListener('conversationAutomation:turn', handler);
			};
		},
	};
}
