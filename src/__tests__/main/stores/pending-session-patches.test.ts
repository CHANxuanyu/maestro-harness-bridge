import { describe, it, expect } from 'vitest';
import { createPendingSessionPatches } from '../../../main/stores/pending-session-patches';

describe('createPendingSessionPatches', () => {
	it('stamps the next revision after the stored one', () => {
		const guard = createPendingSessionPatches();
		expect(guard.nextRevision(undefined)).toBe(1);
		expect(guard.nextRevision({ configRevision: 4 })).toBe(5);
		expect(guard.nextRevision({ configRevision: 'x' })).toBe(1);
	});

	it('takes patched fields from disk for an older copy and keeps its other edits', () => {
		const guard = createPendingSessionPatches();
		guard.note('a', 1, ['customArgs', 'customEnvVars']);
		const stored = { id: 'a', configRevision: 1, customArgs: '--new', customEnvVars: { A: '1' } };
		expect(guard.apply({ id: 'a', customArgs: '--old', name: 'renamed' }, stored)).toEqual({
			id: 'a',
			customArgs: '--new',
			customEnvVars: { A: '1' },
			configRevision: 1,
			name: 'renamed',
		});
	});

	it('lets a copy at the current revision win, including a return to the old value', () => {
		const guard = createPendingSessionPatches();
		guard.note('a', 2, ['customArgs']);
		const stored = { id: 'a', configRevision: 2, customArgs: '--new' };
		const deliberate = { id: 'a', configRevision: 2, customArgs: '--old' };
		expect(guard.apply(deliberate, stored)).toBe(deliberate);
		// Guard released: an unstamped copy is no longer overridden.
		const later = { id: 'a', customArgs: '--other' };
		expect(guard.apply(later, stored)).toBe(later);
	});

	it('accumulates fields across patches and leaves other agents alone', () => {
		const guard = createPendingSessionPatches();
		guard.note('a', 1, ['customArgs']);
		guard.note('a', 2, ['customPath']);
		const stored = { id: 'a', configRevision: 2, customArgs: '--x', customPath: '/p' };
		expect(guard.apply({ id: 'a', configRevision: 1 }, stored)).toEqual({
			id: 'a',
			configRevision: 2,
			customArgs: '--x',
			customPath: '/p',
		});
		const other = { id: 'b', customArgs: '--b' };
		expect(guard.apply(other, undefined)).toBe(other);
	});

	it('forgets a rolled back patch and keeps only the newest entries past its limit', () => {
		const guard = createPendingSessionPatches(2);
		guard.note('a', 1, ['customArgs']);
		guard.forget(['a']);
		const stale = { id: 'a', customArgs: '--old' };
		expect(guard.apply(stale, { id: 'a', configRevision: 1, customArgs: '--new' })).toBe(stale);
		guard.note('b', 1, ['customArgs']);
		guard.note('c', 1, ['customArgs']);
		guard.note('d', 1, ['customArgs']);
		const b = { id: 'b', customArgs: '--old' };
		expect(guard.apply(b, { id: 'b', configRevision: 1, customArgs: '--new' })).toBe(b);
		expect(
			guard.apply(
				{ id: 'd', customArgs: '--old' },
				{ id: 'd', configRevision: 1, customArgs: '--d' }
			).customArgs
		).toBe('--d');
	});
});
