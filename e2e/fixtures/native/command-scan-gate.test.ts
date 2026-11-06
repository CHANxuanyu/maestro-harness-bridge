import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createNativeTempDir } from './temp-root.cjs';
import { holdNativeCommandScan } from './command-scan-gate';

it('holds only the target scan, observes entry, then restores stat and releases pending reads', async () => {
	const root = createNativeTempDir('command-scan-');
	const directory = path.join(root, 'commands');
	await fs.mkdir(directory);
	const original = fs.stat;
	// Playwright serializes this function into a main-process context without require or imports.
	const install = runInNewContext(
		`(${holdNativeCommandScan.toString()})`
	) as typeof holdNativeCommandScan;
	let gate: ReturnType<typeof holdNativeCommandScan> | undefined;
	try {
		gate = install(undefined, directory);
		expect(gate.waiting).toBe(false);
		let completed = false;
		const scan = fs.stat(directory).then((result) => {
			completed = true;
			return result;
		});
		expect(gate.waiting).toBe(true);
		expect((await fs.stat(root)).isDirectory()).toBe(true);
		expect(completed).toBe(false);
		gate.release();
		expect(fs.stat).toBe(original);
		expect((await scan).isDirectory()).toBe(true);
		expect((await fs.stat(directory)).isDirectory()).toBe(true);
	} finally {
		gate?.release();
		await fs.rm(root, { recursive: true, force: true });
	}
});
