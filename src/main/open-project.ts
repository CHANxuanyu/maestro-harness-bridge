import fs from 'node:fs/promises';
import { AGENT_AUTOSELECT_ORDER } from '../shared/agentMetadata';
import { defaultAgentNameForPath } from '../shared/projectIdentity';
import { normalizeWorktreePath } from '../shared/worktreePaths';
import { createKeyedWriteQueue } from '../shared/keyedWriteQueue';
import { localProjectPathCandidates } from './storage/local-project-paths';
import type { OpenProjectResult, OpenProjectTarget } from '../shared/projects';

interface ProjectOwner {
	id: string;
	name: string;
	cwd: string;
	projectRoot?: string;
	toolType: string;
	sessionSshRemoteConfig?: { enabled?: boolean };
}

/** UI and CLI both enter here; the renderer uses its existing creation path. */
export function createProjectOpener(deps: {
	sessions: () => ProjectOwner[];
	detect: () => Promise<Array<{ id: string; available?: boolean }>>;
	open: (target: OpenProjectTarget) => Promise<OpenProjectResult>;
}) {
	const queue = createKeyedWriteQueue();
	return async function openProject(
		directory: string,
		requesterWindowId?: number
	): Promise<OpenProjectResult> {
		if (typeof directory !== 'string' || !directory.trim())
			throw new Error('Choose a project directory');
		const physical = await fs.realpath(directory);
		if (!(await fs.stat(physical)).isDirectory())
			throw new Error('Project path is not a directory');
		return queue.enqueue<OpenProjectResult>('open-project', async () => {
			const sessions = deps.sessions();
			const requester = requesterWindowId === undefined ? {} : { requesterWindowId };
			const key = normalizeWorktreePath(physical);
			const existing = sessions.find(
				(session) =>
					session.toolType !== 'terminal' &&
					!session.sessionSshRemoteConfig?.enabled &&
					localProjectPathCandidates(session.cwd).some(
						(candidate) => normalizeWorktreePath(candidate) === key
					)
			);
			if (existing) return deps.open({ ...requester, path: physical, sessionId: existing.id });
			const agents = await deps.detect();
			const toolType = AGENT_AUTOSELECT_ORDER.find((id) =>
				agents.some((agent) => agent.id === id && agent.available)
			);
			if (!toolType)
				return {
					success: false,
					code: 'no-tools',
					error: 'Install Claude Code or Codex to open a project.',
				};
			return deps.open({
				...requester,
				path: physical,
				toolType,
				name:
					defaultAgentNameForPath(
						physical,
						sessions.map((s) => s.name)
					) || physical,
			});
		});
	};
}
