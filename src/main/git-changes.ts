import path from 'path';
import fs from 'fs/promises';
import type {
	GitChangeRequest,
	GitChangeFailureReason,
	GitChangeResult,
	GitChangedFile,
	GitChanges,
	GitChangeStatus,
	GitFileChangeDiff,
} from '../shared/gitChanges';
import type { SshRemoteConfig } from '../shared/types';
import { isNotAGitRepositoryError } from '../shared/gitUtils';
import { execGit, execGitReadOnly, isGitTimeout } from './utils/remote-git';
import { shellEscape } from './utils/shell-escape';
import { LOCAL_SESSION_READ_CONCURRENCY, mapWithConcurrency } from './utils/concurrency';
import { createKeyedWriteQueue } from './utils/atomic-json-store';
import type { ExecResult } from './utils/execFile';

const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 500;
const BINARY_PREFIX_BYTES = 8000;
const slash = (value: string) => value.replace(/\\/g, '/');

/** Git's shell aliases use its bundled sh on Windows, and the remote sh over SSH. */
export function changesCommand(file?: string, oldPath?: string, local = false): string[] {
	const numstat = 'git diff --no-ext-diff --no-textconv --numstat -z';
	const base =
		'base=$(git rev-parse --verify HEAD 2>/dev/null) || base=$(git hash-object -t tree --stdin < /dev/null) || exit $?';
	let script =
		file === undefined
			? [
					'root=$(git rev-parse --show-toplevel) || exit $?',
					'printf "%s\\0" "$root"',
					'printf "# maestro.cwd %s/%s\\0" "$root" "${GIT_PREFIX%/}"',
					'git status --porcelain=v2 -z --branch --untracked-files=all || exit $?',
					'printf "\\0"',
					base,
					`${numstat} "$base" -- || exit $?`,
					// xargs preserves NUL-delimited filenames, including newlines and quotes.
					`git ls-files --others --exclude-standard -z | xargs -0 sh -c ${shellEscape(`for file do
			if [ -L "$file" ] || [ ! -f "$file" ] || [ ! -r "$file" ]; then printf '%s\\t%s\\t%s\\0' '-' '-' "$file"; continue; fi
			size=$(wc -c 2>/dev/null < "$file") || { printf '%s\\t%s\\t%s\\0' '-' '-' "$file"; continue; }
			if [ "$size" -gt ${MAX_BYTES} ]; then printf '%s\\t%s\\t%s\\0' '-' '-' "$file"; continue; fi
			${numstat} --no-index -- /dev/null "$file" 2>/dev/null
			code=$?
			[ "$code" -le 1 ] || printf '%s\\t%s\\t%s\\0' '-' '-' "$file"
		done`)} sh`,
					'code=$?; [ "$code" -eq 0 ] || exit "$code"',
					`git diff --no-ext-diff --no-textconv --no-renames --name-only -z "$base" -- | xargs -0 sh -c ${shellEscape(`base=$1; shift
		for file do
			size=0; [ ! -f "$file" ] || size=$(wc -c < "$file") || exit $?
			oldsize=$(git cat-file -s "$base:$file" 2>/dev/null) || oldsize=0
			if [ "$size" -gt ${MAX_BYTES} ] || [ "$oldsize" -gt ${MAX_BYTES} ]; then printf '%s\\t%s\\t%s\\0' '-' '-' "$file"; fi
		done`)} sh "$base"`,
					'code=$?; [ "$code" -eq 0 ] || exit "$code"',
					'printf "\\0"',
				]
			: [
					base,
					`file=${shellEscape(file)}`,
					`oldfile=${shellEscape(oldPath ?? file)}`,
					'tracked=0; if git ls-files --error-unmatch -- "$file" >/dev/null 2>&1 || git cat-file -e "$base:$oldfile" 2>/dev/null; then tracked=1; fi',
					'if [ "$tracked" -eq 0 ] && { [ -L "$file" ] || [ ! -f "$file" ] || [ ! -r "$file" ]; }; then printf "patch\\0\\0"; exit 0; fi',
					// Check both ends before generating a patch, including large deletions.
					'size=0; if [ -f "$file" ]; then size=$(wc -c 2>/dev/null < "$file") || { if [ "$tracked" -eq 0 ]; then printf "patch\\0\\0"; exit 0; else exit 1; fi; }; fi',
					'oldsize=$(git cat-file -s "$base:$oldfile" 2>/dev/null) || oldsize=0',
					`if [ "$size" -gt ${MAX_BYTES} ] || [ "$oldsize" -gt ${MAX_BYTES} ]; then printf 'large\\0'; exit 0; fi`,
					'if [ "$tracked" -eq 1 ]; then',
					'printf "patch\\0"',
					`${numstat} "$base" -- "$oldfile" "$file" || exit $?`,
					'printf "\\0"',
					'git diff --no-ext-diff --no-textconv --find-renames "$base" -- "$oldfile" "$file"',
					'else',
					// Buffer before framing so an untracked read failure cannot leave half a response.
					'stats=$(git diff --no-ext-diff --no-textconv --numstat --no-index -- /dev/null "$file" 2>/dev/null); code=$?; if [ "$code" -gt 1 ]; then printf "patch\\0\\0"; exit 0; fi',
					// The suffix preserves patch-final newlines through command substitution.
					'patch=$(git diff --no-ext-diff --no-textconv --no-index -- /dev/null "$file" 2>/dev/null; code=$?; [ "$code" -le 1 ] || exit "$code"; printf .) || { printf "patch\\0\\0"; exit 0; }',
					'printf "patch\\0%s\\0\\0%s" "$stats" "${patch%.}"',
					'fi',
				];
	if (file === undefined && local) {
		script = [
			'root=$(git rev-parse --show-toplevel) || exit $?',
			'printf "%s\\0" "$root"',
			base,
			'git ls-files --others --exclude-standard -z || exit $?',
			'printf "\\0"',
			// Raw records carry HEAD object IDs and NUL-delimited paths, so the
			// batch size query never has to encode a filename on a stdin line.
			'git diff --no-ext-diff --no-textconv --no-renames --raw --no-abbrev -z "$base" -- || exit $?',
			'printf "\\0"',
			'printf "# maestro.cwd %s/%s\\0" "$root" "${GIT_PREFIX%/}"',
			'git status --porcelain=v2 -z --branch --untracked-files=all || exit $?',
			'printf "\\0"',
			`${numstat} "$base" -- || exit $?`,
			'printf "\\0"',
		];
	}

	return [
		'--literal-pathspecs',
		'-c',
		`core.bigFileThreshold=${MAX_BYTES}`,
		'-c',
		`alias.maestro-changes=!f() {\n${script.join('\n')}\n}; f`,
		'maestro-changes',
	];
}

/** Count in small asynchronous chunks, including an unterminated final line. */
async function untrackedNumstat(root: string, file: string): Promise<string> {
	const unknown = `-\t-\t${file}\0`;
	try {
		const filePath = path.join(root, file);
		const stat = await fs.lstat(filePath);
		if (!stat.isFile() || stat.size > MAX_BYTES) return unknown;
		const handle = await fs.open(filePath, 'r');
		try {
			const buffer = Buffer.allocUnsafe(64 * 1024);
			let size = 0;
			let lines = 0;
			let lastByte = 10;
			while (true) {
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
				if (bytesRead === 0) break;
				// Git's buffer_is_binary checks only the first 8000 bytes.
				if (
					size < BINARY_PREFIX_BYTES &&
					buffer.subarray(0, Math.min(bytesRead, BINARY_PREFIX_BYTES - size)).includes(0)
				)
					return unknown;
				size += bytesRead;
				if (size > MAX_BYTES) return unknown;
				for (let index = 0; index < bytesRead; index++) {
					if (buffer[index] === 10) lines++;
				}
				lastByte = buffer[bytesRead - 1];
			}
			return `${lines + (lastByte === 10 ? 0 : 1)}\t0\t${file}\0`;
		} finally {
			await handle.close();
		}
	} catch {
		// Unreadable or concurrently removed entries still belong in status.
		return unknown;
	}
}

/** Replace only local per-file shell work, then restore the shared wire format. */
async function readLocalChanges(cwd: string): Promise<ExecResult> {
	const result = await execGitReadOnly(changesCommand(undefined, undefined, true), cwd);
	if (result.exitCode !== 0) return result;
	const records = result.stdout.split('\0');
	const root = records.shift()!;
	const untrackedEnd = records.indexOf('');
	const rawEnd = records.indexOf('', untrackedEnd + 1);
	const untracked = records.slice(0, untrackedEnd);
	const tracked = [];
	for (let index = untrackedEnd + 1; index < rawEnd; index += 2) {
		tracked.push({ file: records[index + 1], oid: records[index].split(' ')[2] });
	}
	const oids = [...new Set(tracked.map(({ oid }) => oid).filter((oid) => !/^0+$/.test(oid)))];
	const sizes = new Map<string, number>();
	if (oids.length) {
		const batch = await execGitReadOnly(
			['cat-file', '--batch-check=%(objectname) %(objectsize)'],
			root,
			undefined,
			undefined,
			undefined,
			oids.join('\n') + '\n'
		);
		if (batch.exitCode !== 0) return batch;
		for (const line of batch.stdout.trim().split('\n')) {
			const [oid, size] = line.split(' ');
			sizes.set(oid, Number(size) || 0);
		}
	}
	const trackedStats = await mapWithConcurrency(
		tracked,
		LOCAL_SESSION_READ_CONCURRENCY,
		async ({ file, oid }) => {
			let size = 0;
			try {
				// Follow tracked symlinks, matching the shell's -f and wc checks.
				const stat = await fs.stat(path.join(root, file));
				if (stat.isFile()) size = stat.size;
			} catch {
				// A deletion has no worktree size, but still needs its HEAD size.
			}
			return size > MAX_BYTES || (sizes.get(oid) ?? 0) > MAX_BYTES ? `-\t-\t${file}\0` : '';
		}
	);
	const untrackedStats = await mapWithConcurrency(
		untracked,
		LOCAL_SESSION_READ_CONCURRENCY,
		(file) => untrackedNumstat(root, file)
	);
	const wire = `${root}\0${records.slice(rawEnd + 1).join('\0')}`;
	return {
		...result,
		stdout: wire.slice(0, -1) + untrackedStats.join('') + trackedStats.join('') + '\0',
	};
}

function emptyChanges(root: string): GitChanges {
	return {
		root,
		branch: null,
		files: [],
		totals: { files: 0, additions: 0, deletions: 0 },
		truncated: false,
	};
}

/** Parse the same NUL-delimited wire format on local and remote hosts. */
export function parseGitChanges(output: string, limit = MAX_FILES): GitChanges {
	const records = output.split('\0');
	const result = emptyChanges(records.shift()!);
	const files = new Map<string, GitChangedFile>();
	let record: string | undefined;
	while ((record = records.shift()) !== undefined && record !== '') {
		if (record.startsWith('# maestro.cwd ')) {
			result.executionCwd = record.slice(14).replace(/\/$/, '') || '/';
			continue;
		}
		if (record.startsWith('# branch.head ')) {
			const branch = record.slice(14);
			result.branch = branch === '(detached)' ? null : branch;
			continue;
		}
		if (record.startsWith('# ')) continue;
		const kind = record[0];
		const fields = record.split(' ');
		const xy = fields[1];
		const filePath =
			kind === '?'
				? record.slice(2)
				: fields.slice(kind === '2' ? 9 : kind === 'u' ? 10 : 8).join(' ');
		const statuses: Record<string, GitChangeStatus> = {
			M: 'modified',
			A: 'added',
			D: 'deleted',
			R: 'renamed',
			C: 'copied',
			T: 'typechange',
		};
		const status =
			kind === '?'
				? 'untracked'
				: kind === 'u'
					? 'conflicted'
					: (statuses[xy[0]] ?? statuses[xy[1]] ?? 'modified');
		const file: GitChangedFile = {
			path: slash(filePath),
			status,
			staged: kind !== '?' && kind !== 'u' && xy[0] !== '.',
			...(kind !== '?' && kind !== 'u' && xy[0] !== '.' && xy[1] !== '.' ? { unstaged: true } : {}),
			additions: 0,
			deletions: 0,
		};
		if (kind === '2') file.oldPath = slash(records.shift()!);
		const previous = files.get(file.path);
		// Git reports a staged deletion and its untracked replacement separately.
		// Keep the index identity so unstage and revert still operate on HEAD.
		if (previous?.staged && file.status === 'untracked') previous.unstaged = true;
		else {
			if (file.staged && previous?.status === 'untracked') file.unstaged = true;
			files.set(file.path, file);
		}
	}
	while ((record = records.shift()) !== undefined && record !== '') {
		const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(record);
		if (!match) throw new Error('Invalid git changes numstat record');
		let filePath = match[3];
		if (!filePath) {
			records.shift();
			filePath = records.shift()!;
		}
		const file =
			files.get(slash(filePath)) ??
			[...files.values()].find((entry) => entry.oldPath === slash(filePath));
		if (file) {
			if (file.additions === null) continue;
			file.additions = match[1] === '-' ? null : Number(match[1]);
			file.deletions = match[2] === '-' ? null : Number(match[2]);
		}
	}
	const all = [...files.values()].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	);
	result.totals = {
		files: all.length,
		additions: all.reduce((sum, file) => sum + (file.additions ?? 0), 0),
		deletions: all.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
	};
	result.files = all.slice(0, limit);
	result.truncated = all.length > limit;
	if (result.truncated) result.stagedCount = all.filter((file) => file.staged).length;
	return result;
}

/** Bounded read-only queries locally, or one unchanged shell query over SSH. */
export async function getGitChanges(
	cwd: string,
	sshRemote?: SshRemoteConfig,
	remoteCwd?: string
): Promise<GitChanges> {
	const result = sshRemote
		? await execGitReadOnly(changesCommand(), cwd, sshRemote, remoteCwd ?? cwd)
		: await readLocalChanges(cwd);
	const fallbackRoot = sshRemote ? (remoteCwd ?? cwd) : path.normalize(cwd);
	if (isGitTimeout(result)) return { ...emptyChanges(fallbackRoot), timedOut: true };
	if (result.exitCode !== 0) {
		if (isNotAGitRepositoryError(result.stderr))
			return { ...emptyChanges(fallbackRoot), notARepo: true };
		throw new Error(result.stderr || `git changes failed: ${result.exitCode}`);
	}
	const changes = parseGitChanges(result.stdout);
	if (!sshRemote) changes.root = path.normalize(changes.root);
	return changes;
}

export async function getGitChangeDiff(
	cwd: string,
	file: string,
	sshRemote?: SshRemoteConfig,
	remoteCwd?: string
): Promise<GitFileChangeDiff> {
	const normalized = slash(file);
	if (
		!normalized ||
		normalized.startsWith('/') ||
		/^[a-z]:/i.test(normalized) ||
		normalized.split('/').includes('..') ||
		normalized.includes('\0')
	)
		throw new Error('A repository-relative file path is required');
	// Include the source path of a rename so git can pair both sides. The
	// remote changes snapshot itself still uses one invocation and one SSH connection.
	const snapshot = await execGitReadOnly(
		['status', '--porcelain=v2', '-z', '--untracked-files=no'],
		cwd,
		sshRemote,
		remoteCwd ?? cwd
	);
	if (isGitTimeout(snapshot)) return { diff: '', binary: false, tooLarge: false, timedOut: true };
	if (snapshot.exitCode !== 0) throw new Error(snapshot.stderr || 'Could not read git changes');
	const change = parseGitChanges('\0' + snapshot.stdout + '\0', Infinity).files.find(
		(entry) => entry.path === normalized
	);
	const result = await execGitReadOnly(
		changesCommand(normalized, change?.oldPath),
		cwd,
		sshRemote,
		remoteCwd ?? cwd
	);
	if (isGitTimeout(result)) return { diff: '', binary: false, tooLarge: false, timedOut: true };
	if (result.exitCode !== 0)
		throw new Error(result.stderr || `git change diff failed: ${result.exitCode}`);
	if (result.stdout === 'large\0') return { diff: '', binary: false, tooLarge: true };
	if (result.stdout === 'patch\0\0') return { diff: '', binary: false, tooLarge: false };
	const separator = result.stdout.indexOf('\0\0');
	if (!result.stdout.startsWith('patch\0') || separator < 0)
		throw new Error('Invalid git change diff response');
	const binary = result.stdout.slice(6, separator).startsWith('-\t-\t');
	const diff = result.stdout.slice(separator + 2);
	const tooLarge = Buffer.byteLength(diff) > MAX_BYTES;
	return { diff: binary || tooLarge ? '' : diff, binary, tooLarge };
}

const changeWrites = createKeyedWriteQueue();

/** Keep application refusals translatable while passing Git diagnostics through unchanged. */
class GitChangeValidationError extends Error {
	constructor(
		readonly reason: GitChangeFailureReason,
		message: string,
		readonly file?: string
	) {
		super(message);
	}
}

/** Exact repository-relative paths only. Never allow Git pathspec magic or directory scope. */
export async function applyGitChange(
	cwd: string,
	request: GitChangeRequest,
	sshRemote?: SshRemoteConfig,
	remoteCwd?: string
): Promise<GitChangeResult> {
	try {
		if (!request || !['stage', 'unstage', 'revert', 'commit'].includes(request.action))
			throw new GitChangeValidationError('invalidAction', 'Unknown changes action');
		if (request.action === 'commit') {
			if (
				typeof request.message !== 'string' ||
				!request.message.trim() ||
				request.message.includes('\0')
			)
				throw new GitChangeValidationError('messageRequired', 'A commit message is required');
		} else {
			if (request.action === 'revert' && request.confirmed !== true)
				throw new GitChangeValidationError(
					'confirmationRequired',
					'Revert requires explicit confirmation'
				);
			if (
				!Array.isArray(request.paths) ||
				request.paths.length === 0 ||
				request.paths.some(
					(file) =>
						typeof file !== 'string' ||
						!file ||
						file.startsWith('/') ||
						/^[a-z]:/i.test(file) ||
						file.includes('\0') ||
						file.includes('\\') ||
						file.split('/').some((part) => !part || part === '.' || part === '..')
				)
			)
				throw new GitChangeValidationError(
					'invalidPaths',
					'Exact repository-relative file paths are required'
				);
		}
		const rootResult = await execGitReadOnly(
			['rev-parse', '--show-toplevel'],
			cwd,
			sshRemote,
			remoteCwd ?? cwd
		);
		if (rootResult.exitCode !== 0) throw new Error(rootResult.stderr || rootResult.stdout);
		// Git prints the host's root. In particular, never resolve an SSH path locally.
		const root = rootResult.stdout.replace(/\r?\n$/, '');
		return await changeWrites.enqueue(JSON.stringify([sshRemote?.id ?? '', root]), async () => {
			const run = async (args: string[]) => {
				const result = await execGit(['--literal-pathspecs', ...args], root, sshRemote, root, {
					timeout: 120_000,
				});
				if (result.exitCode !== 0)
					throw new Error(result.stderr || result.stdout || `Git exited with ${result.exitCode}`);
				return result.stdout;
			};
			if (request.action === 'commit') {
				// No -a: later worktree edits must never enter this commit implicitly.
				return { success: true, output: await run(['commit', '-m', request.message]) };
			}
			const snapshot = await execGitReadOnly(
				['status', '--porcelain=v2', '-z', '--untracked-files=all'],
				root,
				sshRemote,
				root
			);
			if (snapshot.exitCode !== 0) throw new Error(snapshot.stderr || snapshot.stdout);
			const files = parseGitChanges('\0' + snapshot.stdout + '\0', Infinity).files;
			const selected = [...new Set(request.paths)].map((file) => {
				const entry = files.find((item) => item.path === file);
				if (!entry)
					throw new GitChangeValidationError(
						'notChanged',
						`File is no longer changed: ${file}`,
						file
					);
				if (request.action === 'revert' && entry.status === 'conflicted')
					throw new GitChangeValidationError(
						'conflicted',
						`Cannot revert a conflicted file: ${file}`,
						file
					);
				if (request.action === 'unstage' && !entry.staged)
					throw new GitChangeValidationError('notStaged', `File is not staged: ${file}`, file);
				return entry;
			});
			// An indexed rename has already removed its source. Add only destinations.
			if (request.action === 'stage')
				return {
					success: true,
					output: await run(['add', '--', ...selected.map((file) => file.path)]),
				};
			// Unstage and revert own both rename paths; copies leave their source alone.
			const paths = [
				...new Set(
					selected.flatMap((file) =>
						file.status === 'renamed' && file.oldPath ? [file.oldPath, file.path] : [file.path]
					)
				),
			];
			const head = await execGitReadOnly(
				['rev-parse', '--verify', '--quiet', 'HEAD'],
				root,
				sshRemote,
				root
			);
			if (head.exitCode !== 0 && head.exitCode !== 1)
				throw new Error(head.stderr || 'Could not read HEAD');
			if (request.action === 'unstage')
				return {
					success: true,
					output: await run(
						head.exitCode === 0
							? ['reset', '-q', 'HEAD', '--', ...paths]
							: ['rm', '--cached', '-f', '--', ...paths]
					),
				};
			// A submodule is a repository, not a single file. Do not report a partial restore.
			const entries = await execGitReadOnly(
				['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...paths],
				root,
				sshRemote,
				root
			);
			if (entries.exitCode !== 0) throw new Error(entries.stderr || entries.stdout);
			if (entries.stdout.split('\0').some((entry) => entry.startsWith('160000 ')))
				throw new GitChangeValidationError(
					'submodule',
					'Cannot revert a submodule from the file changes panel'
				);
			const tracked = paths.filter(
				(file) => !selected.some((entry) => entry.path === file && entry.status === 'untracked')
			);
			const untracked = selected
				.filter((file) => file.status === 'untracked')
				.map((file) => file.path);
			let output = '';
			if (tracked.length)
				output += await run(
					head.exitCode === 0
						? ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked]
						: ['rm', '-f', '--', ...tracked]
				);
			if (untracked.length) output += await run(['clean', '-f', '--', ...untracked]);
			return { success: true, output };
		});
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			...(error instanceof GitChangeValidationError
				? { reason: error.reason, file: error.file }
				: {}),
		};
	}
}
