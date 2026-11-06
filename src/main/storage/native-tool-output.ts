import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { NativeToolOutputResult } from '../../shared/nativeToolOutput';

let activeReads = 0;

/** No queue or content cache. Bound concurrent memory and tear down each read. */
export async function readToolOutputFile(
	file: string,
	provider: 'claude-code' | 'codex',
	toolCallId: string
): Promise<NativeToolOutputResult> {
	if (activeReads >= 2) return { status: 'busy' };
	activeReads++;
	try {
		return await new Promise<NativeToolOutputResult>((resolve) => {
			const worker = new Worker(path.join(__dirname, 'native-tool-output-worker.js'), {
				workerData: { file, provider, toolCallId },
				resourceLimits: { maxOldGenerationSizeMb: 512 },
			});
			let settled = false;
			const finish = (result: NativeToolOutputResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				void worker.terminate().then(
					() => resolve(result),
					() => resolve(result)
				);
			};
			const timer = setTimeout(() => finish({ status: 'unavailable' }), 30000);
			worker.once('message', finish);
			worker.once('error', () => finish({ status: 'unavailable' }));
			worker.once('exit', () => finish({ status: 'unavailable' }));
		});
	} catch {
		return { status: 'unavailable' };
	} finally {
		activeReads--;
	}
}
