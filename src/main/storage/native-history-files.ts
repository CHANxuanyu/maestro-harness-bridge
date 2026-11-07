import fs from 'node:fs/promises';
import path from 'node:path';
import { isCodexRollout, preferPlainCodexRollouts } from '../../shared/codexRollout';
import type { NativeHistorySearchAccount } from '../../shared/nativeHistorySearch';
import { isExpectedSessionReadError } from '../utils/session-read-errors';

/** Shared bounded discovery for recent projects and native content search. */
export async function collectNativeHistoryFiles(
	accounts: NativeHistorySearchAccount[],
	options: { maxFiles: number; maxEntries: number; deadline: number }
) {
	const { maxFiles, deadline } = options;
	let remainingEntries = options.maxEntries;
	let truncated = false;
	const files: Array<{ file: string; provider: string; pool: string; mtime: number }> = [];
	async function walk(
		directory: string,
		provider: string,
		pool: string,
		depth: number
	): Promise<void> {
		if (depth < 0) return;
		if (files.length >= maxFiles || remainingEntries <= 0 || Date.now() >= deadline) {
			truncated = true;
			return;
		}
		try {
			const dir = await fs.opendir(directory);
			for await (const entry of dir) {
				if (--remainingEntries < 0 || files.length >= maxFiles || Date.now() >= deadline) {
					truncated = true;
					break;
				}
				const file = path.join(directory, entry.name);
				if (entry.isDirectory()) await walk(file, provider, pool, depth - 1);
				else if (
					entry.isFile() &&
					(provider === 'codex' ? isCodexRollout(entry.name) : entry.name.endsWith('.jsonl'))
				) {
					const stat = await fs.stat(file);
					files.push({ file, provider, pool, mtime: stat.mtimeMs });
				}
			}
		} catch (error) {
			if (!isExpectedSessionReadError(error)) throw error;
		}
	}
	for (const provider of ['claude-code', 'codex']) {
		for (const account of accounts
			.filter((item) => item.provider === provider)
			.map((item) => item.accountDir)
			.slice(0, 64)) {
			if (provider === 'claude-code')
				await walk(path.join(account, 'projects'), provider, account, 1);
			else {
				await walk(path.join(account, 'sessions'), provider, account, 4);
				await walk(path.join(account, 'archived_sessions'), provider, account, 4);
			}
		}
	}
	const selected = files.filter((file) => file.provider !== 'codex');
	for (const pool of new Set(
		files.filter((file) => file.provider === 'codex').map((file) => file.pool)
	)) {
		selected.push(
			...preferPlainCodexRollouts(
				files.filter((file) => file.provider === 'codex' && file.pool === pool),
				(file) => path.basename(file.file)
			)
		);
	}
	return { files: selected.sort((a, b) => b.mtime - a.mtime), truncated };
}
