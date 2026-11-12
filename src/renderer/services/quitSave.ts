/**
 * quitSave - confirm a quit only once the agent tree is on disk.
 *
 * The renderer saves agents behind a 2 s debounce (`useDebouncedPersistence`).
 * On a confirmed quit, main runs its cleanup and hard-exits without ever
 * closing the window (`app-lifecycle/quit-handler.ts`), so neither that timer
 * nor `beforeunload` gets another chance: whatever changed in the last two
 * seconds was simply gone after restart. In practice that was the reply that
 * landed just before the user quit, leaving a tab with the prompt and no
 * answer.
 *
 * The persistence hook registers its flush here, and every path that confirms
 * a quit (no busy work, the quit-confirmation modal, quit-when-idle) goes
 * through `confirmQuitAfterSave()`. Do NOT call
 * `window.maestro.app.confirmQuit()` directly.
 *
 * That covers the window that confirmed. Once a quit is confirmed, main also
 * asks EVERY app window to save (`app:requestQuitSave`) and waits for each
 * answer, five seconds in all, before its cleanup. `answerQuitSaveRequests()`
 * is each window's answer, mounted by the same persistence hook.
 * Agent moves and window closes reuse that request. The input hook registers
 * draft preparation here so both entry points land live text in the session
 * store synchronously before persistence takes its snapshot.
 */

import { logger } from '../utils/logger';

/**
 * Upper bound on the save before quit goes ahead anyway. A write that never
 * settles means main is wedged; the user asked to quit, so that must still
 * happen. Main's own dead-renderer timeout is disarmed while the confirmation
 * modal is up, so this is the only bound on that path.
 */
export const QUIT_SAVE_TIMEOUT_MS = 3000;

let saveBeforeQuit: (() => Promise<void>) | null = null;
let prepareQuitSave: (() => void) | null = null;

/** Land live composer drafts in the session store before the registered save reads it. */
export function registerQuitSavePreparation(prepare: () => void): () => void {
	prepareQuitSave = prepare;
	return () => {
		if (prepareQuitSave === prepare) prepareQuitSave = null;
	};
}

/** Register the flush that must land before quit. Returns an unregister. */
export function registerQuitSave(save: () => Promise<void>): () => void {
	saveBeforeQuit = save;
	return () => {
		if (saveBeforeQuit === save) saveBeforeQuit = null;
	};
}

/**
 * Run the registered save. Rejects when it fails or does not settle within
 * QUIT_SAVE_TIMEOUT_MS, so a caller can tell a save from a give-up.
 */
export async function flushPendingSessionSave(): Promise<void> {
	const save = saveBeforeQuit;
	if (!save) return Promise.resolve();
	prepareQuitSave?.();
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		save(),
		new Promise<void>((_, reject) => {
			timer = setTimeout(() => reject(new QuitSaveTimeoutError()), QUIT_SAVE_TIMEOUT_MS);
		}),
	]).finally(() => clearTimeout(timer));
}

class QuitSaveTimeoutError extends Error {
	constructor() {
		super('save before quit timed out');
	}
}

/** Save pending agent changes, then tell main the quit is confirmed. */
export async function confirmQuitAfterSave(): Promise<void> {
	// With nothing to save, confirm in the same tick, as before.
	if (saveBeforeQuit) {
		try {
			await flushPendingSessionSave();
		} catch (err) {
			if (err instanceof QuitSaveTimeoutError)
				logger.warn('[Persistence] save before quit timed out; quitting anyway');
			else logger.warn('[Persistence] save before quit failed; quitting anyway', undefined, err);
		}
	}
	window.maestro.app.confirmQuit();
}

/**
 * Answer main's save request for this window. A window with nothing registered
 * answers at once, because one that stays silent holds every quit for main's
 * whole deadline. A failed or hung save is answered as not saved (the preload
 * reports a rejection as `false`), never as saved. Returns the unsubscribe.
 */
export function answerQuitSaveRequests(): () => void {
	return window.maestro.app.onQuitSaveRequest(flushPendingSessionSave);
}
