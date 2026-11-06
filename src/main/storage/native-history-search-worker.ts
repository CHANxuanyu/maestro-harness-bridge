import { parentPort, workerData } from 'node:worker_threads';
import { searchNativeHistoryFiles } from './native-history-search-reader';
void searchNativeHistoryFiles(workerData).then((result) => parentPort?.postMessage(result));
