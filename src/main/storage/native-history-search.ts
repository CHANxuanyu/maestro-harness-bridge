import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { NativeHistorySearchResult } from '../../shared/nativeHistorySearch';
import type { NativeHistorySearchInput } from './native-history-search-reader';

let activeSearches = 0;
/** Hard cancellation and deadline also cover a stalled filesystem operation. */
export async function runNativeHistorySearch(
	input: NativeHistorySearchInput,
	signal?: AbortSignal
): Promise<NativeHistorySearchResult> {
	if (signal?.aborted) return { hits: [], truncated: false, cancelled: true };
	if (activeSearches >= 2) return { hits: [], truncated: false, unavailable: true };
	activeSearches++;
	try {
		return await new Promise<NativeHistorySearchResult>((resolve) => {
			const worker = new Worker(path.join(__dirname, 'native-history-search-worker.js'), {
				workerData: input,
				resourceLimits: { maxOldGenerationSizeMb: 256 },
			});
			let settled = false;
			const finish = (result: NativeHistorySearchResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener('abort', cancel);
				void worker.terminate().then(
					() => resolve(result),
					() => resolve(result)
				);
			};
			const cancel = () => finish({ hits: [], truncated: false, cancelled: true });
			const timer = setTimeout(() => finish({ hits: [], truncated: true, limited: true }), 4000);
			signal?.addEventListener('abort', cancel, { once: true });
			worker.once('message', finish);
			worker.once('error', () => finish({ hits: [], truncated: false, unavailable: true }));
			worker.once('exit', () => finish({ hits: [], truncated: false, unavailable: true }));
			if (signal?.aborted) cancel();
		});
	} catch {
		return { hits: [], truncated: false, unavailable: true };
	} finally {
		activeSearches--;
	}
}
