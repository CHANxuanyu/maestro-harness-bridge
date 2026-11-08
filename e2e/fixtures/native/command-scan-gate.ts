import type { NativeCommandRequest } from '../../../src/shared/nativeCommands';

/** Passed to ElectronApplication.evaluateHandle; only its arguments cross the process boundary. */
export function holdNativeCommandScan(
	{ ipcMain }: Pick<typeof import('electron'), 'ipcMain'>,
	target: { cwd: string; accountDir: string }
) {
	const channel = 'agents:getNativeCommands';
	// Electron has no public handler getter. Keep this internal registry access in the test fixture.
	const handlers = (
		ipcMain as typeof ipcMain & {
			_invokeHandlers?: Map<string, Parameters<typeof ipcMain.handle>[1]>;
		}
	)._invokeHandlers;
	const original = handlers?.get(channel);
	if (!original)
		throw new Error(`Cannot hold scan: Electron IPC handler ${channel} is unavailable`);
	let resume!: () => void;
	let waiting = false;
	let released = false;
	const pending = new Promise<void>((resolve) => {
		resume = resolve;
	});
	ipcMain.removeHandler(channel);
	ipcMain.handle(channel, async (event, ...args) => {
		const [request, cachedOnly] = args as [NativeCommandRequest, boolean?];
		if (
			!released &&
			!cachedOnly &&
			'toolType' in request &&
			request.toolType === 'claude-code' &&
			request.cwd === target.cwd &&
			request.customEnvVars?.CLAUDE_CONFIG_DIR === target.accountDir &&
			!request.sessionSshRemoteConfig?.enabled
		) {
			waiting = true;
			await pending;
		}
		return original(event, ...args);
	});
	return {
		get waiting() {
			return waiting;
		},
		release() {
			if (released) return;
			released = true;
			try {
				ipcMain.removeHandler(channel);
				ipcMain.handle(channel, original);
			} finally {
				resume();
			}
		},
	};
}
