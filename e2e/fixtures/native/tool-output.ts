import fs from 'node:fs';
import path from 'node:path';

/** Move the call and its result together, as in a child-only native transcript. */
export function moveClaudeToolCallToChild(file: string, nativeId: string, toolCallId: string) {
	const rows = fs
		.readFileSync(file, 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	const isChildCall = (row: any) =>
		Array.isArray(row.message?.content) &&
		row.message.content.some(
			(block: any) =>
				(block.type === 'tool_result' && block.tool_use_id === toolCallId) ||
				(block.type === 'tool_use' && block.id === toolCallId)
		);
	const directory = path.join(path.dirname(file), nativeId, 'subagents');
	fs.mkdirSync(directory, { recursive: true });
	const childFile = path.join(directory, 'agent-synthetic.jsonl');
	fs.writeFileSync(
		childFile,
		rows
			.filter(isChildCall)
			.map((row) => JSON.stringify(row))
			.join('\n') + '\n'
	);
	fs.writeFileSync(
		file,
		rows
			.filter((row) => !isChildCall(row))
			.map((row) => JSON.stringify(row))
			.join('\n') + '\n'
	);
	return childFile;
}
