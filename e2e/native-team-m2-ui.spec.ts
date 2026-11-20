import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { prepareNativeTeamM2, type TeamM2Scenario } from './fixtures/native-team-m2';
import { revealTeamCard } from './fixtures/team-ui';
import { team as en } from '../src/renderer/i18n/locales/en/team';
import { team as zh } from '../src/renderer/i18n/locales/zh-CN/team';
import type { TeamConfig } from '../src/shared/team/types';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'M2 UI acceptance uses scripted providers only');

const runs: Array<{ scenario: TeamM2Scenario; language: 'en' | 'zh-CN' }> = [
	...(['discussion', 'contested', 'commitment', 'relaxation', 'review', 'permission'] as const).map(
		(scenario) => ({ scenario, language: 'en' as const })
	),
	{ scenario: 'review', language: 'zh-CN' },
];
for (const { scenario, language } of runs) {
	// eslint-disable-next-line no-empty-pattern
	test(`M2 UI ${scenario} ${language}: owner actions update the ledger`, async ({}, info) => {
		test.setTimeout(300_000);
		const native = new NativeApp(info, { providerCli: false });
		const fixture = prepareNativeTeamM2(native, scenario, {
			language,
			gateDiscussion: scenario === 'discussion' || scenario === 'contested',
			gateMessages: scenario === 'review',
			gateReview: scenario === 'review',
		});
		const strings = language === 'en' ? en : { ...en, ...zh };
		let team: TeamConfig | undefined;
		const state = () => fixture.state(team!.id);
		let started = false;
		let failed = false;
		const shot = async (stage: string) => {
			if (!process.env.MAESTRO_E2E_SHOTS) return;
			fs.mkdirSync(process.env.MAESTRO_E2E_SHOTS, { recursive: true });
			await native.page.screenshot({
				path: path.join(
					process.env.MAESTRO_E2E_SHOTS,
					`native-team-m2-ui-${scenario}-${language}-${stage}.png`
				),
			});
		};
		try {
			await native.start();
			started = true;
			const page = native.page;
			team = await page.evaluate((input) => window.maestro.team.create(input), fixture.input);
			await page.locator(`[data-team-id="${team.id}"]`).click();
			const main = page.getByTestId('team-view').locator('main');
			const activeCard = (boundary: string) =>
				main.locator(`[data-card][data-boundary="${boundary}"][data-emphasis="true"]`);
			if (scenario === 'permission') {
				await activeCard('permission').locator('[data-option="allow"]').click();
				await expect
					.poll(() => state().cardAnswers.some((answer) => answer.optionId === 'allow'))
					.toBe(true);
			}
			await expect(activeCard('baseline')).toBeVisible();
			if (scenario === 'review') {
				const oldVersion = state().brief!.version;
				await activeCard('baseline').locator('[data-action="edit-criterion"]').first().click();
				const criterionText = activeCard('baseline').getByRole('textbox', {
					name: strings['workflows.team.criterionText'],
					exact: true,
				});
				await expect(criterionText).toBeEditable();
				await criterionText.fill('Output contains implemented heading in the document');
				await activeCard('baseline')
					.getByLabel(strings['workflows.team.proofKind'])
					.selectOption('app');
				await activeCard('baseline')
					.getByLabel(strings['workflows.team.proofHow'])
					.fill('node check.cjs');
				await activeCard('baseline')
					.getByRole('button', { name: strings['workflows.team.saveCriterion'] })
					.click();
				await expect.poll(() => state().brief!.version).toBeGreaterThan(oldVersion);
				await expect
					.poll(() => state().brief!.criteria[0].text)
					.toBe('Output contains implemented heading in the document');
				await expect(activeCard('baseline')).toBeVisible();
				await activeCard('baseline').locator('[data-action="baseline-diff"]').click();
				await expect(activeCard('baseline').locator('[data-card="baseline-diff"] del')).toHaveCount(
					1
				);
				await shot('baseline-diff');
				await activeCard('baseline').locator('[data-action="baseline-return"]').click();
				await activeCard('baseline')
					.getByLabel(strings['workflows.team.returnNote'])
					.fill('Include the footer');
				await activeCard('baseline')
					.getByRole('button', { name: strings['workflows.team.returnSend'], exact: true })
					.click();
				await expect.poll(() => state().baseline.returns.length).toBe(1);
				await expect
					.poll(() => state().brief!.criteria[1].text, { timeout: 90_000 })
					.toContain('footer');
			}
			await expect(activeCard('baseline')).toBeVisible({ timeout: 90_000 });
			const proposedVersion = state().baseline.proposedVersion;
			await activeCard('baseline').locator('[data-option="confirm"]').click();
			await expect.poll(() => state().baseline.confirmedVersion).toBe(proposedVersion);
			if (scenario === 'review') {
				await expect.poll(() => state().seats.dev.activeDispatchIds.length).toBe(1);
				const composer = page.getByTestId('team-composer');
				await composer.getByRole('textbox').fill('@dev Please explain the sample');
				await composer.getByRole('textbox').press('Enter');
				await expect(composer.locator('[data-delivery="queued"]')).toBeVisible();
				fixture.releaseWork();
				await expect(composer.locator('[data-delivery="delivered"]')).toBeVisible();
				expect(state().messages[0].handled).toBeUndefined();
				fixture.releaseMessage();
				await expect(composer.locator('[data-delivery="handled"]')).toBeVisible();
				expect(state().messages[0].handled!.seq).toBeGreaterThan(
					state().messages[0].delivered!.seq
				);
			}
			if (scenario === 'discussion' || scenario === 'contested') {
				await expect
					.poll(
						() =>
							state().discussions.find((entry) => entry.opened?.trigger === 'member')?.positions
								.length,
						{ timeout: 90_000 }
					)
					.toBe(3);
				const discussion = state().discussions.find((entry) => entry.opened?.trigger === 'member')!;
				const card = main.locator(
					`[data-discussion-id="${discussion.id}"] [data-card="discussion"]`
				);
				await revealTeamCard(card, true);
				await expect(card.locator('[data-sealed="true"]')).toHaveCount(3);
				await expect(card).not.toContainText('sealed position');
				await shot('sealed-positions');
				fixture.releaseDiscussion();
				await expect
					.poll(() => state().discussions.find((entry) => entry.id === discussion.id)?.decision, {
						timeout: 90_000,
					})
					.toBeTruthy();
				await expect(card.locator('[data-sealed="false"]')).toHaveCount(3);
				if (scenario === 'contested') {
					expect(
						state().decisions.find((entry) => entry.discussionId === discussion.id)?.contested
					).toBe(true);
					await expect(card.locator('[data-contested]')).toHaveCount(1);
					await revealTeamCard(card, true);
					await shot('contested-decision');
				}
			}
			if (scenario === 'commitment' || scenario === 'relaxation') {
				await expect(activeCard('commitment')).toBeVisible({ timeout: 90_000 });
				const card = state().openCards.find((entry) => entry.boundary === 'commitment')!;
				const before = state().criteria[0].text;
				if (scenario === 'relaxation') {
					expect(state().criteria[0].status).toBe('fail');
					await expect(activeCard('commitment').locator('[data-standard="before"]')).toContainText(
						before
					);
					await shot('standard-change');
				}
				const option = scenario === 'relaxation' ? 'keep' : 'approve';
				await activeCard('commitment').locator(`[data-option="${option}"]`).click();
				await expect
					.poll(() =>
						state().cardAnswers.some(
							(answer) => answer.cardId === card.id && answer.optionId === option
						)
					)
					.toBe(true);
				await expect
					.poll(() =>
						state().decisions.some(
							(entry) => entry.discussionId === card.discussionId && entry.decider === 'owner'
						)
					)
					.toBe(true);
				if (scenario === 'relaxation') {
					expect(state().criteria[0].text).toBe(before);
					expect(state().standardChanges.some((entry) => entry.change === 'relax')).toBe(false);
					await main
						.getByRole('button', { name: strings['workflows.team.stop'], exact: true })
						.click();
					await expect.poll(() => state().terminal).toBe('stopped');
					return;
				}
			}
			if (scenario === 'review') {
				await expect.poll(() => state().retros.length, { timeout: 120_000 }).toBe(1);
				expect(state().rejectionCount).toBe(2);
				await revealTeamCard(main.locator('[data-card="retro"]'));
				await shot('review-retro');
				fixture.releaseReview();
			}
			await expect
				.poll(() => state().openCards.some((entry) => entry.boundary === 'acceptance'), {
					timeout: 180_000,
				})
				.toBe(true);
			if (scenario === 'review') {
				expect(state().rejectionCount).toBe(3);
				expect(state().retros).toHaveLength(1);
				const demo = main.locator('[data-card="demo"]').last();
				await revealTeamCard(demo);
				await demo.locator('[data-action="request-changes"]').click();
				await demo
					.getByLabel(strings['workflows.team.changeNote'])
					.fill('Also explain empty input');
				await demo.getByRole('button', { name: strings['workflows.team.sendChanges'] }).click();
				await expect
					.poll(() => state().criteria.some((entry) => entry.text === 'Also explain empty input'))
					.toBe(true);
				await expect.poll(() => state().demos.length, { timeout: 120_000 }).toBe(2);
				expect(state().demos[1].criterionIds).toHaveLength(1);
				await revealTeamCard(main.locator('[data-card="demo"]').last());
				await expect(
					main.locator('[data-card="demo"]').last().locator('[data-demo-delta]')
				).toBeVisible();
				await shot('second-demo');
			}
			await main.locator('[data-card="demo"]').last().locator('[data-action="accept"]').click();
			await expect.poll(() => state().terminal).toBe('all');
			await expect(main.locator('[data-card="summary"]')).toBeVisible();
			const seat = page
				.locator('[data-project-key]')
				.filter({ has: page.locator(`[data-team-id="${team.id}"]`) })
				.locator('[data-team-seat="dev"]');
			await seat.click();
			const member = page.getByTestId('team-member-view');
			await expect(member).toBeVisible();
			await member.getByTestId('team-member-turns').locator(':scope > details > summary').click();
			await expect(member.locator('[data-turn]')).toHaveCount(
				state().turns.filter((turn) => turn.seat === 'dev').length
			);
			await expect(
				member.locator('[data-turn-events]').filter({ hasText: 'result.html' }).first()
			).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(member).toHaveCount(0);
			await expect(seat).toBeFocused();
		} catch (error) {
			failed = true;
			if (team)
				fs.writeFileSync(
					info.outputPath('ledger.json'),
					JSON.stringify(fixture.events(team.id), null, '\t')
				);
			throw error;
		} finally {
			if (started) await native.close(failed);
		}
	});
}
