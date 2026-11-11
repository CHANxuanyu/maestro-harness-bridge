'use strict';

// Argument sources: src/main/agents/definitions.ts and ChildProcessSpawner.ts.
// Event and file sources are documented in protocol.cjs. No network or accounts.
const fs = require('node:fs');
const path = require('node:path');
const { createTurn, transcriptPath } = require('./protocol.cjs');
const { permissionServer, requestPermission } = require('./claude-permission.cjs');
const { setTimeout: delay } = require('node:timers/promises');

async function run(provider) {
	const args = process.argv.slice(2);
	if (args.includes('--version')) {
		console.log(provider === 'claude' ? '2.1.310 (Claude Code)' : 'codex-cli 0.163.0-alpha.11.1');
		return;
	}
	if (args.includes('--help')) {
		console.log(
			provider === 'claude'
				? '--print --resume --no-session-persistence --effort <level>'
				: 'exec --json resume'
		);
		return;
	}
	if (provider === 'claude' ? !args.includes('--print') : !args.includes('exec'))
		throw new Error('Only the documented print/exec invocation is supported');
	const configDir = provider === 'claude' ? process.env.CLAUDE_CONFIG_DIR : process.env.CODEX_HOME;
	if (!configDir || !process.env.MAESTRO_NATIVE_SCRIPT)
		throw new Error('Missing isolated fixture directories');
	const script = JSON.parse(fs.readFileSync(process.env.MAESTRO_NATIVE_SCRIPT, 'utf8'));
	const flagValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
	const id = flagValue(provider === 'claude' ? '--resume' : 'resume');
	const cwd = flagValue('-C') || process.cwd();
	if (id && !fs.existsSync(transcriptPath(provider, configDir, cwd, id)))
		throw new Error(`No conversation found with session ID: ${id}`);
	let prompt = args.includes('--') ? args.slice(args.indexOf('--') + 1).join(' ') : '';
	if (!prompt) {
		let input = '';
		for await (const chunk of process.stdin) input += chunk;
		if (args.includes('--input-format')) {
			const content = JSON.parse(input.trim()).message.content;
			prompt =
				typeof content === 'string'
					? content
					: content
							.filter((x) => x.type === 'text')
							.map((x) => x.text)
							.join('\n');
		} else prompt = input;
	}
	const persist = !args.includes('--no-session-persistence');
	const stateFile = path.join(configDir, 'fixture-turn-count');
	const count = fs.existsSync(stateFile) ? Number(fs.readFileSync(stateFile, 'utf8')) : 0;
	const scene = persist ? script.scene || script.turns[count] : script.synopsis;
	if (!scene) throw new Error(`No scripted turn ${count}; unexpected invocation`);
	const approvalServer = scene.approval && provider === 'claude' ? permissionServer(args) : null;
	if (persist) {
		fs.appendFileSync(
			path.join(configDir, 'fixture-invocations.jsonl'),
			`${JSON.stringify({ args })}\n`
		);
		fs.writeFileSync(stateFile, String(count + 1));
		// Cleanup checks the actual child PID, outside the native transcript.
		fs.writeFileSync(path.join(configDir, 'fixture-process'), String(process.pid));
	}
	if (scene.authFailure) {
		// Claude Code reports a rejected login as a synthetic assistant message, then
		// a failed result, and exits 1. Parser source: claude-output-parser.ts.
		const text = 'Failed to authenticate. API Error: 401 Invalid authentication credentials';
		const line = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
		line({
			type: 'assistant',
			error: 'authentication_failed',
			message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] },
		});
		line({ type: 'result', subtype: 'success', is_error: true, result: text });
		process.exitCode = 1;
		return;
	}
	if (provider === 'codex' && scene.codexExecEvents) {
		// Replay the observed exec ordering verbatim. Only seed the minimal
		// synthetic history needed for a following resume, without extra stdout.
		const replayId = scene.codexExecEvents[0].thread_id;
		if (id && id !== replayId) throw new Error('Replay thread does not match resume');
		const turn = createTurn({ provider, configDir, cwd, id: replayId, prompt, persist });
		for (const event of scene.codexExecEvents) {
			process.stdout.write(`${JSON.stringify(event)}\n`);
		}
		turn.finish(scene.answer);
		return;
	}
	const turn = createTurn({
		provider,
		configDir,
		cwd,
		id,
		prompt,
		effort: scene.effort,
		slashCommands: scene.slashCommands,
		// Claude Code 2.1.310: --model wins over ANTHROPIC_MODEL. DeepSeek's
		// official integration uses [1m] as a Claude context hint; the gateway
		// reports the underlying model ID (api-docs.deepseek.com/guides/anthropic_api/).
		...(provider === 'claude' && (flagValue('--model') || process.env.ANTHROPIC_MODEL)
			? { model: (flagValue('--model') || process.env.ANTHROPIC_MODEL).replace(/\[1m\]$/, '') }
			: {}),
		persist,
		emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
	});
	const tools = scene.tools || [];
	let stopped = false;
	const approvalAbort = new AbortController();
	process.once('SIGINT', () => {
		stopped = true;
		approvalAbort.abort();
		for (const tool of tools) turn.finishTool(tool, 'canceled');
		// Reproduce the stale exit diagnostic covered by ExitHandler's Stop
		// regressions. Exact provider messages: src/shared/agentErrorPatterns.ts.
		if (scene.stopDiagnostic)
			process.stderr.write(
				provider === 'claude'
					? `No conversation found with session ID: ${turn.id}\n`
					: `thread/resume failed: no rollout found for thread id ${turn.id}\n`
			);
		process.exitCode = 130;
	});
	for (const tool of tools) turn.startTool(tool);
	if (approvalServer) {
		if (!tools.length) throw new Error('Approval fixture requires a proposed tool');
		for (const tool of tools) {
			let decision;
			try {
				decision = await requestPermission(approvalServer, tool, configDir, approvalAbort.signal);
			} catch (error) {
				if (stopped) return;
				throw error;
			}
			if (stopped) return;
			if (decision.behavior === 'deny') {
				for (const pending of tools) turn.finishTool(pending, 'canceled');
				turn.finish(`Permission denied: ${decision.message}`);
				return;
			}
		}
	}
	if (scene.waitForStop) {
		while (!stopped) await delay(25);
		return;
	}
	for (const tool of [...tools].reverse()) {
		for (const [index, output] of (tool.updates || []).entries()) {
			await delay(250);
			turn.updateTool(tool, output);
			// A fixture gate lets the browser inspect each live state before the
			// next native event. It is never passed to Maestro or the protocol.
			if (tool.gates?.[index])
				while (!fs.existsSync(tool.gates[index]) && !stopped) await delay(10);
		}
		await delay(scene.toolDelay ?? 300);
		turn.finishTool(tool, tool.status);
	}
	if (!stopped && persist && scene.writes) {
		for (const [relative, content] of Object.entries(scene.writes)) {
			const target = path.resolve(cwd, relative);
			if (!target.startsWith(path.resolve(cwd) + path.sep))
				throw new Error('Fixture write escapes project');
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, content);
			if (approvalServer)
				fs.appendFileSync(
					path.join(configDir, 'fixture-permission-writes.jsonl'),
					`${JSON.stringify({ target })}\n`
				);
		}
	}
	if (!stopped) turn.finish(scene.answer, { quotaFailure: scene.quotaFailure === true });
	if (provider === 'codex' && !stopped) await delay(1100);
	// Hold the completed native writer before Maestro starts its exit synopsis.
	if (scene.exitGate) while (!fs.existsSync(scene.exitGate) && !stopped) await delay(10);
}

module.exports = { run };
