import { describe, it, expect } from 'vitest';
import { createPendingSessionPatches } from '../../../main/stores/pending-session-patches';

describe('createPendingSessionPatches', () => {
	it('restores a patched field on a stale copy and stops guarding once caught up', () => {
		const guard = createPendingSessionPatches();
		guard.note('a', { customArgs: '--new' }, { customArgs: '--old' });
		expect(guard.apply({ id: 'a', customArgs: '--old', name: 'kept' })).toEqual({
			id: 'a',
			customArgs: '--new',
			name: 'kept',
		});
		expect(guard.apply({ id: 'a', customArgs: '--new' })).toEqual({ id: 'a', customArgs: '--new' });
		// No longer guarded: the window may now set the old value deliberately.
		expect(guard.apply({ id: 'a', customArgs: '--old' })).toEqual({ id: 'a', customArgs: '--old' });
	});

	it('lets a newer value from the window win and leaves other agents alone', () => {
		const guard = createPendingSessionPatches();
		guard.note('a', { customArgs: '--new' }, { customArgs: undefined });
		expect(guard.apply({ id: 'b', customArgs: undefined })).toEqual({
			id: 'b',
			customArgs: undefined,
		});
		expect(guard.apply({ id: 'a', customArgs: '--mine' })).toEqual({
			id: 'a',
			customArgs: '--mine',
		});
		expect(guard.apply({ id: 'a' })).toEqual({ id: 'a' });
	});

	it('treats a missing field as the cleared value and compares objects by content', () => {
		const guard = createPendingSessionPatches();
		guard.note('a', { customEnvVars: { B: '2', A: '1' } }, { customEnvVars: undefined });
		expect(guard.apply({ id: 'a' })).toEqual({ id: 'a', customEnvVars: { B: '2', A: '1' } });
		// Same content in another key order means the window has caught up.
		const caughtUp = { id: 'a', customEnvVars: { A: '1', B: '2' } };
		expect(guard.apply(caughtUp)).toBe(caughtUp);
		expect(guard.apply({ id: 'a' })).toEqual({ id: 'a' });
	});

	it('guards against both earlier values when a second patch lands before the window catches up', () => {
		const guard = createPendingSessionPatches();
		guard.note('a', { customArgs: '--one' }, { customArgs: '--zero' });
		guard.note('a', { customArgs: '--two' }, { customArgs: '--one' });
		expect(guard.apply({ id: 'a', customArgs: '--zero' }).customArgs).toBe('--two');
		expect(guard.apply({ id: 'a', customArgs: '--one' }).customArgs).toBe('--two');
		expect(guard.apply({ id: 'a', customArgs: '--two' }).customArgs).toBe('--two');
	});

	it('forgets a rolled back patch and keeps only the newest entries past its limit', () => {
		const guard = createPendingSessionPatches(2);
		guard.note('a', { customArgs: '--a' }, { customArgs: '--x' });
		guard.forget(['a']);
		expect(guard.apply({ id: 'a', customArgs: '--x' }).customArgs).toBe('--x');
		guard.note('b', { customArgs: '--b' }, { customArgs: '--x' });
		guard.note('c', { customArgs: '--c' }, { customArgs: '--x' });
		guard.note('d', { customArgs: '--d' }, { customArgs: '--x' });
		expect(guard.apply({ id: 'b', customArgs: '--x' }).customArgs).toBe('--x');
		expect(guard.apply({ id: 'd', customArgs: '--x' }).customArgs).toBe('--d');
	});
});
