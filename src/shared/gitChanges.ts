export type GitChangeStatus =
	| 'modified'
	| 'added'
	| 'deleted'
	| 'renamed'
	| 'copied'
	| 'typechange'
	| 'untracked'
	| 'conflicted';

export interface GitChangedFile {
	/** Relative to the repository root, with / separators; untracked directories retain Git's trailing /. */
	path: string;
	/** Rename or copy source. */
	oldPath?: string;
	status: GitChangeStatus;
	staged: boolean;
	/** A staged file also has worktree edits. */
	unstaged?: boolean;
	/** Net changes against HEAD; null for binary or oversized files, and untracked directories, symlinks or unreadable files. */
	additions: number | null;
	deletions: number | null;
}

export interface GitChanges {
	/** Repository root in native local path form, or exactly as Git prints it over SSH. */
	root: string;
	branch: string | null;
	files: GitChangedFile[];
	totals: { files: number; additions: number; deletions: number };
	truncated: boolean;
	/** Full index count when the displayed list is truncated. */
	stagedCount?: number;
	notARepo?: boolean;
	timedOut?: boolean;
}

export interface GitFileChangeDiff {
	/** Empty for untracked directories, symlinks or unreadable entries; their counts are null. */
	diff: string;
	binary: boolean;
	tooLarge: boolean;
	timedOut?: boolean;
}

export type GitChangeRequest =
	| { action: 'stage' | 'unstage' | 'revert'; paths: string[]; confirmed?: boolean }
	| { action: 'commit'; message: string };

export type GitChangeFailureReason =
	| 'invalidAction'
	| 'messageRequired'
	| 'confirmationRequired'
	| 'invalidPaths'
	| 'notChanged'
	| 'conflicted'
	| 'notStaged'
	| 'submodule';

export type GitChangeResult =
	| { success: true; output: string }
	| { success: false; error: string; reason?: GitChangeFailureReason; file?: string };
