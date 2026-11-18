import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { NativeApp } from './native-app';
import { teamM2Brief } from './native/team-m2.cjs';
import {
	DEFAULT_TEAM_AUTHORIZATIONS,
	type Brief,
	type CreateTeamInput,
	type LedgerEvent,
} from '../../src/shared/team/types';
import { reduceLedger } from '../../src/shared/team/ledger';

export type TeamM2Scenario =
	| 'discussion'
	| 'contested'
	| 'commitment'
	| 'relaxation'
	| 'review'
	| 'permission';

export function prepareNativeTeamM2(
	native: NativeApp,
	scenario: TeamM2Scenario,
	options: {
		gateDiscussion?: boolean;
		gateMessages?: boolean;
		gateReview?: boolean;
		language?: 'en' | 'zh-CN';
	} = {}
) {
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: native.project, encoding: 'utf8' });
	git('init');
	git('config', 'user.name', 'Team M2 fixture');
	git('config', 'user.email', 'team-m2@example.invalid');
	git('config', 'commit.gpgsign', 'false');
	git('config', 'core.hooksPath', path.join(native.root, 'no-hooks'));
	fs.writeFileSync(path.join(native.project, 'result.html'), '<html><body>initial</body></html>');
	fs.writeFileSync(path.join(native.project, 'other.html'), '<html><body>initial</body></html>');
	fs.writeFileSync(
		path.join(native.project, 'check.cjs'),
		"const fs = require('node:fs'); console.log('# tests 1\\n# skipped 0'); process.exit(fs.readFileSync('result.html', 'utf8').includes('<h1>implemented</h1>') ? 0 : 1);\n"
	);
	git('add', '.');
	git('commit', '-m', 'Synthetic M2 project');
	const brief = structuredClone(teamM2Brief) as Omit<Brief, 'version'>;
	const gate = path.join(native.root, 'release-m2-work');
	const proposalGate = path.join(native.root, 'release-m2-proposal');
	const reviewGate = path.join(native.root, 'release-m2-review');
	const messageGate = path.join(native.root, 'release-m2-message');
	const seats = Object.fromEntries(
		(['pm', 'dev', 'qa'] as const).map((seat) => {
			const account = path.join(native.root, `${seat}-m2-account`);
			const script = path.join(native.root, `${seat}-m2-script.json`);
			fs.mkdirSync(account);
			fs.writeFileSync(
				script,
				JSON.stringify({
					teamM2: {
						seat,
						scenario,
						brief,
						...(scenario === 'review' && seat === 'dev' ? { workGate: gate } : {}),
						...(options.gateDiscussion ? { proposalGate: proposalGate } : {}),
						...(options.gateReview ? { reviewGate } : {}),
						...(options.gateMessages ? { messageGate: messageGate } : {}),
					},
				})
			);
			return [
				seat,
				{
					tool: seat === 'dev' ? 'codex' : 'claude-code',
					model: seat === 'dev' ? 'gpt-5.3-codex' : 'claude-sonnet-4-6',
					effort: 'high',
					customPath: path.resolve(`e2e/fixtures/native/${seat === 'dev' ? 'codex' : 'claude'}`),
					customEnv: {
						[seat === 'dev' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']: account,
						MAESTRO_NATIVE_SCRIPT: script,
					},
				},
			];
		})
	) as unknown as CreateTeamInput['seats'];
	const settings = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settings, 'utf8')),
			uiLanguage: options.language ?? 'en',
			newShell: true,
		})
	);
	const events = (teamId: string): LedgerEvent[] => {
		const file = path.join(native.data, 'teams', teamId, 'ledger.jsonl');
		return fs.existsSync(file)
			? fs
					.readFileSync(file, 'utf8')
					.split('\n')
					.filter(Boolean)
					.map((row) => JSON.parse(row))
			: [];
	};
	return {
		brief,
		gate,
		input: {
			idea: 'M2 synthetic acceptance',
			projectRoot: native.project,
			seats,
			turnBudget: 200,
			authorizations: { ...DEFAULT_TEAM_AUTHORIZATIONS, checks: scenario !== 'permission' },
		} satisfies CreateTeamInput,
		events,
		state: (teamId: string) => reduceLedger(events(teamId)),
		releaseDiscussion: () => fs.writeFileSync(proposalGate, 'release'),
		releaseWork: () => fs.writeFileSync(gate, 'release'),
		releaseReview: () => fs.writeFileSync(reviewGate, 'release'),
		releaseMessage: () => fs.writeFileSync(messageGate, 'release'),
	};
}
