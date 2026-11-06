import { invokeNativeHistory } from '../services/agent-sessions';
import { getSessionById, readSessions, resolveAgentId } from '../services/storage';
import { failCommand } from '../services/session-command';
import type { ProjectHistoryResult } from '../../shared/projectHistory';

/** Drive the same native history list and read paths as the project sidebar. */
export async function nativeHistory(
	action: string,
	agentArg: string | undefined,
	nativeId: string | undefined,
	options: { json?: boolean }
): Promise<void> {
	try {
		if (action === 'projects') {
			const result = await invokeNativeHistory('agentSessions:projects', []);
			console.log(JSON.stringify({ success: true, result }, null, options.json ? undefined : 2));
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
			if (!nativeId) throw new Error('A native conversation ID is required');
			result = await invokeNativeHistory('agentSessions:deleteCodexConversation', [
				agentId,
				nativeId,
			]);
		} else throw new Error('Action must be list, read or delete');
		console.log(JSON.stringify({ success: true, result }, null, options.json ? undefined : 2));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
