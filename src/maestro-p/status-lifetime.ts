import { createIdleWatchdog } from '../main/utils/idle-watchdog';

// Above STATUS_RETRY_DEADLINE_MS + QUIT_GRACE_MS (27s), below the sampler's
// 30s DEFAULT_TIMEOUT_MS minus terminate()'s 1s grace (29s).
export const STATUS_LIFETIME_MS = 28_000;

interface StatusLifetimeOptions {
	parentPpid: number;
	getPpid: () => number;
	isProcessAlive: (pid: number) => boolean;
	onEnd: (reason: 'deadline' | 'parent-gone') => void;
	deadlineMs?: number;
}

/** Bound a status probe even when its caller's execFile timer disappears. */
export function startStatusLifetime(options: StatusLifetimeOptions): { disarm(): void } {
	const { parentPpid, getPpid, isProcessAlive, onEnd, deadlineMs = STATUS_LIFETIME_MS } = options;
	let settled = false;
	let parentTimer: ReturnType<typeof setInterval> | undefined;
	const disarm = (): void => {
		settled = true;
		watchdog.disarm();
		if (parentTimer) clearInterval(parentTimer);
	};
	const finish = (reason: 'deadline' | 'parent-gone'): void => {
		if (settled) return;
		disarm();
		onEnd(reason);
	};
	// Wall clock on purpose: the caller budgets total time, and a parked TUI
	// may repaint forever. Never touch this watchdog to extend a silence budget.
	const watchdog = createIdleWatchdog({
		idleMs: deadlineMs,
		maxMs: deadlineMs,
		onIdle: () => finish('deadline'),
	});
	// PID 0 addresses a process group; PID 1 may be launchd/init. Neither gives
	// reliable parent-liveness evidence, so only the deadline applies to them.
	if (parentPpid > 1) {
		parentTimer = setInterval(() => {
			let alive = true;
			try {
				alive = isProcessAlive(parentPpid);
			} catch (error) {
				// EPERM (and any unknown error) is not evidence of parent death.
				alive = (error as NodeJS.ErrnoException).code !== 'ESRCH';
			}
			if (getPpid() !== parentPpid || !alive) finish('parent-gone');
		}, 1000);
		parentTimer.unref();
	}
	return { disarm };
}
