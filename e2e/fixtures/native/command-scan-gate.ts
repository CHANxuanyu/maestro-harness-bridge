/** Passed to ElectronApplication.evaluateHandle; all runtime dependencies must stay inside it. */
export function holdNativeCommandScan(_electron: unknown, directory: string) {
	// Static imports cannot cross the evaluateHandle process boundary.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const files: typeof import('node:fs/promises') = require('node:fs/promises');
	const original = files.stat;
	let resume!: () => void;
	let waiting = false;
	const pending = new Promise<void>((resolve) => {
		resume = resolve;
	});
	// Cached-only discovery does not stat. Hold the real scan at one temporary directory.
	files.stat = ((...args: Parameters<typeof original>) => {
		if (args[0] !== directory) return original(...args);
		waiting = true;
		return pending.then(() => original(...args));
	}) as typeof original;
	return {
		get waiting() {
			return waiting;
		},
		release() {
			files.stat = original;
			resume();
		},
	};
}
