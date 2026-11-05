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
	/** Relative to the repository root, with / separators. */
	path: string;
	/** Rename or copy source. */
	oldPath?: string;
	status: GitChangeStatus;
	staged: boolean;
	/** Net changes against HEAD; null for binary or oversized files. */
	additions: number | null;
	deletions: number | null;
}

export interface GitChanges {
	root: string;
	branch: string | null;
	files: GitChangedFile[];
	totals: { files: number; additions: number; deletions: number };
	truncated: boolean;
	notARepo?: boolean;
	timedOut?: boolean;
}

export interface GitFileChangeDiff {
	diff: string;
	binary: boolean;
	tooLarge: boolean;
	timedOut?: boolean;
}
