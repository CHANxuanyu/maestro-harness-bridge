import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, type TestInfo } from '@playwright/test';
import { NativeApp } from './native-app';
import { teamM2Brief } from './native/team-m2.cjs';
import { reduceLedger } from '../../src/shared/team/ledger';
import {
	DEFAULT_TEAM_AUTHORIZATIONS,
	type CreateTeamInput,
	type LedgerEvent,
	type TeamConfig,
} from '../../src/shared/team/types';
import type { FollowUp } from '../../src/shared/followUp';

export async function prepareNativeTeamM3(
	info: TestInfo,
	scenario: string,
	turns = 200,
	options: {
		language?: 'en' | 'zh-CN';
		checks?: boolean;
		deadline?: number;
		gateRepair?: boolean;
		gateTakeover?: boolean;
	} = {}
) {
	const native = new NativeApp(info, { providerCli: false });
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: native.project, encoding: 'utf8' });
	git('init');
	git('config', 'user.name', 'M3 synthetic fixture');
	git('config', 'user.email', 'm3@example.invalid');
	git('config', 'commit.gpgsign', 'false');
	git('config', 'core.hooksPath', path.join(native.root, 'no-hooks'));
	fs.writeFileSync(path.join(native.project, 'result.html'), '<html><body>Initial</body></html>');
	fs.writeFileSync(path.join(native.project, 'other.html'), '<html><body>Initial</body></html>');
	fs.writeFileSync(
		path.join(native.project, 'check.cjs'),
		"console.log('# tests 1\\n# skipped 0'); process.exit(require('node:fs').readFileSync('result.html','utf8').includes('<h1>implemented</h1>') ? 0 : 1);\n"
	);
	git('add', '.');
	git('commit', '-m', 'Synthetic M3 project');
	const gate = path.join(native.root, 'release-m3');
	const seats = Object.fromEntries(
		['pm', 'dev', 'qa'].map((seat) => {
			const tool = seat === 'dev' ? 'codex' : 'claude-code';
			const account = path.join(native.root, `${seat}-account`);
			const script = path.join(native.root, `${seat}-script.json`);
			fs.mkdirSync(account);
			fs.writeFileSync(
				script,
				JSON.stringify({
					teamM3: {
						seat,
						scenario,
						gate,
						brief: teamM2Brief,
						repairGate: options.gateRepair ? gate : undefined,
						takeoverGate: options.gateTakeover ? gate : undefined,
					},
				})
			);
			return [
				seat,
				{
					tool,
					model: tool === 'codex' ? 'gpt-5.3-codex' : 'claude-sonnet-4-6',
					customPath: path.resolve(`e2e/fixtures/native/${tool === 'codex' ? 'codex' : 'claude'}`),
					customEnv: {
						[tool === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']: account,
						MAESTRO_NATIVE_SCRIPT: script,
					},
				},
			];
		})
	) as unknown as CreateTeamInput['seats'];
	if (scenario === 'quota-substitute')
		seats.pm.substitute = { tool: seats.dev.tool, model: seats.dev.model };
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			uiLanguage: options.language ?? 'en',
		})
	);
	await native.start();
	const team: TeamConfig = await native.page.evaluate(
		(input) => window.maestro.team.create(input),
		{
			idea: `M3 ${scenario}`,
			projectRoot: native.project,
			seats,
			turnBudget: turns,
			deadline: options.deadline,
			authorizations: {
				...DEFAULT_TEAM_AUTHORIZATIONS,
				checks: options.checks ?? true,
				temporaryTakeover: ['quota-temporary', 'login-expired'].includes(scenario),
			},
		}
	);
	const file = path.join(native.data, 'teams', team.id, 'ledger.jsonl');
	const events = (): LedgerEvent[] =>
		fs
			.readFileSync(file, 'utf8')
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((row) => JSON.parse(row));
	const state = () => reduceLedger(events());
	const cli = (...args: string[]) => native.cli('team', ...args, '--team', team.id);
	const confirm = async () => {
		await expect
			.poll(() => state().openCards.some((c) => c.boundary === 'baseline'), { timeout: 90_000 })
			.toBe(true);
		await cli('baseline', 'confirm');
	};
	// Only mutate stopped fixture persistence to advance a clock or reproduce a crash boundary.
	const restartWith = async (
		change: (rows: LedgerEvent[]) => void,
		waits?: (records: FollowUp[]) => void
	) => {
		await native.close();
		const rows = events();
		change(rows);
		fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
		if (waits) {
			const waitFile = path.join(native.data, 'follow-ups.json');
			const records: FollowUp[] = JSON.parse(fs.readFileSync(waitFile, 'utf8'));
			waits(records);
			fs.writeFileSync(waitFile, JSON.stringify(records));
		}
		await native.start();
	};
	return { native, team, gate, events, state, cli, confirm, restartWith };
}

/** Synthetic persisted history, only applied while the fixture app is stopped. */
export function seedM3Attempts(rows: LedgerEvent[]): void {
	for (let index = 0; index < 3; index++)
		rows.push({
			id: `synthetic-attempt:${index}`,
			at: Date.now(),
			seq: rows.length + 1,
			actor: 'app',
			kind: 'attempt',
			problemId: 'checks',
			initialFailures: ['synthetic-check'],
			attempt: {
				id: `synthetic-attempt:${index}`,
				category: ['locate', 'experiment', 'change'][index],
				plan: `Different wording ${index}`,
				basis: 'Synthetic persisted app observation',
				difference: 'No observed improvement',
				expectation: 'The check should pass',
				fingerprint: index === 1 ? 'change:0' : `change:${index}`,
				failures: ['synthetic-check'],
			},
		});
}
