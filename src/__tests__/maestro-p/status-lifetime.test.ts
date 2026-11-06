import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startStatusLifetime } from '../../maestro-p/status-lifetime';

describe('status lifetime', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function watch(parentPpid = 42, deadlineMs = 28_000) {
		const getPpid = vi.fn(() => parentPpid);
		const isProcessAlive = vi.fn(() => true);
		const onEnd = vi.fn();
		const lifetime = startStatusLifetime({
			parentPpid,
			deadlineMs,
			getPpid,
			isProcessAlive,
			onEnd,
		});
		return { ...lifetime, getPpid, isProcessAlive, onEnd };
	}

	it('fires the deadline exactly once', () => {
		const life = watch();
		vi.advanceTimersByTime(27_999);
		expect(life.onEnd).not.toHaveBeenCalled();
		vi.advanceTimersByTime(60_000);
		expect(life.onEnd.mock.calls).toEqual([['deadline']]);
	});

	it('detects POSIX reparenting', () => {
		const life = watch();
		life.getPpid.mockReturnValue(1);
		vi.advanceTimersByTime(1000);
		expect(life.onEnd.mock.calls).toEqual([['parent-gone']]);
	});

	it('detects ESRCH with an unchanged ppid', () => {
		const life = watch();
		life.isProcessAlive.mockImplementation(() => {
			throw Object.assign(new Error('gone'), { code: 'ESRCH' });
		});
		vi.advanceTimersByTime(1000);
		expect(life.isProcessAlive).toHaveBeenCalledWith(42);
		expect(life.onEnd.mock.calls).toEqual([['parent-gone']]);
	});

	it('counts EPERM as alive', () => {
		const life = watch();
		life.isProcessAlive.mockImplementation(() => {
			throw Object.assign(new Error('denied'), { code: 'EPERM' });
		});
		vi.advanceTimersByTime(5000);
		expect(life.onEnd).not.toHaveBeenCalled();
	});

	it.each([0, 1])('never treats captured ppid %i as a lost parent', (parentPpid) => {
		const life = watch(parentPpid);
		life.getPpid.mockReturnValue(99);
		life.isProcessAlive.mockReturnValue(false);
		vi.advanceTimersByTime(5000);
		expect(life.onEnd).not.toHaveBeenCalled();
		expect(life.isProcessAlive).not.toHaveBeenCalled();
	});

	it('disarms both the parent poll and deadline', () => {
		const life = watch();
		life.disarm();
		life.disarm();
		life.getPpid.mockReturnValue(1);
		vi.advanceTimersByTime(60_000);
		expect(life.getPpid).not.toHaveBeenCalled();
		expect(life.onEnd).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('reports one outcome when deadline and parent loss coincide', () => {
		const life = watch(42, 1000);
		life.getPpid.mockReturnValue(1);
		vi.advanceTimersByTime(60_000);
		expect(life.onEnd).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});
