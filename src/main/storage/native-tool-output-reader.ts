import fs from 'node:fs/promises';
import path from 'node:path';
import { readCodexRollout, MAX_CODEX_ROLLOUT_BYTES } from '../../shared/codexRollout';
import { flattenToolResultContent } from '../parsers/claude-output-parser';
import { codexToolOutputText } from '../../shared/codexToolOutput';
import type { NativeToolOutputResult } from '../../shared/nativeToolOutput';

const MAX_TOOL_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Runs in a worker. The canonical reader bounds both plain and decoded JSONL. */
export async function readNativeToolOutput(
	file: string,
	provider: 'claude-code' | 'codex',
	toolCallId: string
): Promise<NativeToolOutputResult> {
	const parent = await readToolOutputFromFile(file, provider, toolCallId);
	if (provider !== 'claude-code' || parent.status !== 'not-found') return parent;
	try {
		const sessionDir = file.replace(/\.jsonl$/, '');
		const directory = path.join(sessionDir, 'subagents');
		// A child lookup is confined to this parent's own directory.
		if (!(await fs.lstat(sessionDir)).isDirectory() || !(await fs.lstat(directory)).isDirectory())
			return { status: 'not-found' };
		let remaining = MAX_CODEX_ROLLOUT_BYTES - (await fs.stat(file)).size;
		let entries = 0;
		for await (const entry of await fs.opendir(directory)) {
			if (++entries > 128) return { status: 'too-large' };
			if (!entry.isFile() || !/^agent-.*\.jsonl$/.test(entry.name)) continue;
			const child = path.join(directory, entry.name);
			const size = (await fs.lstat(child)).size;
			if (size > remaining) return { status: 'too-large' };
			remaining -= size;
			const result = await readToolOutputFromFile(child, provider, toolCallId, size);
			if (result.status !== 'not-found') return result;
		}
		return { status: 'not-found' };
	} catch (error) {
		return {
			status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'unavailable',
		};
	}
}

async function readToolOutputFromFile(
	file: string,
	provider: 'claude-code' | 'codex',
	toolCallId: string,
	maxBytes = MAX_CODEX_ROLLOUT_BYTES
): Promise<NativeToolOutputResult> {
	try {
		const content = await readCodexRollout(file, maxBytes);
		let start = 0;
		while (start < content.length) {
			const newline = content.indexOf('\n', start);
			const end = newline < 0 ? content.length : newline;
			const line = content.slice(start, end);
			start = end + 1;
			let row;
			try {
				row = JSON.parse(line);
			} catch {
				continue;
			}
			let text: string | undefined;
			if (
				provider === 'claude-code' &&
				row?.type === 'user' &&
				Array.isArray(row.message?.content)
			) {
				const result = row.message.content.find(
					(block: { type?: string; tool_use_id?: string }) =>
						block?.type === 'tool_result' && block.tool_use_id === toolCallId
				);
				if (result) text = flattenToolResultContent(result.content, false);
			} else if (provider === 'codex') {
				const payload = row?.payload;
				if (
					row?.type === 'response_item' &&
					['function_call_output', 'custom_tool_call_output'].includes(payload?.type) &&
					payload.call_id === toolCallId
				) {
					text = codexToolOutputText(payload.output);
				} else if (
					row?.type === 'item.completed' &&
					row.item?.type === 'tool_result' &&
					row.item.id === toolCallId
				) {
					text = codexToolOutputText(row.item.output);
				}
			}
			if (text === undefined) continue;
			const bytes = Buffer.from(text, 'utf8');
			let offset = Math.max(0, bytes.length - MAX_TOOL_OUTPUT_BYTES);
			// Never start the tail in the middle of a UTF-8 code point.
			while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset++;
			return {
				status: 'found',
				text: bytes.subarray(offset).toString('utf8'),
				totalBytes: bytes.length,
				omittedBytes: offset,
			};
		}
		return { status: 'not-found' };
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { status: 'not-found' };
		if (
			error instanceof RangeError ||
			(error as NodeJS.ErrnoException)?.code === 'ERR_BUFFER_TOO_LARGE'
		)
			return { status: 'too-large' };
		return { status: 'unavailable' };
	}
}
