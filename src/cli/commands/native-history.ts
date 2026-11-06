import { invokeNativeHistory } from '../services/agent-sessions';
import { getSessionById, readSessions, resolveAgentId } from '../services/storage';
import type { NativeToolOutputTarget, NativeToolOutputResult } from '../../shared/nativeToolOutput';
import { failCommand, resolveTabEntry, listDesktopTabs } from '../services/session-command';
import type { ProjectHistoryResult } from '../../shared/projectHistory';

/** Drive the same native history list and read paths as the project sidebar. */
export async function nativeHistory(
	action: string,
	agentArg: string | undefined,
	nativeId: string | undefined,
	options: { json?: boolean; copy?: boolean; archived?: boolean; yes?: boolean }
): Promise<void> {
	try {
		if (action === 'projects') {
			const result = await invokeNativeHistory('agentSessions:projects', []);
			console.log(JSON.stringify({ success: true, result }, null, options.json ? undefined : 2));
			return;
		}
		if (action === 'tool-output') {
			if (!agentArg || !nativeId) throw new Error('A session and tool call ID are required');
			let target: NativeToolOutputTarget | undefined;
			const tab = await resolveTabEntry(agentArg).catch(async (error) => {
				const tabs = await listDesktopTabs();
				const matches = tabs.filter((entry) => entry.agentSessionId === agentArg);
				if (matches.length === 1) return matches[0];
				if (matches.length > 1) throw error;
				const sources = new Map(
					tabs
						.flatMap((entry) => entry.toolOutputSources ?? [])
						.filter((source) => source.nativeSessionId === agentArg)
						.map((source) => [JSON.stringify(source), source])
				);
				if (sources.size === 1) {
					target = [...sources.values()][0];
					return undefined;
				}
				if (sources.size > 1 || !String(error).includes('Tab not found:')) throw error;
				// The renderer opens history before its debounced tab save reaches main.
				// Resolve the exact native ID through the same project history as the sidebar.
				const owners = readSessions();
				const history = await invokeNativeHistory<ProjectHistoryResult>(
					'agentSessions:listProjectHistory',
					[
						owners.map((owner) => ({
							projectKey: owner.id,
							projectPath: owner.projectRoot || owner.cwd,
							ownerIds: owners.map((item) => item.id),
							sshRemoteId: owner.sessionSshRemoteConfig?.enabled
								? owner.sessionSshRemoteConfig.remoteId
								: undefined,
						})),
					]
				);
				const records = new Map(
					history.conversations
						.filter((record) => record.nativeSessionId === agentArg)
						.map((record) => [record.key, record])
				);
				const record = records.size === 1 ? [...records.values()][0] : undefined;
				if (!record?.ownerId) throw error;
				target = {
					provider: record.provider,
					projectPath: record.projectPath,
					nativeSessionId: record.nativeSessionId,
					ownerAgentId: record.ownerId,
					accountDir: record.accountDir,
					sshRemoteId: record.sshRemoteId,
				};
				return undefined;
			});
			if (tab) {
				const owner = getSessionById(tab.agentId);
				if (!owner || !tab.agentSessionId) throw new Error('Native conversation not found');
				target = {
					provider: owner.toolType,
					projectPath: owner.projectRoot || owner.cwd,
					nativeSessionId: tab.agentSessionId,
					ownerAgentId: tab.agentId,
					sshRemoteId: owner.sessionSshRemoteConfig?.enabled
						? owner.sessionSshRemoteConfig.remoteId || 'unavailable'
						: undefined,
				};
			}
			if (!target) throw new Error('Native conversation not found');
			const result = await invokeNativeHistory<NativeToolOutputResult>(
				'agentSessions:toolOutput',
				[target, nativeId],
				45000
			);
			if (result.status !== 'found') throw new Error(`Tool output: ${result.status}`);
			if (options.copy) await invokeNativeHistory('clipboard:writeText', [result.text]);
			if (options.json) console.log(JSON.stringify({ success: true, result }));
			else {
				if (result.omittedBytes)
					console.error(`Omitted ${result.omittedBytes} bytes from the beginning.`);
				console.log(result.text);
			}
			return;
		}
		if (action === 'list' && options.archived && !agentArg) {
			const conversations = await invokeNativeHistory('agentSessions:archives', []);
			console.log(
				JSON.stringify(
					{ success: true, result: { conversations, errors: [] } },
					null,
					options.json ? undefined : 2
				)
			);
			return;
		}
		if (!agentArg) throw new Error('An agent is required');
		const agentId = resolveAgentId(agentArg);
		const agent = getSessionById(agentId);
		if (!agent) throw new Error('Agent not found');
		const projectPath = agent.projectRoot || agent.cwd;
		const sshRemoteId = agent.sessionSshRemoteConfig?.enabled
			? agent.sessionSshRemoteConfig.remoteId
			: undefined;
		let result: unknown;
		if (action === 'list') {
			const scope = {
				projectKey: agentId,
				projectPath,
				ownerIds: readSessions().map((owner) => owner.id),
				sshRemoteId,
			};
			result = await invokeNativeHistory<ProjectHistoryResult>('agentSessions:listProjectHistory', [
				[scope],
				...(options.archived ? [{ archived: true }] : []),
			]);
		} else if (action === 'archive' || action === 'unarchive') {
			if (!nativeId) throw new Error('A native conversation ID is required');
			result = await invokeNativeHistory('agentSessions:archiveConversation', [
				{ ownerId: agentId, nativeSessionId: nativeId },
				action,
			]);
		} else if (action === 'read') {
			if (!nativeId) throw new Error('A native conversation ID is required');
			result = await invokeNativeHistory('agentSessions:read', [
				agent.toolType,
				projectPath,
				nativeId,
				{ ownerAgentId: agentId, readOnly: true, limit: 100000 },
				sshRemoteId,
			]);
		} else if (action === 'delete') {
			if (!options.yes)
				throw new Error('Deleting native history cannot be undone. Pass --yes to confirm.');
			if (!nativeId) throw new Error('A native conversation ID is required');
			result = await invokeNativeHistory('agentSessions:deleteCodexConversation', [
				agentId,
				nativeId,
			]);
		} else
			throw new Error(
				'Action must be projects, list, read, tool-output, archive, unarchive or delete'
			);
		console.log(JSON.stringify({ success: true, result }, null, options.json ? undefined : 2));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
