'use strict';

// Scripted seat reports only. Reuses cli.cjs and the native protocol fixtures.
const fs = require('node:fs');
const path = require('node:path');

const teamM2Brief = {
	scope: 'Readable output in two viewers',
	notDoing: ['Network writes'],
	criteria: [
		{
			id: 'A1',
			text: 'Output contains implemented heading',
			proof: 'app',
			how: 'node check.cjs',
		},
		{
			id: 'E1',
			text: 'Readable output in both viewers',
			proof: 'pm',
			how: 'Inspect both captured previews',
			experience: true,
			locations: [
				{ label: 'First viewer', target: 'result.html', kind: 'preview' },
				{ label: 'Second viewer', target: 'other.html', kind: 'preview' },
			],
		},
	],
	checks: [{ command: 'node check.cjs', covers: ['A1'] }],
};

function teamM2Scene(options, prompt, configDir) {
	const kind = prompt.match(/Turn: ([a-z_]+)\./)?.[1];
	if (!kind) throw new Error('M2 fixture received an unexpected or repair turn');
	const start = prompt.indexOf('\n\n{', prompt.indexOf('Ledger slice')) + 2;
	const end = prompt.indexOf('\n\nEnd with exactly', start);
	const data = JSON.parse(prompt.slice(start, end));
	const statePath = path.join(configDir, 'm2-script-state.json');
	const counts = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
	counts[kind] = (counts[kind] || 0) + 1;
	fs.writeFileSync(statePath, JSON.stringify(counts));
	const scene = {};
	let report;
	const initial = options.brief;
	const discussion = data.discussion;
	const topic = {
		topic: `M2 ${options.scenario} choice`,
		why: 'Synthetic evidence-backed disagreement',
		question: `M2 ${options.scenario} choice`,
		layer: options.scenario === 'commitment' ? 'commitment' : 'implementation',
		participants: ['pm', 'dev', 'qa'],
	};
	const writeOutput = (label) => {
		scene.writes = {
			'result.html': `<html><body><h1>implemented</h1><p>${label}</p></body></html>`,
			'other.html': `<html><body><h1>implemented</h1><p>Second viewer: ${label}</p></body></html>`,
		};
	};
	switch (kind) {
		case 'brief':
			report = { type: kind, ...initial };
			break;
		case 'challenge':
			report = {
				type: kind,
				objections: [],
				...(options.seat === 'qa'
					? {
							plans: data.brief.criteria.map((c) => ({
								criterion: c.id,
								how: c.how,
								data: 'Two rendered viewers',
							})),
						}
					: {}),
			};
			break;
		case 'respond': {
			const brief = data.brief;
			const criteria = brief.criteria.map((criterion) => {
				const copy = { ...criterion };
				delete copy.byOwner;
				return copy;
			});
			if (data.baselineReturns?.length && !criteria[1].text.includes('footer'))
				criteria[1].text += '; footer included';
			report = {
				type: kind,
				decisions: [],
				brief: { scope: brief.scope, notDoing: brief.notDoing, criteria, checks: brief.checks },
			};
			break;
		}
		case 'position':
			report = {
				type: kind,
				discussionId: discussion.id,
				claim: `${options.seat} sealed position`,
				basis: 'Actual sample output',
				wouldChangeMind: 'A fresh sample contradicting the claim',
				...(options.seat === 'dev' ? { extraTurns: 1, preservesDeadline: true } : {}),
			};
			break;
		case 'proposal':
			report = {
				type: kind,
				discussionId: discussion.id,
				proposal: 'Use a reversible implementation that retains the standard',
				decider:
					discussion.topic.layer === 'commitment'
						? 'owner'
						: discussion.topic.layer === 'implementation'
							? 'dev'
							: 'pm',
				actions: discussion.topic.participants.map((seat) => ({
					seat,
					action: `Apply the decision as ${seat}`,
				})),
			};
			break;
		case 'response':
			report = {
				type: kind,
				discussionId: discussion.id,
				result:
					options.scenario === 'contested' &&
					options.seat === 'qa' &&
					discussion.topic.trigger === 'member'
						? 'insist'
						: 'agree',
				reason: 'Keep the complete sample visible',
				...(options.scenario === 'contested' &&
				options.seat === 'qa' &&
				discussion.topic.trigger === 'member'
					? { baselineViolation: 'A1' }
					: {}),
			};
			break;
		case 'retro':
			report = {
				type: kind,
				discussionId: discussion.id,
				causes: 'The earlier approach missed one viewer',
				approach: `Independent viewer comparison ${counts.retro}`,
				basis: `QA sample narrowed the cause ${counts.retro}`,
				difference: 'Compare both viewer screenshots',
				progressEvidence: 'QA confirms at least one previous review issue is resolved',
			};
			break;
		case 'message': {
			report = {
				type: kind,
				summary: 'Owner message handled and any new requirement sent to PM',
				messages: data.messages.map((m) => ({
					messageId: m.messageId,
					scope: m.text.startsWith('SCOPE'),
				})),
			};
			if (data.messages.some((m) => m.text.startsWith('REOPEN'))) report.topic = topic;
			break;
		}
		case 'work':
			writeOutput(`Implementation ${counts.work}`);
			report = {
				type: kind,
				done: ['result.html', 'other.html'],
				summary: 'Produced both views',
				claimsComplete: true,
			};
			if (counts.work === 1 && ['discussion', 'contested', 'commitment'].includes(options.scenario))
				report.topic = topic;
			if (options.scenario === 'relaxation') {
				scene.writes['result.html'] = '<html><body>broken</body></html>';
				if (counts.work === 2)
					report.standardChanges = [
						{
							criterionId: 'A1',
							change: 'relax',
							criterion: { ...initial.criteria[0], text: 'Output may be broken' },
							reason: 'The check currently fails',
						},
					];
			}
			if (counts.work === 1 && options.workGate) scene.exitGate = options.workGate;
			break;
		case 'qa_prep':
			report = { type: kind, tests: ['qa/views.txt'], samples: ['Both viewers'] };
			scene.writes = { 'qa/views.txt': 'Check both viewers\n' };
			break;
		case 'verify':
			report = {
				type: kind,
				criteria: data.brief.criteria
					.filter((c) => c.proof === 'qa')
					.map((c) => ({ id: c.id, pass: true, evidence: 'qa/views.txt independent inspection' })),
				issues: [],
			};
			break;
		case 'fix':
			writeOutput(`Fixed footer ${counts.fix}`);
			report = {
				type: kind,
				fixed: data.issues.map((i) => i.id),
				notFixed: [],
				attempt: {
					basis: 'PM location and QA reproduction',
					difference: `Visible revision ${counts.fix}`,
					expectation: 'Both viewer captures improve',
				},
			};
			break;
		case 'reverify':
			report = {
				type: kind,
				results: data.issues.map((i) => ({
					issue: i.id,
					pass: true,
					evidence: `qa/independent-retest-${counts.reverify}`,
				})),
				newIssues: [],
			};
			break;
		case 'review':
			report = {
				type: kind,
				verdict: options.scenario === 'review' && counts.review <= 3 ? 'reject' : 'pass',
				problems:
					options.scenario === 'review' && counts.review <= 3
						? [
								{
									title: `Footer readability ${counts.review}`,
									location: 'Footer in both viewers',
									criterion: 'E1',
									impact: 'The last word is hard to read',
									expected: 'Readable text in both viewers',
								},
							]
						: [],
				suggestions: ['Consider animation after delivery'],
			};
			break;
		case 'demo':
			report = {
				type: kind,
				summary: 'Both rendered outputs are ready',
				evidence: ['result.html', 'other.html'],
				decisions: [],
				changes: [],
			};
			break;
		default:
			throw new Error(`Unexpected M2 turn ${kind}`);
	}
	scene.answer = `${options.seat} completed ${kind}.\n\n\`\`\`team-report\n${JSON.stringify(report)}\n\`\`\``;
	return scene;
}
module.exports = { teamM2Scene, teamM2Brief };
