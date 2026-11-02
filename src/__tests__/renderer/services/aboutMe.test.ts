import { describe, expect, it } from 'vitest';
import {
	aboutMeConfirmationFor,
	aboutMeFilesToWrite,
	aboutMeNeedsConsent,
	keepCurrentConfirmations,
	summarizeAboutMeApply,
} from '../../../renderer/services/aboutMe';
import type { AboutMeFileStatus, AboutMeResult } from '../../../shared/aboutMe';

const BLOCK = '<!-- maestro:about-me:start -->\nOld\n<!-- maestro:about-me:end -->';

function file(overrides: Partial<AboutMeFileStatus>): AboutMeFileStatus {
	const path = overrides.path ?? '/accounts/claude/CLAUDE.md';
	return {
		path,
		aliases: [path],
		providers: ['claude-code'],
		agentIds: [],
		resolvedPath: path,
		currentBlock: null,
		state: 'synced',
		shadowedBy: [],
		...overrides,
	};
}

function result(overrides: Partial<AboutMeResult>): AboutMeResult {
	return { success: true, content: 'Profile', estimatedTokens: 2, files: [], ...overrides };
}

describe('aboutMeNeedsConsent', () => {
	it('asks before a first write, a foreign section and an outside edit', () => {
		expect(aboutMeNeedsConsent(file({ state: 'unconfirmed' }))).toBe(true);
		expect(aboutMeNeedsConsent(file({ state: 'unconfirmed', currentBlock: BLOCK }))).toBe(true);
		expect(aboutMeNeedsConsent(file({ state: 'external-change', currentBlock: BLOCK }))).toBe(true);
	});

	it('does not ask for a file Maestro already owns or cannot write', () => {
		for (const state of [
			'synced',
			'pending',
			'missing-directory',
			'invalid-block',
			'error',
		] as const)
			expect(aboutMeNeedsConsent(file({ state }))).toBe(false);
		// A file whose target could not be resolved cannot be confirmed either.
		expect(aboutMeNeedsConsent(file({ state: 'unconfirmed', resolvedPath: undefined }))).toBe(
			false
		);
	});
});

describe('aboutMeConfirmationFor', () => {
	it('copies the snapshot the user was shown, with no block as null', () => {
		const link = file({
			path: '/accounts/codex/AGENTS.md',
			resolvedPath: '/notes/agents.md',
			state: 'unconfirmed',
			currentBlock: undefined,
		});
		expect(aboutMeConfirmationFor(link)).toEqual({
			path: '/accounts/codex/AGENTS.md',
			resolvedPath: '/notes/agents.md',
			block: null,
		});
		expect(
			aboutMeConfirmationFor(file({ state: 'external-change', currentBlock: BLOCK })).block
		).toBe(BLOCK);
	});
});

describe('keepCurrentConfirmations', () => {
	it('drops a confirmation once the file shows a different section or target', () => {
		const shown = file({ state: 'external-change', currentBlock: BLOCK });
		const confirmed = { [shown.path]: aboutMeConfirmationFor(shown) };
		expect(keepCurrentConfirmations(confirmed, [shown])).toEqual(confirmed);
		const editedAgain = { ...shown, currentBlock: BLOCK.replace('Old', 'Newer') };
		expect(keepCurrentConfirmations(confirmed, [editedAgain])).toEqual({});
		const relinked = { ...shown, resolvedPath: '/elsewhere/CLAUDE.md' };
		expect(keepCurrentConfirmations(confirmed, [relinked])).toEqual({});
	});

	it('drops a confirmation for a file that no longer needs one or is gone', () => {
		const shown = file({ state: 'unconfirmed' });
		const confirmed = { [shown.path]: aboutMeConfirmationFor(shown) };
		expect(keepCurrentConfirmations(confirmed, [{ ...shown, state: 'synced' }])).toEqual({});
		expect(keepCurrentConfirmations(confirmed, [])).toEqual({});
	});
});

describe('aboutMeFilesToWrite', () => {
	it('counts owned files that need an update plus the ones the user approved', () => {
		const owned = file({ path: '/a/CLAUDE.md', state: 'pending' });
		const approved = file({ path: '/b/CLAUDE.md', state: 'unconfirmed' });
		const notApproved = file({ path: '/c/CLAUDE.md', state: 'unconfirmed' });
		const done = file({ path: '/d/CLAUDE.md', state: 'synced' });
		const files = [owned, approved, notApproved, done];
		expect(
			aboutMeFilesToWrite(files, { [approved.path]: aboutMeConfirmationFor(approved) })
		).toEqual([owned, approved]);
	});
});

describe('summarizeAboutMeApply', () => {
	it('keeps what was written apart from what still needs attention', () => {
		const written = file({ path: '/a/CLAUDE.md', state: 'synced', currentBlock: BLOCK });
		const waiting = file({ path: '/b/CLAUDE.md', state: 'unconfirmed' });
		const broken = file({ path: '/c/CLAUDE.md', state: 'invalid-block', currentBlock: undefined });
		const missing = file({
			path: '/d/AGENTS.md',
			state: 'missing-directory',
			currentBlock: undefined,
		});
		const outcome = summarizeAboutMeApply(
			result({
				success: false,
				code: 'file-error',
				files: [written, waiting, broken, missing],
				written: ['/a/CLAUDE.md'],
			})
		);
		expect(outcome.written).toEqual(['/a/CLAUDE.md']);
		expect(outcome.waiting).toEqual([waiting]);
		expect(outcome.failed).toEqual([broken]);
		expect(outcome.skipped).toEqual([missing]);
		expect(outcome.unrecorded).toEqual([]);
		expect(outcome.profileChanged).toBe(false);
	});

	it('reports a file that was written but whose ownership record failed', () => {
		const unrecorded = file({
			path: '/a/CLAUDE.md',
			state: 'error',
			error: 'disk full',
			currentBlock: BLOCK,
		});
		const outcome = summarizeAboutMeApply(
			result({ success: false, code: 'file-error', files: [unrecorded], written: ['/a/CLAUDE.md'] })
		);
		expect(outcome.written).toEqual(['/a/CLAUDE.md']);
		expect(outcome.unrecorded).toEqual([unrecorded]);
		expect(outcome.failed).toEqual([]);
	});

	it('marks a profile that changed underneath the apply, and a refused request', () => {
		expect(
			summarizeAboutMeApply(result({ success: false, code: 'profile-changed', written: [] }))
				.profileChanged
		).toBe(true);
		expect(
			summarizeAboutMeApply(
				result({ success: false, code: 'invalid-request', error: 'Invalid About Me command' })
			).error
		).toBe('Invalid About Me command');
	});
});
