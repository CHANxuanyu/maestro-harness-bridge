import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { shellEscape } from '../../src/main/utils/shell-escape';
import type { NativeApp, NativeScene, Provider } from './native-app';
import { readOpenCodeState } from './native/opencode-protocol.cjs';

export function realPrompt(native: NativeApp, prompt: string, scene: NativeScene): string {
	const commands = (scene.tools ?? []).map((tool, index) => {
		if (!tool.updates)
			return `${scene.waitForStop ? '' : 'sleep 1; '}${tool.command}${tool.status === 'failed' ? '; exit 7' : ''}`;
		const file = path.join(native.project, `${tool.id}-${index}.cjs`);
		// These are ordinary test workload scripts run by the actual agent's
		// shell tool, not protocol emitters or replacement native events.
		fs.writeFileSync(
			file,
			`const fs = require('node:fs');\nconst { setTimeout: delay } = require('node:timers/promises');\n(async () => {\nlet previous = '';\nfor (const [index, text] of ${JSON.stringify(tool.updates)}.entries()) {\nprocess.stdout.write(text.slice(previous.length)); previous = text;\nconst gate = ${JSON.stringify(tool.gates ?? [])}[index];\nwhile (gate && !fs.existsSync(gate)) await delay(25);\n}\n})();\n`
		);
		return `${shellEscape(process.execPath)} ${shellEscape(file)}`;
	});
	return `${prompt}\n\nThis is an acceptance test in a fresh temporary project. Do not access other projects or start subagents. Do not send progress notes or commentary. ${scene.approval ? 'Before executing the workload, call request_user_input to ask one native confirmation question. Wait for its answer. ' : ''}${commands.length ? `Run exactly these commands, each as its own shell tool call, in parallel when independent. Do not combine commands, retry a failed command, or fix the intentional failure. Keep waiting for a running command.\n${commands.map((command, index) => `${index + 1}. ${command}`).join('\n')}\n` : 'Do not use tools. '}${scene.waitForStop ? 'Keep the command running until I stop this turn.' : `After all tools finish, reply with the exact text decoded from this JSON string, without quotes or formatting: ${JSON.stringify(scene.answer)}`}`;
}

export function nativeIdentity(provider: Provider, file: string) {
	if (provider === 'opencode') {
		const state = readOpenCodeState(file);
		return {
			id: state.sessions[0]?.id,
			model: state.messages.findLast((row) => row.data.role === 'assistant')?.data.modelID,
		};
	}
	// Read the same native identity fields documented by the repository's
	// Claude/Codex storage parsers. This never searches an account directory.
	const records = fs
		.readFileSync(file, 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	if (provider === 'copilot')
		return {
			id: records.find((record) => record.type === 'session.start')?.data.sessionId,
			model: records.findLast((record) => record.type === 'assistant.message')?.data.model,
		};
	if (provider === 'omp') {
		const last = records.findLast((record) => record.message?.role === 'assistant');
		const thinking = records.findLast((record) => record.type === 'thinking_level_change');
		return {
			id: records.find((record) => record.type === 'session')?.id,
			model: last?.message?.model,
			effort: thinking?.thinkingLevel,
		};
	}
	if (provider === 'grok') {
		const last = records.findLast((record) => record.type === 'assistant');
		return {
			id: path.basename(path.dirname(file)),
			model: last?.model_id,
			effort: last?.reasoning_effort,
		};
	}
	if (provider === 'claude') {
		const id = records.find((record) => record.sessionId)?.sessionId;
		const model = records.findLast((record) => record.message?.model)?.message.model;
		return { id, model };
	}
	const id = records.find((record) => record.type === 'session_meta')?.payload.id;
	const context = records.findLast((record) => record.type === 'turn_context')?.payload;
	return { id, model: context?.model, effort: context?.effort };
}

export async function realExternalTurn(
	native: NativeApp,
	provider: Provider,
	prompt: string,
	scene: NativeScene,
	id?: string
) {
	if (id && !native.files(provider).some((file) => nativeIdentity(provider, file).id === id))
		throw new Error('Real acceptance can resume only a session created in this test directory');
	const before = native.files(provider);
	const script = path.join(native.root, `external-${native.externalCount++}.json`);
	// The fixture ignores the actual prompt when used as an installed CLI by
	// the Linux smoke run. A real CLI ignores this fixture-only environment.
	fs.writeFileSync(script, JSON.stringify({ scene }));
	const args =
		provider === 'claude'
			? [
					'--print',
					'--verbose',
					'--output-format',
					'stream-json',
					'--dangerously-skip-permissions',
					...(id ? ['--resume', id] : []),
				]
			: provider === 'copilot'
				? ['--output-format', 'json', '--allow-all', ...(id ? [`--resume=${id}`] : [])]
				: provider === 'omp'
					? ['-p', '--mode', 'json', ...(id ? ['--resume', id] : [])]
					: provider === 'grok'
						? [
								'--output-format',
								'streaming-json',
								'--always-approve',
								...(id ? ['--resume', id] : []),
							]
						: provider === 'opencode'
							? ['run', '--format', 'json', ...(id ? ['--session', id] : [])]
							: [
									'exec',
									'--json',
									'--dangerously-bypass-approvals-and-sandbox',
									'--skip-git-repo-check',
									...(id ? ['resume', id] : []),
								];
	const child = spawn(
		native.realCli!.executable,
		[
			...args,
			provider === 'grok' || provider === 'copilot' ? '-p' : '--',
			realPrompt(native, prompt, scene),
		],
		{
			cwd: native.project,
			env: { ...process.env, ...native.env, MAESTRO_NATIVE_SCRIPT: script },
			timeout: 180000,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		}
	);
	let stdout = '',
		stderr = '';
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	const run = new Promise<void>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code, signal) => {
			if (code === 0) resolve();
			else
				reject(
					Object.assign(new Error(stderr || stdout || `${provider} exited: ${signal ?? code}`), {
						code,
						signal,
					})
				);
		});
	});
	// A failed or timed-out CLI can leave a shell workload holding its pipes
	// open. End only this invocation's process group when the CLI exits.
	child.once('exit', () => {
		try {
			process.kill(-child.pid!, 'SIGTERM');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
		}
	});
	native.externalProcesses.set(child, run);
	try {
		await run;
	} finally {
		native.externalProcesses.delete(child);
	}
	const file = id
		? native.files(provider).find((file) => nativeIdentity(provider, file).id === id)!
		: native.files(provider).find((file) => !before.includes(file))!;
	if (!file) throw new Error('The real CLI did not create a native transcript');
	const identity = nativeIdentity(provider, file);
	if (!identity.id) throw new Error('The real transcript has no native session ID');
	return { ...identity, file };
}

export function nativeToolIds(provider: Provider, file: string, commands: string[]) {
	if (provider === 'opencode') {
		const calls = readOpenCodeState(file).parts.filter((row) => row.data.type === 'tool');
		return commands.map(
			(command) => calls.find((row) => row.data.state.input.command.includes(command))?.data.callID
		);
	}
	const records = fs
		.readFileSync(file, 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	if (provider === 'copilot') {
		const calls = records.flatMap((record) => record.data?.toolRequests ?? []);
		return commands.map(
			(command) => calls.find((call) => call.arguments?.command?.includes(command))?.toolCallId
		);
	}
	if (provider === 'omp') {
		return commands.map(
			(command) =>
				records
					.flatMap((record) => record.message?.content ?? [])
					.find(
						(block) =>
							block.type === 'toolCall' && String(block.arguments?.command ?? '').includes(command)
					)?.id
		);
	}
	if (provider === 'grok') {
		const calls = records.flatMap((record) => record.tool_calls ?? []);
		return commands.map(
			(command) => calls.find((call) => JSON.parse(call.arguments).command?.includes(command))?.id
		);
	}
	const calls =
		provider === 'claude'
			? records.flatMap((record) =>
					Array.isArray(record.message?.content)
						? record.message.content
								.filter((item) => item.type === 'tool_use')
								.map((item) => ({ id: item.id, command: item.input?.command }))
						: []
				)
			: records
					.filter(
						(record) => record.type === 'response_item' && record.payload?.type === 'function_call'
					)
					.map((record) => ({
						id: record.payload.call_id,
						command: JSON.parse(record.payload.arguments).cmd,
					}));
	return commands.map((command) => calls.find((call) => call.command?.includes(command))?.id);
}
