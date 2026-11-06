import { withMaestroClient } from '../services/maestro-client';
import { resolveTabEntry, failCommand } from '../services/session-command';
import type {
	GitChanges,
	GitFileChangeDiff,
	GitChangeRequest,
	GitChangeResult,
} from '../../shared/gitChanges';
import type { AgentSshRemoteConfig } from '../../shared/types';
import {
	collectTurnWrites,
	groupChangesByTurn,
	type ChangeTurnEntry,
	type GitChangesByTurn,
} from '../../shared/gitChangeTurns';

interface ChangesOptions {
	agent?: string;
	tab?: string;
	file?: string;
	json?: boolean;
	byTurn?: boolean;
	action?: string;
	paths?: string[];
	message?: string;
	yes?: boolean;
}

/** Resolve the live tab first, then invoke the same IPC handlers as the panel. */
export async function changes(options: ChangesOptions): Promise<void> {
	try {
		if (options.byTurn && (options.file !== undefined || options.action))
			throw new Error('--by-turn is only available when listing changes');
		let request: GitChangeRequest | undefined;
		if (options.action) {
			if (options.file !== undefined)
				throw new Error('--file is only available when reading changes');
			if (options.action === 'commit') {
				if (!options.message?.trim() || options.paths?.length)
					throw new Error('Use changes commit --message <text>');
				request = { action: 'commit', message: options.message };
			} else if (
				options.action === 'stage' ||
				options.action === 'unstage' ||
				options.action === 'revert'
			) {
				if (!options.paths?.length)
					throw new Error('At least one repository-relative path is required');
				if (options.action === 'revert' && !options.yes)
					throw new Error('Revert deletes changes; pass --yes to confirm');
				request = {
					action: options.action,
					paths: options.paths,
					...(options.action === 'revert' ? { confirmed: true } : {}),
				};
			} else throw new Error(`Unknown changes action: ${options.action}`);
		}
		const tab = await resolveTabEntry(options.tab ?? 'active', options.agent);
		const result = await withMaestroClient<
			GitChanges | GitChangesByTurn | GitFileChangeDiff | GitChangeResult
		>(async (client) => {
			const invoke = async <T>(channel: string, args: unknown[]): Promise<T> => {
				const reply = await client.sendCommand<{ ok: boolean; result: T; error?: string }>(
					{ type: 'bridge.invoke', channel, args },
					'bridge.response',
					request ? 180000 : options.file === undefined ? 25000 : 45000
				);
				if (!reply.ok) throw new Error(reply.error ?? `Failed to invoke ${channel}`);
				return reply.result;
			};
			const sessions = await invoke<
				Array<{
					id: string;
					cwd: string;
					aiTabs?: Array<{ id: string; logs: ChangeTurnEntry[] }>;
					sshRemoteId?: string;
					sessionSshRemoteConfig?: AgentSshRemoteConfig;
				}>
			>('sessions:getAll', []);
			const session = sessions.find((item) => item.id === tab.agentId);
			if (!session) throw new Error('The selected agent is no longer available');
			const ssh = session.sessionSshRemoteConfig;
			if (ssh?.enabled && !ssh.remoteId && !session.sshRemoteId)
				throw new Error('SSH is enabled but no remote is configured');
			const context = [
				session.sshRemoteId || (ssh?.enabled ? ssh.remoteId : undefined),
				ssh?.enabled ? ssh.workingDirOverride || session.cwd : undefined,
			];
			if (request)
				return invoke<GitChangeResult>('git:applyChange', [session.cwd, request, ...context]);
			if (options.byTurn) {
				const selected = session.aiTabs?.find((item) => item.id === tab.tabId);
				if (!selected) throw new Error('The selected conversation is no longer available');
				const snapshot = await invoke<GitChanges>('git:changes', [session.cwd, ...context]);
				return groupChangesByTurn(
					snapshot,
					collectTurnWrites(selected.logs),
					context[1] || session.cwd,
					!!context[0]
				);
			}
			return options.file !== undefined
				? invoke<GitFileChangeDiff>('git:changeDiff', [session.cwd, options.file, ...context])
				: invoke<GitChanges>('git:changes', [session.cwd, ...context]);
		});
		if ('success' in result && !result.success) throw new Error(result.error);
		if (options.json) console.log(JSON.stringify(result));
		else if ('success' in result) console.log(result.output);
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
			else if ('groups' in result) {
				console.log('Each file shows its current diff, not a diff for that turn.');
				if (!result.hasWriteRecords)
					console.log(
						'No recorded file writes in this conversation. Omit --by-turn to list files.'
					);
				for (const group of result.groups) {
					console.log(
						group.turnId === null
							? 'Other changes'
							: `${group.title}\t${Number.isFinite(group.timestamp) ? new Date(group.timestamp!).toISOString() : ''}`
					);
					for (const file of group.files) console.log(`${file.status}\t${file.path}`);
				}
				if (result.truncated)
					console.log(`Showing ${result.files.length} of ${result.totals.files} files`);
			} else {
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
