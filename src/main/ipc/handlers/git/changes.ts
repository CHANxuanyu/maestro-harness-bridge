import { ipcMain } from 'electron';
import { getGitChanges, getGitChangeDiff, applyGitChange } from '../../../git-changes';
import type { GitChangeRequest } from '../../../../shared/gitChanges';
import { getSshRemoteById } from '../../../stores';
import { withIpcErrorLogging } from '../../../utils/ipcHandler';
import { handlerOpts } from './shared';

export function registerChangesHandlers(): void {
	const remoteForChanges = (id?: string) => {
		if (!id) return undefined;
		const remote = getSshRemoteById(id);
		if (!remote || !remote.enabled) throw new Error(`SSH remote unavailable: ${id}`);
		return remote;
	};
	ipcMain.handle(
		'git:changes',
		withIpcErrorLogging(
			handlerOpts('changes'),
			(cwd: string, sshRemoteId?: string, remoteCwd?: string) =>
				getGitChanges(cwd, remoteForChanges(sshRemoteId), remoteCwd ?? cwd)
		)
	);
	ipcMain.handle(
		'git:changeDiff',
		withIpcErrorLogging(
			handlerOpts('changeDiff'),
			(cwd: string, file: string, sshRemoteId?: string, remoteCwd?: string) =>
				getGitChangeDiff(cwd, file, remoteForChanges(sshRemoteId), remoteCwd ?? cwd)
		)
	);
	ipcMain.handle(
		'git:applyChange',
		withIpcErrorLogging(
			handlerOpts('applyChange'),
			(cwd: string, request: GitChangeRequest, sshRemoteId?: string, remoteCwd?: string) =>
				applyGitChange(cwd, request, remoteForChanges(sshRemoteId), remoteCwd ?? cwd)
		)
	);
}
