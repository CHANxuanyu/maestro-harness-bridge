import { ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { generateUUID } from '../../shared/uuid';
import { logger } from '../utils/logger';

const LOG_CONTEXT = '[Windows]';

/** How long a move or window close waits for the old owner's save before going ahead without it. */
export const HANDOVER_SAVE_TIMEOUT_MS = 3000;

/**
 * Ask a window to write its pending changes before an agent leaves it or the
 * window closes. A window saves only the agents it owns, so this is the last
 * moment those changes can land. It reuses the quit save's request, which every window already answers,
 * matched here by its own id. Always resolves: a stuck window must not hold up
 * the move.
 */
export function requestHandoverSave(contents: WebContents): Promise<void> {
	return new Promise((resolve) => {
		const requestId = generateUUID();
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			ipcMain.removeListener('app:quitSaveComplete', onComplete);
			contents.removeListener('destroyed', finish);
			contents.removeListener('render-process-gone', finish);
			resolve();
		};
		const onComplete = (event: IpcMainEvent, id: unknown, saved: unknown) => {
			if (id !== requestId || event.sender !== contents || typeof saved !== 'boolean') return;
			if (saved !== true) logger.warn('Save before handover failed', LOG_CONTEXT);
			finish();
		};
		const timeout = setTimeout(() => {
			logger.warn('Save before handover timed out', LOG_CONTEXT);
			finish();
		}, HANDOVER_SAVE_TIMEOUT_MS);
		ipcMain.on('app:quitSaveComplete', onComplete);
		contents.once('destroyed', finish);
		contents.once('render-process-gone', finish);
		try {
			contents.send('app:requestQuitSave', requestId);
		} catch {
			finish();
		}
	});
}
