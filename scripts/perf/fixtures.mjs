import fs from 'node:fs/promises';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { createTurn } from '../../e2e/fixtures/native/protocol.cjs';

export const stamp = '2026-11-06T10:00:00.000Z';
export const sessionId = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

export function codexRow(index, text = `Synthetic response ${index}`) {
	return JSON.stringify({
		timestamp: stamp,
		type: 'response_item',
		payload: {
			type: 'message',
			role: index % 2 ? 'assistant' : 'user',
			content: [{ type: index % 2 ? 'output_text' : 'input_text', text }],
		},
	});
}

/** All records are synthetic. The largest expanded transcript is exactly 50 MiB. */
export async function createCorpus(root) {
	const accounts = { 'claude-code': path.join(root, 'claude'), codex: path.join(root, 'codex') };
	const projects = Array.from({ length: 20 }, (_, i) => path.join(root, `project-${i}`));
	for (const project of projects) await fs.mkdir(project, { recursive: true });
	const files = [];
	for (let i = 0; i < 2000; i++) {
		const provider = i < 1000 ? 'codex' : 'claude-code';
		const cwd = projects[i % projects.length];
		const id = sessionId(i);
		const compressed = provider === 'codex' && i % 4 === 1;
		const turn = createTurn({
			provider: provider === 'codex' ? 'codex' : 'claude',
			configDir: accounts[provider],
			cwd,
			id,
			prompt: 'Synthetic question',
		});
		turn.finish('Synthetic answer');
		// Session storage discovers compressed rollouts inside the date tree.
		// archived_sessions is a separate project-discovery surface, tested there.
		const file = compressed ? `${turn.file}.zst` : turn.file;
		const rows = (await fs.readFile(turn.file, 'utf8')).trimEnd().split('\n');
		if (i < 2) {
			rows.splice(1);
			for (let j = 0; j < 5000; j++) {
				if (j % 4 === 2)
					rows.push(
						JSON.stringify({
							timestamp: stamp,
							type: 'response_item',
							payload: {
								type: 'function_call',
								name: 'exec_command',
								call_id: `call-${j}`,
								arguments: '{"cmd":"echo synthetic"}',
							},
						})
					);
				else if (j % 4 === 3)
					rows.push(
						JSON.stringify({
							timestamp: stamp,
							type: 'response_item',
							payload: {
								type: 'function_call_output',
								call_id: `call-${j - 1}`,
								output: 'synthetic output\n'.repeat(1800),
							},
						})
					);
				else
					rows.push(
						codexRow(
							j,
							`Synthetic message ${j}\n\n\u0060\u0060\u0060ts\nconst value = ${j};\n\u0060\u0060\u0060`
						)
					);
			}
			const used = Buffer.byteLength(rows.join('\n') + '\n');
			const pad = JSON.stringify({ type: 'synthetic_padding', value: '' });
			rows.push(
				JSON.stringify({
					type: 'synthetic_padding',
					value: 'x'.repeat(50 * 1024 * 1024 - used - pad.length - 1),
				})
			);
		}
		const content = rows.join('\n') + '\n';
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, compressed ? zstdCompressSync(content) : content);
		if (compressed) await fs.unlink(turn.file);
		await fs.utimes(file, 1793959200 + i, 1793959200 + i);
		files.push({ provider, file, id, cwd, compressed, expandedBytes: Buffer.byteLength(content) });
	}
	return {
		accounts,
		projects,
		files,
		transcriptCount: files.length,
		largestExpandedBytes: Math.max(...files.map((f) => f.expandedBytes)),
		compressedCount: files.filter((f) => f.compressed).length,
	};
}

export function longMessages() {
	return Array.from({ length: 5000 }, (_, i) => ({
		type: i % 4 === 0 ? 'user' : 'assistant',
		content: `Synthetic message ${i}\n\n\u0060\u0060\u0060ts\nconst value = ${i};\n\u0060\u0060\u0060`,
		timestamp: stamp,
		uuid: `message-${i}`,
		...(i % 4 === 2
			? {
					toolUse: [
						{
							name: 'exec_command',
							id: `tool-${i}`,
							input: { cmd: 'echo synthetic' },
							output: 'synthetic output\n'.repeat(1000),
							status: 'completed',
						},
					],
				}
			: {}),
	}));
}
