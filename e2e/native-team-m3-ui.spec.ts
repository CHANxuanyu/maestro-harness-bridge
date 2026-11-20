import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { prepareNativeTeamM3, seedM3Attempts } from './fixtures/native-team-m3';
import { revealTeamCard } from './fixtures/team-ui';
import { reduceLedger } from '../src/shared/team/ledger';
import { team as en } from '../src/renderer/i18n/locales/en/team';
import { team as zh } from '../src/renderer/i18n/locales/zh-CN/team';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'M3 UI uses synthetic seats only');
const runs = [
	{ scenario: 'permission', language: 'en' },
	{ scenario: 'quota-wait', language: 'en' },
	{ scenario: 'login-expired', language: 'en' },
	{ scenario: 'missing-report', language: 'en' },
	{ scenario: 'limits', language: 'en' },
	{ scenario: 'limits', language: 'zh-CN' },
	{ scenario: 'no-progress', language: 'en' },
] as const;
for (const { scenario, language } of runs) {
	// eslint-disable-next-line no-empty-pattern
	test(`M3 UI ${scenario} ${language}`, async ({}, info) => {
		test.setTimeout(240_000);
		const f = await prepareNativeTeamM3(info, scenario === 'limits' ? 'wait' : scenario, 200, {
			language,
			checks: scenario !== 'permission',
			deadline: scenario === 'quota-wait' ? Date.now() + 600_000 : undefined,
			gateRepair: scenario === 'missing-report',
			gateTakeover: scenario === 'quota-wait' || scenario === 'login-expired',
		});
		const strings = language === 'en' ? en : { ...en, ...zh };
		const open = async () => {
			await f.native.page.locator(`[data-team-id="${f.team.id}"]`).click();
			await expect(f.native.page.getByTestId('team-view')).toBeVisible();
		};
		const main = () => f.native.page.getByTestId('team-view').locator('main');
		const active = (boundary: string) =>
			main().locator(`[data-card][data-boundary="${boundary}"][data-emphasis="true"]`);
		const members = async () =>
			f.native.page
				.getByRole('button', { name: strings['workflows.team.membersRules'], exact: true })
				.click();
		const shot = async (stage: string) => {
			if (!process.env.MAESTRO_E2E_SHOTS) return;
			fs.mkdirSync(process.env.MAESTRO_E2E_SHOTS, { recursive: true });
			await f.native.page.screenshot({
				path: path.join(
					process.env.MAESTRO_E2E_SHOTS,
					`native-team-m3-ui-${scenario}-${language}-${stage}.png`
				),
			});
		};
		try {
			await open();
			if (scenario === 'permission') {
				await expect(active('permission')).toBeVisible();
				await shot('permission');
				await active('permission').locator('[data-option="allow"]').click();
				await expect
					.poll(() =>
						f
							.state()
							.cardAnswers.some(
								(answer) => answer.cardId === 'permission:checks' && answer.optionId === 'allow'
							)
					)
					.toBe(true);
				await members();
				await expect(f.native.page.locator('[data-grant="checks"]')).toBeVisible();
			}
			await expect(active('baseline')).toBeVisible({ timeout: 90_000 });
			if (scenario === 'no-progress') {
				await main()
					.getByRole('button', { name: strings['workflows.team.pause'], exact: true })
					.click();
				await expect.poll(() => f.state().paused).toBe(true);
				await f.restartWith(seedM3Attempts);
				await open();
			}
			await active('baseline').locator('[data-option="confirm"]').click();
			if (scenario === 'no-progress') {
				await main()
					.getByRole('button', { name: strings['workflows.team.resume'], exact: true })
					.click();
				await expect
					.poll(() => f.state().discussions.some((d) => d.opened?.trigger === 'no-progress'), {
						timeout: 90_000,
					})
					.toBe(true);
			}

			await expect.poll(() => f.state().baseline.confirmedVersion).not.toBeNull();
			if (scenario === 'quota-wait' || scenario === 'login-expired') {
				await expect
					.poll(() => f.state().unavailable.length, { timeout: 90_000 })
					.toBeGreaterThan(0);
				await expect(main().locator('[data-card="app-status"]')).toBeVisible();
				await main().locator('[data-card="app-status"]').scrollIntoViewIfNeeded();
				await shot('app-status');
				if (scenario === 'quota-wait') {
					await expect(active('permission')).toBeVisible();
					await shot('escalation');
					await active('permission').locator('[data-option="takeover"]').click();
					await expect
						.poll(() => f.state().cardAnswers.some((a) => a.optionId === 'takeover'))
						.toBe(true);
				}
				await expect.poll(() => f.state().seats.pm.takeover).not.toBeNull();
				await members();
				await expect(f.native.page.locator('aside [data-takeover]')).toBeVisible();
				await expect(
					f.native.page.locator(
						`aside [data-fault="${scenario === 'login-expired' ? 'login-expired' : 'model-unavailable'}"]`
					)
				).toBeVisible();
				await shot(scenario === 'login-expired' ? 'login-expired' : 'model-unavailable-takeover');
				fs.writeFileSync(f.gate, 'released');
			}
			if (scenario === 'missing-report') {
				await expect
					.poll(() => f.state().seats.pm.lastFault?.fault, { timeout: 90_000 })
					.toBe('missing-report');
				await members();
				await expect(
					f.native.page.locator('aside [data-seat-health="missing-report"]')
				).toBeVisible();
				await shot('missing-report');
				fs.writeFileSync(f.gate, 'released');
			}
			if (scenario === 'limits') {
				await expect
					.poll(() => f.state().followUps.some((w) => w.seat === 'dev'), { timeout: 90_000 })
					.toBe(true);
				await main()
					.getByRole('button', { name: strings['workflows.team.pause'], exact: true })
					.click();
				await expect.poll(() => f.state().paused).toBe(true);
				await expect(main().getByRole('textbox')).toBeEditable();
				await main()
					.getByRole('button', { name: strings['workflows.team.resume'], exact: true })
					.click();
				await expect.poll(() => f.state().paused).toBe(false);
				await main()
					.getByRole('button', { name: strings['workflows.team.pause'], exact: true })
					.click();
				await expect.poll(() => f.state().paused).toBe(true);
				// Advance the isolated stopped fixture clock, as in the backend limit scenarios.
				await f.restartWith((rows) => {
					const created = rows.find((e) => e.kind === 'team_created')!;
					if (created.kind === 'team_created')
						created.config.turnBudget = reduceLedger(rows).usage.budgetTurns;
				});
				await open();
				await expect(active('budget')).toBeVisible();
				await shot('unfinished-report');
				const used = f.state().usage.turns;
				await active('budget').locator('[data-option="extend"]').click();
				await expect
					.poll(() => f.events().filter((event) => event.kind === 'budget_extended').length)
					.toBe(1);
				expect(f.state().usage.turns).toBe(used);
				await f.restartWith((rows) => {
					const extension = rows.findLast((e) => e.kind === 'budget_extended');
					if (extension?.kind === 'budget_extended') extension.deadline = Date.now() - 1;
				});
				await open();
				await expect(active('budget')).toBeVisible();
				await active('budget').locator('[data-option="gaps"]').click();
				await expect.poll(() => f.state().terminal).toBe('gaps');
				const summary = main().locator('[data-card="summary"]');
				await expect(summary).toBeVisible();
				expect(f.state().criteria.some((c) => c.status !== 'pass')).toBe(true);
				await summary
					.getByLabel(strings['workflows.team.followUpOwner'])
					.first()
					.fill('Synthetic owner');
				await summary
					.getByRole('button', { name: strings['workflows.team.saveOwner'] })
					.first()
					.click();
				await expect
					.poll(() => f.state().residualItems.some((item) => item.owner === 'Synthetic owner'))
					.toBe(true);
				await shot('gaps-terminal');
			} else if (scenario === 'no-progress') {
				await expect
					.poll(
						() => Object.values(f.state().problems).some((p) => p.progress.attempts.length >= 3),
						{ timeout: 90_000 }
					)
					.toBe(true);
				await f.native.page
					.getByRole('tab', { name: new RegExp(strings['workflows.team.panel.progress']) })
					.click();
				await expect(
					f.native.page.getByTestId('team-attempts').locator('[data-verdict]').first()
				).toBeVisible();
				await shot('attempt-ledger');
			} else if (scenario !== 'login-expired') {
				await expect.poll(() => f.state().demos.length, { timeout: 90_000 }).toBeGreaterThan(0);
				await revealTeamCard(main().locator('[data-card="demo"]').last());
				await main().locator('[data-action="accept"]').click();
				await expect.poll(() => f.state().terminal).toBe('all');
			}
			await members();
			const bill = f.native.page.locator('aside [data-testid="team-cost"]');
			await expect(bill).toBeVisible();
			await expect
				.poll(async () => {
					const cost = await f.cli('show', 'cost');
					return (
						(await bill
							.locator('[data-cost-seat="total"] [data-turns]')
							.getAttribute('data-turns')) === String(cost.usage.turns)
					);
				})
				.toBe(true);
			await bill.scrollIntoViewIfNeeded();
			await shot('cost');
		} finally {
			await f.native.close(test.info().status !== test.info().expectedStatus);
		}
	});
}
