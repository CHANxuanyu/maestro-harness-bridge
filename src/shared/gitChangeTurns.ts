import type { GitChangedFile, GitChanges } from './gitChanges';
import { normalizeWorktreePath, isPathAtOrUnderRoot } from './worktreePaths';

/** Structural subset of a conversation log, usable without renderer dependencies. */
export interface ChangeTurnEntry {
	id: string;
	source: string;
	text: string;
	timestamp: number;
	metadata?: { toolState?: { status?: string; input?: unknown; writePaths?: string[] } };
}

export interface TurnWrites {
	turnId: string;
	title: string;
	timestamp: number;
	paths: string[];
}

export interface GitChangeTurnGroup {
	/** null identifies workspace changes without a matching recorded turn. */
	turnId: string | null;
	title: string;
	timestamp: number | null;
	files: GitChangedFile[];
}

export interface GitChangesByTurn extends GitChanges {
	groups: GitChangeTurnGroup[];
	hasWriteRecords: boolean;
	/** Every occurrence of a file opens its current workspace diff. */
	diffScope: 'current';
}

/** Read only explicit write-tool arguments. Shell output and prose are never evidence. */
function writtenPaths(entry: ChangeTurnEntry): string[] {
	if (entry.source !== 'tool' || entry.metadata?.toolState?.status !== 'completed') return [];
	return (
		entry.metadata.toolState.writePaths ??
		toolInputWritePaths(entry.text, entry.metadata.toolState.input)
	);
}

/** Extract explicit paths before display arguments are compacted, regardless of call status. */
export function toolInputWritePaths(name: string, input: unknown): string[] {
	if (typeof input === 'string' && input.trim().startsWith('{')) {
		try {
			input = JSON.parse(input);
		} catch {
			/* A custom tool may use plain text. */
		}
	}
	const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
	let paths: unknown[] = [];
	if (['Edit', 'Write', 'MultiEdit'].includes(name)) paths = [record.file_path];
	else if (name === 'NotebookEdit') paths = [record.notebook_path];
	else if (name === 'file_change' && Array.isArray(record.changes)) {
		paths = record.changes.flatMap((change: unknown) =>
			change && typeof change === 'object' && 'path' in change ? [change.path] : []
		);
	} else if (name === 'apply_patch' || name === 'functions.apply_patch') {
		const patch = typeof input === 'string' ? input : (record.patch ?? record.input);
		if (typeof patch !== 'string') return [];
		const lines = patch.trim().split(/\r?\n/);
		if (lines[0] !== '*** Begin Patch' || lines[lines.length - 1] !== '*** End Patch') return [];
		for (const line of lines) {
			const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
			if (match) paths.push(match[1]);
		}
	}
	return paths.filter(
		(value): value is string => typeof value === 'string' && !!value && !value.includes('\0')
	);
}

/** Build this index only when logs change, independently of Git refreshes or UI state. */
export function collectTurnWrites(logs: readonly ChangeTurnEntry[]): TurnWrites[] {
	const turns: TurnWrites[] = [];
	let current: TurnWrites | undefined;
	let paths = new Set<string>();
	for (const entry of logs) {
		if (entry.source === 'user') {
			const firstLine = entry.text.split(/\r?\n/, 1)[0];
			current = {
				turnId: entry.id,
				title: firstLine.length > 120 ? firstLine.slice(0, 119) + '…' : firstLine,
				timestamp: entry.timestamp,
				paths: [],
			};
			turns.push(current);
			paths = new Set();
		} else if (current) {
			for (const path of writtenPaths(entry)) {
				if (!paths.has(path)) current.paths.push(path);
				paths.add(path);
			}
		}
	}
	return turns.filter((turn) => turn.paths.length > 0).reverse();
}

/** Lexical matching only. Never resolve a remote path on the local filesystem. */
function repositoryPath(raw: string, root: string, cwd: string, posix: boolean): string | null {
	const path = normalizeWorktreePath(raw, posix);
	// Unexpanded home variables, parent traversal and ambiguous drive-relative paths
	// cannot establish a correspondence without more execution context.
	if (/^(?:~|\$|[A-Za-z]:[^/])/.test(path) || path.split('/').includes('..')) return null;
	const absolute = path.startsWith('/') || (!posix && /^[A-Za-z]:\//.test(path));
	const candidate = normalizeWorktreePath(absolute ? path : `${cwd}/${path}`, posix)
		.split('/')
		.filter((part) => part !== '.')
		.join('/');
	if (!isPathAtOrUnderRoot(candidate, root) || candidate === root) return null;
	return candidate.slice(root === '/' ? 1 : root.length + 1);
}

/** Shared UI and CLI projection over the same current Git snapshot and recorded tool index. */
export function groupChangesByTurn(
	changes: GitChanges,
	turns: readonly TurnWrites[],
	cwd: string,
	posix = false
): GitChangesByTurn {
	const root = normalizeWorktreePath(changes.root, posix);
	const alias = normalizeWorktreePath(cwd, posix);
	const workingDir = normalizeWorktreePath(changes.executionCwd ?? cwd, posix);
	const files = new Map(changes.files.map((file) => [file.path, file]));
	for (const file of changes.files) {
		if (file.status === 'renamed' && file.oldPath && !files.has(file.oldPath))
			files.set(file.oldPath, file);
	}
	const attributed = new Set<string>();
	const groups: GitChangeTurnGroup[] = [];
	for (const turn of turns) {
		const matched = new Set<GitChangedFile>();
		for (const raw of turn.paths) {
			const normalized = normalizeWorktreePath(raw, posix);
			const resolved =
				changes.executionCwd && isPathAtOrUnderRoot(normalized, alias)
					? workingDir + normalized.slice(alias.length)
					: raw;
			const path = repositoryPath(resolved, root, workingDir, posix);
			const file = path === null ? undefined : files.get(path);
			if (file) {
				matched.add(file);
				attributed.add(file.path);
			}
		}
		if (matched.size)
			groups.push({
				turnId: turn.turnId,
				title: turn.title,
				timestamp: turn.timestamp,
				files: [...matched],
			});
	}
	const other = changes.files.filter((file) => !attributed.has(file.path));
	if (other.length) groups.push({ turnId: null, title: '', timestamp: null, files: other });
	return { ...changes, groups, hasWriteRecords: turns.length > 0, diffScope: 'current' };
}
