import { invokeNativeHistory } from '../services/agent-sessions';
import { resolveCliPath } from '../utils/parse';
import { failCommand } from '../services/session-command';
import type { OpenProjectResult } from '../../shared/projects';

export async function openProjectCommand(
	directory: string,
	options: { json?: boolean }
): Promise<void> {
	try {
		const result = await invokeNativeHistory<OpenProjectResult>(
			'agentSessions:openProject',
			[resolveCliPath(directory)],
			45000
		);
		if (!result.success) throw new Error(result.error);
		console.log(JSON.stringify(result, null, options.json ? undefined : 2));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
