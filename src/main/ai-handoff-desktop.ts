import type { BrowserWindow } from 'electron';
import type Store from 'electron-store';
import { getSshRemoteById } from './stores';
import { buildSshCommand } from './utils/ssh-command-builder';
import { execFileNoThrow } from './utils/execFile';
import { prepareDeepSeekPreset } from './agents/deepseek-preset';
import { handoffLocation } from '../shared/aiHandoff';
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
		preparePreset: async (config) => {
			const env = {
				...(deps.env ?? process.env),
				...deps.settingsStore.get('shellEnvVars', {}),
				...config.customEnvVars,
			};
			const prepared = await prepareDeepSeekPreset({
				apiKey: env.ANTHROPIC_AUTH_TOKEN?.trim() || env.ANTHROPIC_API_KEY?.trim() || '',
				model: config.customModel,
			});
			return {
				...config,
				...prepared,
				customEnvVars: { ...config.customEnvVars, ...prepared.customEnvVars },
			};
		},
		isAvailable: async (config, source) => {
			const binary = getAgentDefinition(config.toolType)?.binaryName;
			if (!binary) return false;
			if (source.sessionSshRemoteConfig?.enabled) {
				const remote = getSshRemoteById(source.sessionSshRemoteConfig.remoteId!);
				if (!remote?.enabled) throw new Error('The source SSH remote is unavailable');
				const command = await buildSshCommand(remote, {
					command: 'command',
					args: ['-v', config.customPath || binary],
					cwd: handoffLocation(source).cwd,
				});
				const result = await execFileNoThrow(command.command, command.args, undefined, {
					timeout: 10000,
				});
				if (result.exitCode === 1) return false;
				if (result.exitCode !== 0)
					throw new Error(result.stderr || 'Could not check the target CLI on the source SSH host');
				return !!result.stdout.trim();
			}
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
				timeoutMs: 30000,
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
			const sourceWindow = deps.getWindowForSession(request.sourceAgentId);
			if (request.newConversation?.replaceTabId && sourceWindow?.id !== win.id) {
				if (!isWebContentsAvailable(sourceWindow)) return fallback;
				const snapshot = await requestFromRenderer<HandoffReadResult>(
					sourceWindow,
					'context:readHandoffSource',
					{
						fallback: null,
						args: [
							{
								sourceAgentId: request.sourceAgentId,
								sourceTabId: request.newConversation.replaceTabId,
								provider: request.origin.sourceProvider,
								emptyConversation: true,
							},
						],
						timeoutMs: 30000,
					}
				);
				if (
					!snapshot ||
					'success' in snapshot ||
					!snapshot.emptyConversation ||
					handoffLocation(snapshot).key !== handoffLocation(request).key
				)
					return { ...fallback, error: 'The source conversation could not be read from its owner' };
				request = {
					...request,
					draft: snapshot.draft,
					newConversation: { ...request.newConversation, source: snapshot.emptyConversation },
				};
			}
			return requestFromRenderer<HandoffResult>(win, 'context:openHandoffTarget', {
				fallback,
				args: [request],
				timeoutMs: 30000,
			});
		},
	});
}
