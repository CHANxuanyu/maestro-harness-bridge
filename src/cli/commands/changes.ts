import { withMaestroClient } from '../services/maestro-client';
import { resolveTabEntry, failCommand } from '../services/session-command';
import type { GitChanges, GitFileChangeDiff } from '../../shared/gitChanges';
import type { AgentSshRemoteConfig } from '../../shared/types';

interface ChangesOptions {
	agent?: string;
	tab?: string;
	file?: string;
	json?: boolean;
}

/** Resolve the live tab first, then invoke the same IPC handlers as the panel. */
export async function changes(options: ChangesOptions): Promise<void> {
	try {
		const tab = await resolveTabEntry(options.tab ?? 'active', options.agent);
		const result = await withMaestroClient(async (client) => {
			const invoke = async <T>(channel: string, args: unknown[]): Promise<T> => {
				const reply = await client.sendCommand<{ ok: boolean; result: T; error?: string }>(
					{ type: 'bridge.invoke', channel, args },
					'bridge.response',
					options.file === undefined ? 25000 : 45000
				);
				if (!reply.ok) throw new Error(reply.error ?? `Failed to invoke ${channel}`);
				return reply.result;
			};
			const sessions = await invoke<
				Array<{ id: string; cwd: string; sessionSshRemoteConfig?: AgentSshRemoteConfig }>
			>('sessions:getAll', []);
			const session = sessions.find((item) => item.id === tab.agentId);
			if (!session) throw new Error('The selected agent is no longer available');
			const ssh = session.sessionSshRemoteConfig;
			if (ssh?.enabled && !ssh.remoteId)
				throw new Error('SSH is enabled but no remote is configured');
			const context = [
				ssh?.enabled ? ssh.remoteId : undefined,
				ssh?.enabled ? ssh.workingDirOverride || session.cwd : undefined,
			];
			return options.file !== undefined
				? invoke<GitFileChangeDiff>('git:changeDiff', [session.cwd, options.file, ...context])
				: invoke<GitChanges>('git:changes', [session.cwd, ...context]);
		});
		if (options.json) console.log(JSON.stringify(result));
		else if ('diff' in result)
			console.log(
				result.tooLarge
					? 'Diff exceeds 1 MiB'
					: result.binary
						? 'Binary file'
						: result.timedOut
							? 'Git timed out'
							: result.diff
			);
		else {
			if (result.timedOut) console.log('Git timed out');
			else if (result.notARepo) console.log('Not a git repository');
			else {
				for (const file of result.files)
					console.log(
						`${file.status}\t${file.additions ?? '-'}\t${file.deletions ?? '-'}\t${file.path}`
					);
				console.log(
					`${result.totals.files} files, +${result.totals.additions} -${result.totals.deletions}${result.truncated ? ' (list truncated)' : ''}`
				);
			}
		}
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
