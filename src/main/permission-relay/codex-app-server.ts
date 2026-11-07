import type { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { isWebContentsAvailable } from '../utils/safe-send';
import { createPending, registerSpawn, resolvePending, ownsPending } from './registry';
import { getActingUser } from '../web-server/auth/acting-user';
import type { PermissionCaller, PermissionRequest } from './types';
import type { CodexAppServerApproval } from '../process-manager/CodexAppServerSession';

const visibleRequests = new Map<string, Omit<PermissionRequest, 'token'>>();

export function listCodexAppServerPermissions(
	caller?: PermissionCaller
): Omit<PermissionRequest, 'token'>[] {
	if (!caller) throw new Error('Codex approvals are unavailable for this caller.');
	return [...visibleRequests.values()].filter((request) => ownsPending(request.requestId, caller));
}

/** App-server answers share the existing prompt and decision registry, without a socket. */
export function prepareCodexAppServerPermissions(options: {
	sessionId: string;
	tabId?: string;
	getMainWindow: () => BrowserWindow | null;
}) {
	const window = options.getMainWindow();
	const { token, cleanup } = registerSpawn({
		...options,
		owner: { userId: getActingUser()?.id, window },
	});
	const ids = new Map<string, string>();
	let disposed = false;
	const send = (channel: string, data: unknown) => {
		if (!window || !isWebContentsAvailable(window)) return false;
		window.webContents.send(channel, data);
		return true;
	};
	return {
		async onPermissionRequest(request: CodexAppServerApproval): Promise<'accept' | 'decline'> {
			if (disposed) return 'decline';
			const requestId = randomUUID();
			ids.set(request.requestId, requestId);
			const pending = createPending(requestId, token);
			try {
				const prompt: Omit<PermissionRequest, 'token'> = {
					provider: 'codex',
					requestId,
					sessionId: options.sessionId,
					tabId: options.tabId,
					toolName:
						request.method === 'item/commandExecution/requestApproval' ? 'Bash' : 'apply_patch',
					input:
						request.method === 'item/commandExecution/requestApproval'
							? { command: request.command, cwd: request.cwd, reason: request.reason }
							: { changes: request.changes, reason: request.reason },
					createdAt: Date.now(),
				};
				visibleRequests.set(requestId, prompt);
				const available = send('process:permission-request', prompt);
				if (!available)
					resolvePending(requestId, { behavior: 'deny', message: 'Permission UI unavailable.' });
			} catch {
				resolvePending(requestId, { behavior: 'deny', message: 'Permission UI unavailable.' });
			}
			const decision = await pending;
			visibleRequests.delete(requestId);
			ids.delete(request.requestId);
			try {
				send('process:permission-resolved', requestId);
			} catch {
				/* Window closed. */
			}
			return !disposed && decision.behavior === 'allow' ? 'accept' : 'decline';
		},
		onPermissionResolved(requestId: string) {
			const id = ids.get(requestId);
			if (id) resolvePending(id, { behavior: 'deny', message: 'Request already resolved.' });
		},
		onDispose() {
			disposed = true;
			cleanup();
		},
	};
}
