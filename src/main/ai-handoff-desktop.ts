import type { BrowserWindow } from 'electron';
import type Store from 'electron-store';
import { createAiHandoffService } from './ai-handoff';
import type { AgentConfigsData, MaestroSettings, SessionsData } from './stores/types';
import { checkBinaryExists, checkCustomPath } from './agents/path-prober';
import { getAgentDefinition } from './agents/definitions';
import { requestFromRenderer } from './web-server/callbacks/remoteRequest';
import { isWebContentsAvailable } from './utils/safe-send';
import type { HandoffReadResult, HandoffResult } from '../shared/aiHandoff';

/** Desktop transport for the same service used by the GUI IPC and CLI bridge. */
export function createDesktopAiHandoff(deps: {
	getWindowForSession: (sessionId: string) => BrowserWindow | null;
	sessionsStore: Store<SessionsData>;
	agentConfigsStore: Store<AgentConfigsData>;
	settingsStore: Store<MaestroSettings>;
	env?: Record<string, string | undefined>;
}) {
	return createAiHandoffService({
		getSessions: () => deps.sessionsStore.get('sessions', []),
		getAgentConfig: (toolType) => deps.agentConfigsStore.get('configs', {})[toolType] ?? {},
		getGlobalEnv: () => deps.settingsStore.get('shellEnvVars', {}),
		env: deps.env ?? process.env,
		isAvailable: async (config) => {
			const binary = getAgentDefinition(config.toolType)?.binaryName;
			if (!binary) return false;
			// Filesystem/PATH inspection only. Never start a model to populate a picker.
			return (
				config.customPath
					? await checkCustomPath(config.customPath)
					: await checkBinaryExists(binary)
			).exists;
		},
		readSource: async (request) => {
			const win = deps.getWindowForSession(request.sourceAgentId);
			if (!isWebContentsAvailable(win)) return null;
			return requestFromRenderer<HandoffReadResult>(win, 'context:readHandoffSource', {
				fallback: null,
				args: [request],
			});
		},
		openTarget: async (request) => {
			const win = deps.getWindowForSession(request.runnerId ?? request.sourceAgentId);
			const fallback: HandoffResult = {
				success: false,
				code: 'unavailable',
				error: 'The target window did not answer the handoff request',
			};
			if (!isWebContentsAvailable(win)) return fallback;
			return requestFromRenderer<HandoffResult>(win, 'context:openHandoffTarget', {
				fallback,
				args: [request],
				timeoutMs: 15000,
			});
		},
	});
}
