import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	confirmQuitAfterSave,
	registerQuitSave,
	QUIT_SAVE_TIMEOUT_MS,
} from '../../../renderer/services/quitSave';

describe('confirmQuitAfterSave', () => {
	const order: string[] = [];
	let unregister: () => void = () => {};

	beforeEach(() => {
		order.length = 0;
		(window as any).maestro = {
			...((window as any).maestro || {}),
			app: { confirmQuit: vi.fn(() => order.push('confirmQuit')) },
		};
	});

	afterEach(() => {
		unregister();
		vi.useRealTimers();
	});

	it('confirms at once when nothing is registered', () => {
		void confirmQuitAfterSave();
		expect(order).toEqual(['confirmQuit']);
	});

	it('waits for the registered save before confirming', async () => {
		let finish: () => void = () => {};
		unregister = registerQuitSave(
			() =>
				new Promise<void>((resolve) => {
					finish = () => {
						order.push('saved');
						resolve();
					};
				})
		);
		const quitting = confirmQuitAfterSave();
		await Promise.resolve();
		expect(order).toEqual([]);
		finish();
		await quitting;
		expect(order).toEqual(['saved', 'confirmQuit']);
	});

	it('still quits when the save fails', async () => {
		unregister = registerQuitSave(async () => {
			throw new Error('disk gone');
		});
		await confirmQuitAfterSave();
		expect(order).toEqual(['confirmQuit']);
	});

	it('still quits when the save never settles', async () => {
		vi.useFakeTimers();
		unregister = registerQuitSave(() => new Promise<void>(() => {}));
		const quitting = confirmQuitAfterSave();
		await vi.advanceTimersByTimeAsync(QUIT_SAVE_TIMEOUT_MS - 1);
		expect(order).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		await quitting;
		expect(order).toEqual(['confirmQuit']);
	});

	it('only the current registration can unregister itself', () => {
		const first = registerQuitSave(async () => {});
		unregister = registerQuitSave(async () => {
			order.push('second');
		});
		first();
		void confirmQuitAfterSave();
		expect(order).toEqual(['second']);
	});
});
