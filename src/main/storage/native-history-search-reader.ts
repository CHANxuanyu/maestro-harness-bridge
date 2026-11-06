import fs from 'node:fs/promises';
import path from 'node:path';
import { readCodexRollout, codexRolloutSessionId } from '../../shared/codexRollout';
import { extractMatchPreview, parseNativeSearchMessages } from '../../shared/sessionSearch';
import { normalizeWorktreePath } from '../../shared/worktreePaths';
import type {
	NativeHistorySearchAccount,
	NativeHistorySearchRequest,
	NativeHistorySearchResult,
} from '../../shared/nativeHistorySearch';
import { collectNativeHistoryFiles } from './native-history-files';

export interface NativeHistorySearchInput extends NativeHistorySearchRequest {
	accounts: NativeHistorySearchAccount[];
	/** Internal test seams, never accepted from IPC. */
	limits?: { maxMs?: number; maxBytes?: number; maxFiles?: number; maxEntries?: number };
}

/** Worker-only scan. Both compressed source bytes and expanded text consume the total budget. */
export async function searchNativeHistoryFiles(
	input: NativeHistorySearchInput
): Promise<NativeHistorySearchResult> {
	const result: NativeHistorySearchResult = { hits: [], truncated: false };
	const query = input.query.trim();
	if (query.length < 2) return result;
	if (query.length > 256) throw new Error('Search text exceeds 256 characters');
	const deadline = Date.now() + (input.limits?.maxMs ?? 2500);
	let remaining = input.limits?.maxBytes ?? 64 * 1024 * 1024;
	const discovered = await collectNativeHistoryFiles(input.accounts, {
		deadline,
		maxFiles: input.limits?.maxFiles ?? 1024,
		maxEntries: input.limits?.maxEntries ?? 8192,
	});
	result.truncated = discovered.truncated;
	if (discovered.truncated) result.limited = true;
	const seen = new Set<string>();
	const requestedProject = input.projectPath
		? normalizeWorktreePath(
				await fs.realpath(input.projectPath).catch(() => path.resolve(input.projectPath!))
			)
		: undefined;
	for (const file of discovered.files) {
		if (Date.now() >= deadline || remaining <= 0) {
			result.truncated = true;
			result.limited = true;
			break;
		}
		try {
			const physical = await fs.realpath(file.file);
			if (seen.has(physical)) continue;
			seen.add(physical);
			const stat = await fs.stat(physical);
			const allowance = Math.min(8 * 1024 * 1024, Math.floor(remaining / 2));
			if (stat.size > allowance || allowance <= 0) {
				result.truncated = true;
				result.limited = true;
				continue;
			}
			remaining -= stat.size;
			let content: string;
			try {
				content = await readCodexRollout(physical, allowance);
			} catch (error) {
				remaining -= allowance;
				throw error;
			}
			remaining -= Buffer.byteLength(content);
			const provider = file.provider as NativeHistorySearchAccount['provider'];
			const parsed = parseNativeSearchMessages(content, provider);
			if (!parsed.projectPath || !path.isAbsolute(parsed.projectPath)) continue;
			if (requestedProject) {
				const actual = await fs
					.realpath(parsed.projectPath)
					.catch(() => path.resolve(parsed.projectPath!));
				if (normalizeWorktreePath(actual) !== requestedProject) continue;
			}
			const message = parsed.messages.find((item) =>
				item.textContent.toLowerCase().includes(query.toLowerCase())
			);
			if (!message) continue;
			const nativeSessionId =
				parsed.sessionId ||
				(provider === 'codex'
					? codexRolloutSessionId(path.basename(file.file))
					: path.basename(file.file, '.jsonl'));
			const pool = await fs.realpath(file.pool);
			const key = JSON.stringify([provider, 'local', pool, nativeSessionId]);
			if (result.hits.some((hit) => hit.conversation.key === key)) continue;
			if (result.hits.length === 50) {
				result.truncated = true;
				break;
			}

			const matchPreview = extractMatchPreview(
				message.textContent,
				message.textContent.toLowerCase(),
				query.toLowerCase(),
				query.length
			);
			result.hits.push({
				conversation: {
					key,
					provider,
					nativeSessionId,
					projectKey: parsed.projectPath,
					projectPath: parsed.projectPath,
					title: (
						parsed.title ||
						parsed.messages.find((item) => item.role === 'user')?.textContent ||
						nativeSessionId
					)
						.replace(/\s+/g, ' ')
						.slice(0, 160),
					preview: '',
					createdAt: file.mtime,
					modifiedAt: file.mtime,
					messageCount: parsed.messages.length,
					starred: false,
					accountDir: file.pool,
					accountEnvVar: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
				},
				matchPreview: matchPreview.replace(/\s+/g, ' '),
				message: {
					uuid: message.uuid,
					timestamp: message.timestamp,
					role: message.role,
					text: message.textContent.slice(
						Math.max(0, message.textContent.toLowerCase().indexOf(query.toLowerCase()) - 20),
						message.textContent.toLowerCase().indexOf(query.toLowerCase()) + query.length + 120
					),
				},
			});
		} catch {
			result.truncated = true;
			result.limited = true;
		}
	}
	return result;
}
