import { requestFromRenderer } from './remoteRequest';
import { PROJECT_CONVERSATION_TIMEOUT_MS } from '../../../shared/projectSettings';
import { randomUUID } from 'crypto';
import { ipcMain } from 'electron';
import type { WebServer } from '../WebServer';
import type { WebServerFactoryDependencies } from '../web-server-factory';
import { logger } from '../../utils/logger';
import { isWebContentsAvailable } from '../../utils/safe-send';

export function registerSessionCrudCallbacks(
	server: WebServer,
	deps: Pick<
		WebServerFactoryDependencies,
		'getMainWindow' | 'getWindowForSession' | 'getAppWindows'
	>
): void {
	const { getMainWindow, getWindowForSession } = deps;

	// Set up callback for web server to create a session
	// Uses IPC request-response pattern - renderer creates the session and responds with sessionId
	//
	// `background` has to reach the renderer for `create-agent --background` to
	// mean anything: the renderer's gate reads it off the event detail, so an
	// argument dropped here is indistinguishable from a foreground create and
	// the new agent takes the window from whoever is working (issue #1496).
	server.setCreateSessionCallback(async (name, toolType, cwd, groupId, config, background) => {
		const mainWindow = getMainWindow();
		if (!mainWindow) {
			logger.warn('mainWindow is null for createSession', 'WebServer');
			return null;
		}

		return new Promise((resolve) => {
			const responseChannel = `remote:createSession:response:${randomUUID()}`;
			let resolved = false;

			const handleResponse = (_event: Electron.IpcMainEvent, result: any) => {
				if (resolved) return;
				resolved = true;
				clearTimeout(timeoutId);
				resolve(result || null);
			};

			ipcMain.once(responseChannel, handleResponse);
			if (!isWebContentsAvailable(mainWindow)) {
				logger.warn('webContents is not available for createSession', 'WebServer');
				ipcMain.removeListener(responseChannel, handleResponse);
				resolve(null);
				return;
			}
			mainWindow.webContents.send(
				'remote:createSession',
				name,
				toolType,
				cwd,
				groupId,
				config,
				responseChannel,
				background === true
			);

			const timeoutId = setTimeout(() => {
				if (resolved) return;
				resolved = true;
				ipcMain.removeListener(responseChannel, handleResponse);
				logger.warn(`createSession callback timed out`, 'WebServer');
				resolve(null);
			}, 10000);
		});
	});

	// Set up callback for web server to create a worktree agent off a parent.
	// Mirrors the createSession bridge: hand off to the renderer (which owns
	// the worktree-spawn helper) and resolve with the new agent's session id.
	server.setCreateWorktreeSessionCallback(
		async (parentSessionId: string, config: any, background?: boolean) => {
			const mainWindow = getMainWindow();
			if (!mainWindow) {
				logger.warn('mainWindow is null for createWorktreeSession', 'WebServer');
				return { success: false, error: 'Main window not available' };
			}

			return new Promise((resolve) => {
				const responseChannel = `remote:createWorktreeSession:response:${randomUUID()}`;
				let resolved = false;

				const handleResponse = (_event: Electron.IpcMainEvent, result: any) => {
					if (resolved) return;
					resolved = true;
					clearTimeout(timeoutId);
					resolve(result || { success: false, error: 'No response' });
				};

				ipcMain.once(responseChannel, handleResponse);
				if (!isWebContentsAvailable(mainWindow)) {
					logger.warn('webContents is not available for createWorktreeSession', 'WebServer');
					ipcMain.removeListener(responseChannel, handleResponse);
					resolve({ success: false, error: 'Web contents not available' });
					return;
				}
				mainWindow.webContents.send(
					'remote:createWorktreeSession',
					parentSessionId,
					config,
					responseChannel,
					background === true
				);

				const timeoutId = setTimeout(() => {
					if (resolved) return;
					resolved = true;
					ipcMain.removeListener(responseChannel, handleResponse);
					logger.warn(
						`createWorktreeSession callback timed out for parent ${parentSessionId}`,
						'WebServer'
					);
					resolve({ success: false, error: 'Timeout' });
				}, 30000);
			});
		}
	);

	// Set up callback for web server to delete a session
	// Fire-and-forget pattern
	server.setDeleteSessionCallback(async (sessionId: string) => {
		const mainWindow = getMainWindow();
		if (!mainWindow) {
			logger.warn('mainWindow is null for deleteSession', 'WebServer');
			return false;
		}

		if (!isWebContentsAvailable(mainWindow)) {
			logger.warn('webContents is not available for deleteSession', 'WebServer');
			return false;
		}
		mainWindow.webContents.send('remote:deleteSession', sessionId);
		return true;
	});

	// Set up callback for web server to rename a session
	// Uses IPC request-response pattern
	server.setRenameSessionCallback(async (sessionId: string, newName: string) => {
		const mainWindow = getMainWindow();
		if (!mainWindow) {
			logger.warn('mainWindow is null for renameSession', 'WebServer');
			return false;
		}

		return new Promise((resolve) => {
			const responseChannel = `remote:renameSession:response:${randomUUID()}`;
			let resolved = false;

			const handleResponse = (_event: Electron.IpcMainEvent, result: any) => {
				if (resolved) return;
				resolved = true;
				clearTimeout(timeoutId);
				resolve(result ?? false);
			};

			ipcMain.once(responseChannel, handleResponse);
			if (!isWebContentsAvailable(mainWindow)) {
				logger.warn('webContents is not available for renameSession', 'WebServer');
				ipcMain.removeListener(responseChannel, handleResponse);
				resolve(false);
				return;
			}
			mainWindow.webContents.send('remote:renameSession', sessionId, newName, responseChannel);

			const timeoutId = setTimeout(() => {
				if (resolved) return;
				resolved = true;
				ipcMain.removeListener(responseChannel, handleResponse);
				logger.warn(`renameSession callback timed out for session ${sessionId}`, 'WebServer');
				resolve(false);
			}, 5000);
		});
	});

	// Set up callback for web server to update a session's working directory.
	// Mirrors renameSession's IPC request-response shape but returns a
	// structured result so the renderer can refuse mid-flight updates (e.g.
	// while the agent process is alive) without losing the reason.
	server.setUpdateSessionCwdCallback(async (sessionId: string, newCwd: string) => {
		const mainWindow = getWindowForSession?.(sessionId) ?? getMainWindow();
		if (!mainWindow) {
			logger.warn('mainWindow is null for updateSessionCwd', 'WebServer');
			return { success: false, error: 'Desktop window unavailable' };
		}

		return new Promise((resolve) => {
			const responseChannel = `remote:updateSessionCwd:response:${randomUUID()}`;
			let resolved = false;

			const handleResponse = (
				_event: Electron.IpcMainEvent,
				result: { success?: boolean; error?: string } | undefined
			) => {
				if (resolved) return;
				resolved = true;
				clearTimeout(timeoutId);
				resolve({
					success: Boolean(result?.success),
					error: result?.error,
				});
			};

			ipcMain.once(responseChannel, handleResponse);
			if (!isWebContentsAvailable(mainWindow)) {
				logger.warn('webContents is not available for updateSessionCwd', 'WebServer');
				ipcMain.removeListener(responseChannel, handleResponse);
				resolve({ success: false, error: 'Desktop renderer unavailable' });
				return;
			}
			mainWindow.webContents.send('remote:updateSessionCwd', sessionId, newCwd, responseChannel);

			const timeoutId = setTimeout(() => {
				if (resolved) return;
				resolved = true;
				ipcMain.removeListener(responseChannel, handleResponse);
				logger.warn(`updateSessionCwd callback timed out for session ${sessionId}`, 'WebServer');
				resolve({ success: false, error: 'Renderer did not respond in time' });
			}, 5000);
		});
	});

	// Set up callback for web server to update a session's SSH execution
	// config. Mirrors updateSessionCwd's IPC request-response shape; the
	// renderer merges the partial patch and refuses while the agent process
	// is alive (the spawn target is fixed at launch time).
	server.setUpdateSessionSshCallback(
		async (sessionId: string, sshPatch: Record<string, unknown>) => {
			const mainWindow = getMainWindow();
			if (!mainWindow) {
				logger.warn('mainWindow is null for updateSessionSsh', 'WebServer');
				return { success: false, error: 'Desktop window unavailable' };
			}

			return new Promise((resolve) => {
				const responseChannel = `remote:updateSessionSsh:response:${randomUUID()}`;
				let resolved = false;

				const handleResponse = (
					_event: Electron.IpcMainEvent,
					result: { success?: boolean; error?: string } | undefined
				) => {
					if (resolved) return;
					resolved = true;
					clearTimeout(timeoutId);
					resolve({
						success: Boolean(result?.success),
						error: result?.error,
					});
				};

				ipcMain.once(responseChannel, handleResponse);
				if (!isWebContentsAvailable(mainWindow)) {
					logger.warn('webContents is not available for updateSessionSsh', 'WebServer');
					ipcMain.removeListener(responseChannel, handleResponse);
					resolve({ success: false, error: 'Desktop renderer unavailable' });
					return;
				}
				mainWindow.webContents.send(
					'remote:updateSessionSsh',
					sessionId,
					sshPatch,
					responseChannel
				);

				const timeoutId = setTimeout(() => {
					if (resolved) return;
					resolved = true;
					ipcMain.removeListener(responseChannel, handleResponse);
					logger.warn(`updateSessionSsh callback timed out for session ${sessionId}`, 'WebServer');
					resolve({ success: false, error: 'Renderer did not respond in time' });
				}, 5000);
			});
		}
	);

	// Set up callback for web server to update an agent's editable per-session
	// config (nudge/new-session message, custom path/args/env, model, effort,
	// context window, Claude token source). Same IPC request-response shape as
	// updateSessionSsh; the renderer merges the partial patch and flushes to
	// disk. Applied even while the agent runs (these are spawn-time settings).
	server.setUpdateSessionConfigCallback(
		async (sessionId: string, configPatch: Record<string, unknown>) => {
			if ('newShellCommand' in configPatch) {
				let target =
					sessionId === 'active'
						? getMainWindow()
						: (getWindowForSession?.(sessionId) ?? getMainWindow());
				const command = configPatch.newShellCommand as Record<string, unknown> | null;
				if (sessionId === 'active' && command?.action === 'force-send') {
					const matches: Array<{ window: NonNullable<typeof target>; sessionId: string }> = [];
					for (const win of deps.getAppWindows?.() ?? (target ? [target] : [])) {
						if (!isWebContentsAvailable(win))
							return { success: false, error: 'Desktop window unavailable' };
						const found = await requestFromRenderer<{
							success: boolean;
							error?: string;
							data?: { sessionIds?: string[] };
						}>(win, 'remote:updateSessionConfig', {
							args: [
								'active',
								{ newShellCommand: { action: 'locate-queue', itemId: command.itemId } },
							],
							verifySender: true,
							fallback: { success: false, error: 'Desktop did not confirm the queue owner' },
						});
						if (!found.success) return { success: false, error: found.error };
						for (const id of found.data?.sessionIds ?? [])
							matches.push({ window: win, sessionId: id });
					}
					if (matches.length !== 1)
						return { success: false, error: 'Queued item not found or ambiguous' };
					target = matches[0].window;
					sessionId = matches[0].sessionId;
				}
				if (!isWebContentsAvailable(target))
					return { success: false, error: 'Desktop window unavailable' };
				return requestFromRenderer<{
					success: boolean;
					error?: string;
					data?: Record<string, unknown>;
				}>(target, 'remote:updateSessionConfig', {
					args: [sessionId, configPatch],
					verifySender: true,
					timeoutMs: PROJECT_CONVERSATION_TIMEOUT_MS,
					fallback: {
						success: false,
						error: 'Desktop did not confirm the command; it may still be applying',
					},
				});
			}
			const mainWindow = getWindowForSession?.(sessionId) ?? getMainWindow();
			if (!mainWindow) {
				logger.warn('mainWindow is null for updateSessionConfig', 'WebServer');
				return { success: false, error: 'Desktop window unavailable' };
			}

			return new Promise((resolve) => {
				const responseChannel = `remote:updateSessionConfig:response:${randomUUID()}`;
				let resolved = false;

				const handleResponse = (
					_event: Electron.IpcMainEvent,
					result: { success?: boolean; error?: string } | undefined
				) => {
					if (resolved) return;
					resolved = true;
					clearTimeout(timeoutId);
					resolve({
						success: Boolean(result?.success),
						error: result?.error,
					});
				};

				ipcMain.once(responseChannel, handleResponse);
				if (!isWebContentsAvailable(mainWindow)) {
					logger.warn('webContents is not available for updateSessionConfig', 'WebServer');
					ipcMain.removeListener(responseChannel, handleResponse);
					resolve({ success: false, error: 'Desktop renderer unavailable' });
					return;
				}
				mainWindow.webContents.send(
					'remote:updateSessionConfig',
					sessionId,
					configPatch,
					responseChannel
				);

				const timeoutId = setTimeout(() => {
					if (resolved) return;
					resolved = true;
					ipcMain.removeListener(responseChannel, handleResponse);
					logger.warn(
						`updateSessionConfig callback timed out for session ${sessionId}`,
						'WebServer'
					);
					resolve({ success: false, error: 'Renderer did not respond in time' });
				}, 5000);
			});
		}
	);
}
