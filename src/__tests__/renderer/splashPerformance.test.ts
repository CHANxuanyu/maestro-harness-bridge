// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('records document, ready and splash removal separately while waiting for fonts', async () => {
	const marks: string[] = [];
	const timers: (() => void)[] = [];
	let fontsReady!: () => void;
	const splash = { classList: { add: vi.fn() }, parentNode: { removeChild: vi.fn() } };
	const window: Record<string, any> = { addEventListener: vi.fn() };
	runInNewContext(readFileSync('src/renderer/public/splash.js', 'utf8'), {
		window,
		performance: { mark: (name: string) => marks.push(name) },
		console,
		document: {
			getElementById: (id: string) => (id === 'initial-splash' ? splash : null),
			fonts: {
				ready: new Promise<void>((resolve) => {
					fontsReady = resolve;
				}),
			},
		},
		setInterval: vi.fn(),
		clearInterval: vi.fn(),
		setTimeout: (callback: () => void) => {
			timers.push(callback);
		},
	});
	expect(marks).toEqual(['maestro:renderer.document']);
	window.__hideSplash();
	expect(marks).toEqual(['maestro:renderer.document', 'maestro:renderer.ready']);
	expect(timers).toHaveLength(0);
	fontsReady();
	await Promise.resolve();
	timers.shift()!();
	expect(splash.classList.add).toHaveBeenCalledWith('hidden');
	expect(splash.parentNode.removeChild).not.toHaveBeenCalled();
	timers.shift()!();
	expect(splash.parentNode.removeChild).toHaveBeenCalledWith(splash);
	expect(marks.at(-1)).toBe('maestro:renderer.splashRemoved');
});
