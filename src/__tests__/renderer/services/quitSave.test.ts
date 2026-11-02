import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	answerQuitSaveRequests,
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

// After a confirmed quit, main asks EVERY app window to save and waits for each
// answer before cleanup. A window that never answers holds the quit for main's
// whole deadline, and one that answers "saved" without saving loses the tail.
describe('answerQuitSaveRequests', () => {
	let handed: (() => void | Promise<void>) | undefined;
	const dispose = vi.fn();
	let unregister: () => void = () => {};

	beforeEach(() => {
		handed = undefined;
		dispose.mockClear();
		(window as any).maestro = {
			...((window as any).maestro || {}),
			app: {
				...((window as any).maestro?.app || {}),
				onQuitSaveRequest: vi.fn((save: () => void | Promise<void>) => {
					handed = save;
					return dispose;
				}),
			},
		};
	});

	afterEach(() => {
		unregister();
		vi.useRealTimers();
	});

	it('answers through the preload and hands back its disposer', () => {
		const stop = answerQuitSaveRequests();
		expect(window.maestro.app.onQuitSaveRequest).toHaveBeenCalledTimes(1);
		stop();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it('runs the registered save and settles only after it lands', async () => {
		const order: string[] = [];
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
		answerQuitSaveRequests();
		const answered = Promise.resolve(handed!()).then(() => order.push('answered'));
		await Promise.resolve();
		expect(order).toEqual([]);
		finish();
		await answered;
		expect(order).toEqual(['saved', 'answered']);
	});

	it('uses the save registered when the request arrives', async () => {
		const order: string[] = [];
		answerQuitSaveRequests();
		unregister = registerQuitSave(async () => {
			order.push('current');
		});
		await handed!();
		expect(order).toEqual(['current']);
	});

	it('answers at once when this window has nothing to save', async () => {
		answerQuitSaveRequests();
		await expect(Promise.resolve(handed!())).resolves.toBeUndefined();
	});

	it('reports a failed save as not saved', async () => {
		unregister = registerQuitSave(async () => {
			throw new Error('disk gone');
		});
		answerQuitSaveRequests();
		await expect(Promise.resolve(handed!())).rejects.toThrow('disk gone');
	});

	it('reports a save that never settles as not saved once the bound passes', async () => {
		vi.useFakeTimers();
		unregister = registerQuitSave(() => new Promise<void>(() => {}));
		answerQuitSaveRequests();
		const answer = Promise.resolve(handed!());
		const outcome = answer.then(
			() => 'saved',
			() => 'not saved'
		);
		await vi.advanceTimersByTimeAsync(QUIT_SAVE_TIMEOUT_MS - 1);
		let settled = false;
		void outcome.then(() => (settled = true));
		await Promise.resolve();
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await expect(outcome).resolves.toBe('not saved');
	});
});
