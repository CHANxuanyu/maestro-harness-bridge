'use strict';

// Reuse the native E2E encoder, whose source comments pin Codex
// rust-v0.163.0-alpha.11.1 and the verified official Claude Code 2.1.310 package.
// No benchmark-only fields enter native events. All text is synthetic.
const { randomUUID } = require('node:crypto');
const { createTurn } = require('../e2e/fixtures/native/protocol.cjs');

function appendTurn(fixture, index, output = 'synthetic result '.repeat(12)) {
	const turn = createTurn({ ...fixture, cwd: fixture.project, prompt: `request ${index} needle` });
	for (const suffix of ['first', 'second']) {
		const tool = { id: randomUUID(), command: `printf ${index}-${suffix}`, output };
		turn.startTool(tool);
		turn.finishTool(tool);
	}
	turn.finish(`answer ${index} ${'synthetic response '.repeat(10)}`);
	return turn.file;
}

function createSession(provider, configDir, project, count, output) {
	const fixture = { provider, configDir, project, id: randomUUID(), count };
	for (let index = 0; index < count / 4; index++) fixture.file = appendTurn(fixture, index, output);
	return fixture;
}

module.exports = { createSession, appendTurn };
