import fs from 'node:fs';
import path from 'node:path';

/** Move a synthetic result out of the parent so only the child can supply it. */
export function moveClaudeToolResultToChild(file: string, nativeId: string, toolCallId: string) {
	const rows = fs
		.readFileSync(file, 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	const isChildResult = (row: any) =>
		row.message?.content?.some(
			(block: any) => block.type === 'tool_result' && block.tool_use_id === toolCallId
		);
	const directory = path.join(path.dirname(file), nativeId, 'subagents');
	fs.mkdirSync(directory, { recursive: true });
	const childFile = path.join(directory, 'agent-synthetic.jsonl');
	fs.writeFileSync(
		childFile,
		rows
			.filter(isChildResult)
			.map((row) => JSON.stringify(row))
			.join('\n') + '\n'
	);
	fs.writeFileSync(
		file,
		rows
			.filter((row) => !isChildResult(row))
			.map((row) => JSON.stringify(row))
			.join('\n') + '\n'
	);
	return childFile;
}
