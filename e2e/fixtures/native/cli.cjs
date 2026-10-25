'use strict';

// Argument sources: src/main/agents/definitions.ts and ChildProcessSpawner.ts.
// Event and file sources are documented in protocol.cjs. No network or accounts.
const fs = require('node:fs');
const path = require('node:path');
const { createTurn, transcriptPath } = require('./protocol.cjs');
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
	if (persist) {
		fs.writeFileSync(stateFile, String(count + 1));
		// Cleanup checks the actual child PID, outside the native transcript.
		fs.writeFileSync(path.join(configDir, 'fixture-process'), String(process.pid));
	}
	const turn = createTurn({
		provider,
		configDir,
		cwd,
		id,
		prompt,
		persist,
		emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
	});
	const tools = scene.tools || [];
	let stopped = false;
	process.once('SIGINT', () => {
		stopped = true;
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
	if (!stopped) turn.finish(scene.answer);
	// Hold the completed native writer before Maestro starts its exit synopsis.
	if (scene.exitGate) while (!fs.existsSync(scene.exitGate) && !stopped) await delay(10);
}

module.exports = { run };
