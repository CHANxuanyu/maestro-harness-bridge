'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { teamM2Scene } = require('./team-m2.cjs');

// Synthetic native seats use the production prompt/schema and protocol fixture.
// Time advances in the test by editing stopped, isolated persistence, never a product hook.
function teamM3Scene(options, prompt, configDir) {
	const seat = prompt.match(/You are the team's (PM|DEV|QA)\./)?.[1].toLowerCase() || options.seat;
	const kind = prompt.match(/Turn: ([a-z_]+)\./)?.[1];
	const saved = path.join(configDir, 'm3-repair.json');
	if (prompt.startsWith('Your ') && prompt.includes('Resubmit only'))
		return { answer: fs.readFileSync(saved, 'utf8'), completionGate: options.repairGate };
	const countsFile = path.join(configDir, 'm3-counts.json');
	const counts = fs.existsSync(countsFile) ? JSON.parse(fs.readFileSync(countsFile, 'utf8')) : {};
	const key = `${seat}:${kind}`;
	counts[key] = (counts[key] || 0) + 1;
	fs.writeFileSync(countsFile, JSON.stringify(counts));
	const report = (value) => ({
		answer: `Synthetic M3 observation\n\n\`\`\`team-report\n${JSON.stringify(value)}\n\`\`\``,
	});
	if (kind === 'wrap_up')
		return report({
			type: kind,
			summary: 'Finish current proof and report remaining gaps',
			priorities: ['A1', 'E1'],
		});
	if (kind === 'wait')
		return report({
			type: kind,
			summary: 'External job still running normally',
			status: 'waiting',
		});
	if (options.scenario === 'idle-turn' && seat === 'dev' && ['work', 'message'].includes(kind))
		return report(
			kind === 'work'
				? { type: kind, done: [], claimsComplete: false, summary: 'No observed change' }
				: { type: kind, messages: [], summary: 'No observed change' }
		);
	if (options.scenario === 'wait' && seat === 'dev' && kind === 'work')
		return report({
			type: kind,
			done: [],
			claimsComplete: false,
			summary: 'External build pending',
			waiting: { reason: 'Normal external work', waitFor: 'Synthetic build status' },
		});
	const scene = teamM2Scene({ ...options, seat, scenario: 'm3' }, prompt, configDir);
	if (seat === 'pm' && options.seat !== 'pm' && kind === 'review')
		scene.completionGate = options.takeoverGate;
	if (options.scenario === 'no-progress' && seat === 'dev' && kind === 'work') {
		const revision = Math.min(counts[key], 3);
		scene.writes['result.html'] = `<html><body>Broken revision ${revision}</body></html>`;
	}
	if (options.scenario === 'restart' && seat === 'dev' && kind === 'work' && counts[key] === 1)
		scene.completionGate = options.gate;
	if (seat !== 'pm' || kind !== 'review' || counts[key] !== 1 || options.seat !== 'pm')
		return scene;
	fs.writeFileSync(saved, scene.answer);
	switch (options.scenario) {
		case 'quota-wait':
		case 'quota-substitute':
		case 'quota-temporary':
			scene.answer = "You've hit your 5-hour limit. resets 11:10pm";
			scene.quotaFailure = true;
			break;
		case 'missing-report':
			scene.answer = 'Inspected both viewers; the report was omitted.';
			break;
		case 'bad-report':
			scene.answer = '```team-report\n{broken}\n```';
			break;
		case 'turn-failed':
			scene.exitError = 'Synthetic transient execution failure';
			break;
		case 'session-broken':
			scene.exitError = 'No conversation found with session ID: synthetic-broken';
			break;
		case 'login-expired':
			scene.authFailure = true;
			break;
		case 'still-working':
			scene.exitGate = options.gate;
			break;
	}
	return scene;
}
module.exports = { teamM3Scene };
