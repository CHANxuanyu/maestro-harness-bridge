import { useCallback, useEffect, useRef, useState } from 'react';
import type {
	AboutMeConfirmation,
	AboutMeFileStatus,
	AboutMeResult,
} from '../../../../../../shared/aboutMe';
import { useDebouncedCallback } from '../../../../../hooks/utils/useThrottle';
import {
	aboutMeConfirmationFor,
	aboutMeFilesToWrite,
	keepCurrentConfirmations,
	summarizeAboutMeApply,
	type AboutMeApplyOutcome,
} from '../../../../../services/aboutMe';
import { captureException } from '../../../../../utils/sentry';

/** Typing pause before the Markdown is saved. */
const SAVE_DELAY_MS = 600;

interface UseAboutMeStateArgs {
	isOpen: boolean;
	/** The saved Markdown (`conductorProfile`). */
	saved: string;
	save: (content: string) => Promise<AboutMeResult>;
}

export interface AboutMeState {
	draft: string;
	changeDraft: (value: string) => void;
	/** Save a pending edit now, e.g. when the editor loses focus. */
	flushDraft: () => void;
	/** The draft differs from the saved text, or a save is still in flight. */
	unsaved: boolean;
	saveError: { code?: AboutMeResult['code']; error: string } | null;
	files: AboutMeFileStatus[] | null;
	checking: boolean;
	statusError: string | null;
	checkFiles: () => void;
	confirmed: Record<string, AboutMeConfirmation>;
	approve: (file: AboutMeFileStatus, approved: boolean) => void;
	toWrite: AboutMeFileStatus[];
	applying: boolean;
	apply: () => void;
	outcome: AboutMeApplyOutcome | null;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The About Me section's state: a draft saved on a typing pause, the status of
 * every native instruction file, the user's per-file approvals, and the result
 * of the last apply. Saving never writes a native file; only `apply` does, and
 * it runs once per click with no retry.
 */
export function useAboutMeState({ isOpen, saved, save }: UseAboutMeStateArgs): AboutMeState {
	const [draft, setDraft] = useState(saved);
	const draftRef = useRef(saved);
	const savedRef = useRef(saved);
	const [savesInFlight, setSavesInFlight] = useState(0);
	const [saveError, setSaveError] = useState<AboutMeState['saveError']>(null);

	const [files, setFiles] = useState<AboutMeFileStatus[] | null>(null);
	const [checking, setChecking] = useState(false);
	const [statusError, setStatusError] = useState<string | null>(null);
	const [confirmed, setConfirmed] = useState<Record<string, AboutMeConfirmation>>({});
	const confirmedRef = useRef(confirmed);
	confirmedRef.current = confirmed;
	const [applying, setApplying] = useState(false);
	const applyingRef = useRef(false);
	const [outcome, setOutcome] = useState<AboutMeApplyOutcome | null>(null);
	// Newer reads win: a status that resolves after an apply must not replace
	// the apply's fresher file states.
	const readRef = useRef(0);

	// Another window or the CLI saved: show its text unless the user is in the
	// middle of an edit here, which their own save will then replace.
	useEffect(() => {
		if (draftRef.current === savedRef.current) {
			draftRef.current = saved;
			setDraft(saved);
		}
		savedRef.current = saved;
	}, [saved]);

	const persist = useCallback(
		async (content: string) => {
			setSavesInFlight((count) => count + 1);
			try {
				const result = await save(content);
				setSaveError(result.success ? null : { code: result.code, error: result.error ?? '' });
			} catch (error) {
				captureException(error, { extra: { context: 'About Me save' } });
				setSaveError({ error: messageOf(error) });
			} finally {
				setSavesInFlight((count) => count - 1);
			}
		},
		[save]
	);
	const { debouncedCallback: saveLater, flush: flushDraft } = useDebouncedCallback(
		persist,
		SAVE_DELAY_MS,
		{ flushOnUnmount: true }
	);

	const changeDraft = useCallback(
		(value: string) => {
			draftRef.current = value;
			setDraft(value);
			setOutcome(null);
			saveLater(value);
		},
		[saveLater]
	);

	const receiveFiles = useCallback((next: AboutMeFileStatus[]) => {
		setFiles(next);
		setConfirmed((current) => keepCurrentConfirmations(current, next));
	}, []);

	const checkFiles = useCallback(async () => {
		const read = ++readRef.current;
		setChecking(true);
		setStatusError(null);
		try {
			const result = await window.maestro.settings.aboutMe({ action: 'status' });
			if (read !== readRef.current) return;
			if (result.success) receiveFiles(result.files);
			else setStatusError(result.error ?? '');
		} catch (error) {
			if (read !== readRef.current) return;
			captureException(error, { extra: { context: 'About Me status' } });
			setStatusError(messageOf(error));
		} finally {
			if (read === readRef.current) setChecking(false);
		}
	}, [receiveFiles]);

	// Check when Settings opens and after every save: a new profile turns
	// up-to-date files into ones that need an update.
	useEffect(() => {
		if (isOpen) void checkFiles();
	}, [isOpen, saved, checkFiles]);

	const approve = useCallback((file: AboutMeFileStatus, approved: boolean) => {
		setConfirmed((current) => {
			const next = { ...current };
			if (approved) next[file.path] = aboutMeConfirmationFor(file);
			else delete next[file.path];
			return next;
		});
	}, []);

	const unsaved = draft !== saved || savesInFlight > 0;

	const apply = useCallback(async () => {
		if (applyingRef.current || draftRef.current !== savedRef.current) return;
		applyingRef.current = true;
		setApplying(true);
		setOutcome(null);
		const read = ++readRef.current;
		try {
			const result = await window.maestro.settings.aboutMe({
				action: 'apply',
				content: savedRef.current,
				confirmations: Object.values(confirmedRef.current),
			});
			// A refused request never inspected the files, so keep what is shown.
			if (result.code !== 'invalid-request' && result.code !== 'unavailable')
				receiveFiles(result.files);
			setOutcome(summarizeAboutMeApply(result));
		} catch (error) {
			captureException(error, { extra: { context: 'About Me apply' } });
			setOutcome({
				written: [],
				unrecorded: [],
				waiting: [],
				failed: [],
				skipped: [],
				profileChanged: false,
				error: messageOf(error),
			});
		} finally {
			applyingRef.current = false;
			setApplying(false);
			if (read === readRef.current) setChecking(false);
		}
	}, [receiveFiles]);

	return {
		draft,
		changeDraft,
		flushDraft,
		unsaved,
		saveError,
		files,
		checking,
		statusError,
		checkFiles: () => void checkFiles(),
		confirmed,
		approve,
		toWrite: files ? aboutMeFilesToWrite(files, confirmed) : [],
		applying,
		apply: () => void apply(),
		outcome,
	};
}
