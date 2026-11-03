import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import type { TestInfo } from '@playwright/test';

const idle = vi.hoisted(() => ({ wait: vi.fn() }));
vi.mock('@playwright/test', async (original) => ({
	...(await original<typeof import('@playwright/test')>()),
	expect: () => ({ toHaveCount: idle.wait }),
}));
import { NativeApp } from '../native-app';

let native: NativeApp;
afterEach(() => {
	fs.rmSync(native.root, { recursive: true, force: true });
});

it('normal teardown waits for the native writer after its final answer', async () => {
	native = new NativeApp({ title: 'codex a: teardown' } as TestInfo);
	let release!: () => void;
	idle.wait.mockReturnValue(
		new Promise<void>((resolve) => {
			release = resolve;
		})
	);
	const stop = vi.fn().mockResolvedValue(undefined);
	const close = vi.fn().mockResolvedValue(undefined);
	native.page = { getByTestId: vi.fn() } as any;
	native.app = { context: () => ({ tracing: { stop } }), close } as any;
	const closing = native.close();
	await Promise.resolve();
	try {
		expect(idle.wait).toHaveBeenCalledWith(0);
		expect(close).not.toHaveBeenCalled();
	} finally {
		release();
		await closing;
	}
	expect(close).toHaveBeenCalledOnce();
});
