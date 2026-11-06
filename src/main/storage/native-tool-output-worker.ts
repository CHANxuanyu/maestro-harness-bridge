import { parentPort, workerData } from 'node:worker_threads';
import { readNativeToolOutput } from './native-tool-output-reader';

void readNativeToolOutput(workerData.file, workerData.provider, workerData.toolCallId).then(
	(result) => parentPort?.postMessage(result)
);
