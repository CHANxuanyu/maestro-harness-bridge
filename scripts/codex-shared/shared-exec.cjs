'use strict';
// Codex exec compatibility transport. Conversation state stays in the native app server.
const { randomUUID } = require('node:crypto');
const { RpcClient } = require('./rpc.cjs');

function parseExecArgs(args) {
	const parsed = { settings: {}, images: [], addDirs: [], json: false };
	const positionals = [];
	let execSeen = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = () => {
			if (++i >= args.length) throw new Error('Missing value for ' + arg);
			return args[i];
		};
		if (arg === '--') {
			positionals.push(...args.slice(i + 1));
			break;
		}
		if (arg === 'exec' && !execSeen) {
			execSeen = true;
			continue;
		}
		if (arg === '--json') {
			parsed.json = true;
			continue;
		}
		if (arg === '--skip-git-repo-check') continue;
		if (arg === '-C' || arg === '--cd') {
			parsed.settings.cwd = value();
			continue;
		}
		if (arg === '-m' || arg === '--model') {
			parsed.settings.model = value();
			continue;
		}
		if (arg === '-i' || arg === '--image') {
			parsed.images.push(value());
			continue;
		}
		if (arg === '--add-dir') {
			parsed.addDirs.push(value());
			continue;
		}
		if (arg === '--dangerously-bypass-approvals-and-sandbox') {
			parsed.settings.sandboxPolicy = { type: 'dangerFullAccess' };
			parsed.settings.approvalPolicy = 'never';
			continue;
		}
		if (arg === '-s' || arg === '--sandbox') {
			const mode = value();
			if (mode === 'read-only') parsed.settings.sandboxPolicy = { type: 'readOnly' };
			else if (mode === 'workspace-write')
				parsed.settings.sandboxPolicy = {
					type: 'workspaceWrite',
					writableRoots: [],
					networkAccess: false,
					excludeTmpdirEnvVar: false,
					excludeSlashTmp: false,
				};
			else if (mode === 'danger-full-access')
				parsed.settings.sandboxPolicy = { type: 'dangerFullAccess' };
			else throw new Error('Unsupported sandbox mode: ' + mode);
			parsed.settings.approvalPolicy = 'never';
			continue;
		}
		if (arg === '-c' || arg === '--config') {
			const text = value();
			const split = text.indexOf('=');
			const key = text.slice(0, split);
			const raw = text.slice(split + 1);
			const map = {
				model_reasoning_effort: 'effort',
				model_reasoning_summary: 'summary',
				model: 'model',
			};
			if (split < 0 || !map[key])
				throw new Error('Shared transport does not support this config override: ' + key);
			let decoded;
			try {
				decoded = JSON.parse(raw);
			} catch {
				decoded = raw;
			}
			if (typeof decoded !== 'string') throw new Error('Expected a string for ' + key);
			parsed.settings[map[key]] = decoded;
			continue;
		}
		if (arg.startsWith('-')) throw new Error('Unsupported shared exec argument: ' + arg);
		positionals.push(arg);
	}
	if (
		!execSeen ||
		!parsed.json ||
		positionals[0] !== 'resume' ||
		!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(positionals[1] || '')
	)
		throw new Error(
			'Shared transport requires exec --json resume <existing thread ID>; it never creates or forks a conversation.'
		);
	if (positionals.length > 3) throw new Error('Expected a single prompt argument');
	parsed.threadId = positionals[1];
	parsed.prompt = positionals[2];
	if (parsed.addDirs.length) {
		if (parsed.settings.sandboxPolicy?.type !== 'workspaceWrite')
			throw new Error('--add-dir requires workspace-write in shared mode');
		parsed.settings.sandboxPolicy.writableRoots = parsed.addDirs;
	}
	return parsed;
}

function translateItem(item, complete) {
	const event = complete ? 'item.completed' : 'item.started';
	const call = (name, args) => ({
		type: 'response_item',
		payload: { type: 'function_call', call_id: item.id, name, arguments: JSON.stringify(args) },
	});
	const result = (output) => ({
		type: 'response_item',
		payload: {
			type: 'function_call_output',
			call_id: item.id,
			output: typeof output === 'string' ? output : JSON.stringify(output),
			status: item.status,
			is_error:
				item.status === 'failed' ||
				item.success === false ||
				item.result?.isError === true ||
				item.error != null,
		},
	});
	switch (item.type) {
		case 'agentMessage':
			return complete
				? [
						{
							type: 'event_msg',
							payload: {
								type: 'agent_message',
								message: item.text,
								phase: item.phase || 'final_answer',
							},
						},
					]
				: [];
		case 'reasoning':
			return complete
				? [
						{
							type: 'response_item',
							payload: {
								type: 'reasoning',
								summary: (item.summary || []).map((text) => ({ type: 'summary_text', text })),
							},
						},
					]
				: [];
		case 'commandExecution':
			return [
				{
					type: event,
					item: {
						id: item.id,
						type: 'command_execution',
						command: item.command,
						aggregated_output: item.aggregatedOutput || '',
						exit_code: item.exitCode,
						status: item.status,
					},
				},
			];
		case 'mcpToolCall':
			return complete
				? [result(item.error || item.result)]
				: [call('mcp__' + item.server + '__' + item.tool, item.arguments)];
		case 'dynamicToolCall':
			return complete
				? [result(item.contentItems || { status: item.status, success: item.success })]
				: [call((item.namespace ? item.namespace + '.' : '') + item.tool, item.arguments)];
		case 'functionCallOutput':
			return complete ? [result(item.output)] : [];
		case 'fileChange':
			return complete
				? [result({ status: item.status, changes: item.changes })]
				: [call('apply_patch', { changes: item.changes })];
		case 'sleep':
			return complete
				? [result(item.status === 'interrupted' ? 'aborted by user after 0s' : 'Wait completed')]
				: [call('clock.sleep', { duration_ms: item.durationMs })];
		case 'webSearch':
			return complete
				? [result(item.results || item.action || { query: item.query })]
				: [call('web_search', { query: item.query })];
		case 'plan':
			return complete
				? [
						{
							type: 'event_msg',
							payload: { type: 'agent_message', message: item.text, phase: 'commentary' },
						},
					]
				: [];
		case 'userMessage':
		case 'hookPrompt':
		case 'contextCompaction':
		case 'subAgentActivity':
			return [];
		default:
			return complete ? [result(item)] : [call(item.type, item)];
	}
}

async function runSharedExec(socket, args, io = {}) {
	const output = io.output || ((event) => process.stdout.write(JSON.stringify(event) + '\n'));
	const parsed = parseExecArgs(args);
	if (parsed.prompt === '-' || parsed.prompt == null) {
		let input = '';
		for await (const part of process.stdin) input += part;
		parsed.prompt = input;
	}
	if (!parsed.prompt?.trim()) throw new Error('Prompt is empty');
	const { threadId } = parsed;
	const client = new RpcClient(socket, 'maestro_shared_exec', 'observe');
	let turnId,
		startRequested = false,
		interrupted = false,
		terminal = false,
		lastUsage;
	const deferredSleeps = new Map();
	const commands = new Map();
	const flushCommand = (command) => {
		clearTimeout(command.timer);
		command.timer = null;
		if (!command.pending) return;
		command.pending = false;
		const [update] = translateItem(
			{ ...command.item, aggregatedOutput: command.output, status: 'in_progress' },
			false
		);
		output({ ...update, type: 'item.updated' });
	};
	const clearCommands = () => {
		for (const command of commands.values()) clearTimeout(command.timer);
		commands.clear();
	};
	const earlyEvents = [];
	let complete, fail;
	const done = new Promise((resolve, reject) => {
		complete = resolve;
		fail = reject;
	});
	// Avoid an unhandled rejection while an earlier setup request is still pending.
	done.catch(() => {});
	const onSignal = async () => {
		interrupted = true;
		if (turnId && !terminal) {
			try {
				await client.request('turn/interrupt', { threadId, turnId }, 5000);
			} catch (error) {
				fail(error);
			}
		}
	};
	const onEvent = (event) => {
		const p = event.params;
		if (terminal || p?.threadId !== threadId) return;
		if (!turnId) {
			if (startRequested) earlyEvents.push(event);
			return;
		}
		const eventTurn = p.turnId || p.turn?.id;
		if (eventTurn && eventTurn !== turnId) return;
		if (event.id != null) {
			output({
				type: 'event_msg',
				payload: {
					type: 'agent_message',
					phase: 'commentary',
					message:
						'Codex is waiting for a client confirmation: ' +
						event.method +
						'. Open this same conversation in Codex to respond, or stop this turn.',
				},
			});
		} else if (event.method === 'item/started' || event.method === 'item/completed') {
			if (p.item.type === 'commandExecution') {
				if (event.method === 'item/started') {
					commands.set(p.item.id, {
						item: p.item,
						output: p.item.aggregatedOutput || '',
						pending: false,
						timer: null,
					});
				} else {
					const command = commands.get(p.item.id);
					if (command) flushCommand(command);
					commands.delete(p.item.id);
				}
			}
			if (p.item.type === 'sleep' && event.method === 'item/completed') {
				deferredSleeps.set(p.item.id, p.item);
				return;
			}
			for (const translated of translateItem(p.item, event.method === 'item/completed'))
				output(translated);
		} else if (event.method === 'item/commandExecution/outputDelta') {
			const command = commands.get(p.itemId);
			if (!command || !p.delta) return;
			command.output += p.delta;
			command.pending = true;
			if (!command.timer) command.timer = setTimeout(() => flushCommand(command), 200);
		} else if (event.method === 'thread/tokenUsage/updated') lastUsage = p.tokenUsage;
		else if (event.method === 'error') {
			if (p.willRetry)
				output({
					type: 'event_msg',
					payload: {
						type: 'agent_message',
						phase: 'commentary',
						message: p.error?.message || 'Codex is retrying the request.',
					},
				});
			else output({ type: 'error', message: p.error?.message || 'Codex turn failed' });
		} else if (event.method === 'turn/completed') {
			for (const command of commands.values()) flushCommand(command);
			clearCommands();
			terminal = true;
			for (const item of deferredSleeps.values())
				for (const translated of translateItem({ ...item, status: p.turn.status }, true))
					output(translated);
			deferredSleeps.clear();
			const last = lastUsage?.last;
			if (p.turn.status === 'failed') {
				output({ type: 'turn.failed', error: p.turn.error });
				fail(new Error(p.turn.error?.message || 'Codex turn failed'));
			} else {
				output({
					type: 'turn.completed',
					usage: last
						? {
								input_tokens: last.inputTokens,
								cached_input_tokens: last.cachedInputTokens,
								output_tokens: last.outputTokens,
								reasoning_output_tokens: last.reasoningOutputTokens,
							}
						: undefined,
				});
				complete({ threadId, turnId, status: p.turn.status, interrupted });
			}
		}
	};
	client.on('notification', onEvent);
	client.on('serverRequest', onEvent);
	client.on('disconnected', () => {
		if (!terminal) fail(new Error('Shared service disconnected. No fallback writer was started.'));
	});
	process.on('SIGINT', onSignal);
	process.on('SIGTERM', onSignal);
	try {
		await client.initialize();
		const resumed = await client.request('thread/resume', { threadId, excludeTurns: true });
		if (resumed.thread.id !== threadId)
			throw new Error('Shared service returned a different thread ID');
		if (resumed.thread.status.type !== 'idle')
			throw new Error(
				'This same session is still generating in another client. Wait for that turn to finish or stop it there.'
			);
		if (interrupted) return { threadId, status: 'interrupted-before-send', interrupted: true };
		const queued = await client.request('thread/queue/list', { threadId });
		if (queued.data.length)
			throw new Error(
				'This session already has queued messages. Resolve that queue in Codex first; no message was added.'
			);
		output({ type: 'thread.started', thread_id: threadId });
		output({ type: 'turn_context', payload: { model: parsed.settings.model || resumed.model } });
		const input = [
			{ type: 'text', text: parsed.prompt, text_elements: [] },
			...parsed.images.map((path) => ({ type: 'localImage', path })),
		];
		if (interrupted) return { threadId, status: 'interrupted-before-send', interrupted: true };
		startRequested = true;
		// Use the ordinary native start API so settings and input are one request
		// and the native turn ID is acknowledged before any model/tool startup.
		// Do not use queue/add followed by queue/start: idle queues auto-dispatch.
		// As with native clients, callers must alternate after a turn is idle;
		// the status preflight is not a cross-client atomic compare-and-set.
		const started = await client.request('turn/start', {
			threadId,
			input,
			clientUserMessageId: randomUUID(),
			...parsed.settings,
		});
		turnId = started.turn.id;
		output({ type: 'turn.started' });
		for (const event of earlyEvents) onEvent(event);
		earlyEvents.length = 0;
		if (interrupted && !terminal) await onSignal();
		return await done;
	} finally {
		clearCommands();
		process.off('SIGINT', onSignal);
		process.off('SIGTERM', onSignal);
		try {
			await client.request('thread/unsubscribe', { threadId }, 5000);
		} catch {}
		client.close();
	}
}

module.exports = { parseExecArgs, translateItem, runSharedExec };
