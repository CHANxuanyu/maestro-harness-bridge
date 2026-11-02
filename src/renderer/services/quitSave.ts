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

/** Register the flush that must land before quit. Returns an unregister. */
export function registerQuitSave(save: () => Promise<void>): () => void {
	saveBeforeQuit = save;
	return () => {
		if (saveBeforeQuit === save) saveBeforeQuit = null;
	};
}

/** Save pending agent changes, then tell main the quit is confirmed. */
export async function confirmQuitAfterSave(): Promise<void> {
	const save = saveBeforeQuit;
	if (save) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				save(),
				new Promise<void>((resolve) => {
					timer = setTimeout(() => {
						logger.warn('[Persistence] save before quit timed out; quitting anyway');
						resolve();
					}, QUIT_SAVE_TIMEOUT_MS);
				}),
			]);
		} catch (err) {
			logger.warn('[Persistence] save before quit failed; quitting anyway', undefined, err);
		} finally {
			clearTimeout(timer);
		}
	}
	window.maestro.app.confirmQuit();
}
