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
