'use strict';

// A second application writes the same documented native records as the CLI.
const { createTurn } = require('./protocol.cjs');
function appendTurn(options, scene) {
	const turn = createTurn(options);
	for (const tool of scene.tools || []) turn.startTool(tool);
	for (const tool of [...(scene.tools || [])].reverse()) turn.finishTool(tool, tool.status);
	turn.finish(scene.answer);
	return turn;
}
module.exports = { appendTurn };
