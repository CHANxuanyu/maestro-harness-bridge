/**
 * About Me in the renderer: which native instruction files need the user's OK,
 * the confirmation snapshot an apply carries, what one apply did, and what an
 * agent's system prompt says in place of the profile.
 *
 * The Markdown itself is `conductorProfile` and is saved through
 * `settingsStore.saveConductorProfile`, which calls the same About Me service
 * as `maestro-cli about-me`. Writing native files is a separate, explicit step:
 * these rules are what the Settings page shows before and after it.
 */

import {
	nativeAboutMePointer,
	type AboutMeConfirmation,
	type AboutMeFileStatus,
	type AboutMeResult,
} from '../../shared/aboutMe';
import { useSettingsStore } from '../stores/settingsStore';
import { captureException } from '../utils/sentry';

/**
 * The About Me text for one agent's system prompt (`{{CONDUCTOR_PROFILE}}`).
 *
 * When the instruction file this agent's provider reads at start already holds
 * the current profile, the prompt names that file instead of repeating it: the
 * model would otherwise get it twice, and Codex's system prompt is embedded in
 * the first user message of its own transcript, where the user sees it. The
 * main process decides with the same environment the spawn uses. Anything
 * short of a clear yes keeps the full profile, so an agent never loses it: an
 * SSH agent (its files are on the remote host), a failed check, a pending or
 * unconfirmed file, or a Codex override that Codex reads instead.
 */
export async function conductorProfileForAgent(agent: {
	toolType?: string;
	customEnvVars?: Record<string, string>;
	sshRemoteId?: string;
	sessionSshRemoteConfig?: { enabled?: boolean } | null;
}): Promise<string> {
	const profile = useSettingsStore.getState().conductorProfile;
	if (!profile || !agent.toolType || agent.sshRemoteId || agent.sessionSshRemoteConfig?.enabled)
		return profile;
	try {
		const result = await window.maestro.settings.aboutMe({
			action: 'native',
			agent: { toolType: agent.toolType, customEnvVars: agent.customEnvVars, sshRemote: false },
		});
		return result.success && result.native?.loaded && result.native.provider
			? nativeAboutMePointer(result.native.provider)
			: profile;
	} catch (error) {
		captureException(error, { extra: { context: 'About Me native check' } });
		return profile;
	}
}

/**
 * A file Maestro may write only after the user approves it: the first write
 * (no ownership record yet, whether or not a section is already there), or a
 * section that changed outside Maestro since it last wrote. Owned files that
 * only need an update (`pending`) are written without asking.
 */
export function aboutMeNeedsConsent(file: AboutMeFileStatus): boolean {
	return (
		(file.state === 'unconfirmed' || file.state === 'external-change') &&
		file.resolvedPath !== undefined
	);
}

/** The snapshot the user approved: the path, its real target and the section shown. */
export function aboutMeConfirmationFor(file: AboutMeFileStatus): AboutMeConfirmation {
	return {
		path: file.path,
		resolvedPath: file.resolvedPath ?? file.path,
		block: file.currentBlock ?? null,
	};
}

/**
 * Keep only approvals that still describe the file as it is now. A section
 * edited again, or a link pointed somewhere else, after the user ticked the box
 * is not what they approved, so the tick is dropped and they decide again.
 */
export function keepCurrentConfirmations(
	confirmed: Record<string, AboutMeConfirmation>,
	files: AboutMeFileStatus[]
): Record<string, AboutMeConfirmation> {
	const kept: Record<string, AboutMeConfirmation> = {};
	for (const [path, confirmation] of Object.entries(confirmed)) {
		const current = files.find((file) => file.path === path);
		if (!current || !aboutMeNeedsConsent(current)) continue;
		const snapshot = aboutMeConfirmationFor(current);
		if (
			snapshot.resolvedPath === confirmation.resolvedPath &&
			snapshot.block === confirmation.block
		)
			kept[path] = confirmation;
	}
	return kept;
}

/** Files the next apply will write: owned ones that are behind, plus approved ones. */
export function aboutMeFilesToWrite(
	files: AboutMeFileStatus[],
	confirmed: Record<string, AboutMeConfirmation>
): AboutMeFileStatus[] {
	return files.filter(
		(file) => file.state === 'pending' || (aboutMeNeedsConsent(file) && !!confirmed[file.path])
	);
}

export interface AboutMeApplyOutcome {
	/** Real targets physically written by this apply. */
	written: string[];
	/** Written, but the ownership record could not be saved afterwards. */
	unrecorded: AboutMeFileStatus[];
	/** Still waiting for the user's OK (or for an update). */
	waiting: AboutMeFileStatus[];
	/** Not written because the file could not be read or its markers are broken. */
	failed: AboutMeFileStatus[];
	/** The account folder does not exist; nothing to write. */
	skipped: AboutMeFileStatus[];
	/** The profile changed in another window or the CLI while this apply ran. */
	profileChanged: boolean;
	/** A refusal that is about the request, not about any one file. */
	error?: string;
}

/**
 * Sort one apply's result for the summary line. An apply is per file and never
 * rolled back, so a failure can still have written some files: those are
 * reported as written and the rest as not done, never as all or nothing.
 */
export function summarizeAboutMeApply(result: AboutMeResult): AboutMeApplyOutcome {
	const written = result.written ?? [];
	const isWritten = (file: AboutMeFileStatus) =>
		!!file.resolvedPath && written.includes(file.resolvedPath);
	const requestError =
		!result.success && (result.code === 'invalid-request' || result.code === 'unavailable');
	return {
		written,
		unrecorded: result.files.filter((file) => file.state === 'error' && isWritten(file)),
		waiting: result.files.filter(
			(file) =>
				file.state === 'pending' || file.state === 'unconfirmed' || file.state === 'external-change'
		),
		failed: result.files.filter(
			(file) => (file.state === 'error' || file.state === 'invalid-block') && !isWritten(file)
		),
		skipped: result.files.filter((file) => file.state === 'missing-directory'),
		profileChanged: result.code === 'profile-changed',
		...(requestError ? { error: result.error ?? '' } : {}),
	};
}
