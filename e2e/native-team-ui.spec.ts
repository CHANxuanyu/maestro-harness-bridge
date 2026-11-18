import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { revealTeamCard as revealCard } from './fixtures/team-ui';
import { NativeApp } from './fixtures/native-app';
import { prepareNativeTeam } from './fixtures/native-team';
import { TEAM_PHASES, type TeamConfig } from '../src/shared/team/types';
import { team as en } from '../src/renderer/i18n/locales/en/team';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Team UI acceptance uses synthetic providers only');

// eslint-disable-next-line no-empty-pattern
test('team UI: a project without conversations remains reachable through acceptance', async ({}, info) => {
	test.setTimeout(240_000);
	const native = new NativeApp(info, { providerCli: false });
	const fixture = prepareNativeTeam(native, { gateRepairs: true });
	let team: TeamConfig;
	const state = () => fixture.state(team.id);
	let open = false;
	let failed = false;
	const screenshot = async (stage: 'baseline' | 'demo' | 'terminal') => {
		const directory = process.env.MAESTRO_E2E_SHOTS;
		if (!directory) return;
		fs.mkdirSync(directory, { recursive: true });
		await native.page.screenshot({ path: path.join(directory, `native-team-ui-${stage}.png`) });
	};
	try {
		await native.start();
		open = true;
		const page = native.page;
		// Creation is external to the UI, with no runner or project pre-seeded in the window.
		expect(await page.evaluate(() => window.maestro.sessions.getAll())).toEqual([]);
		team = await page.evaluate((input) => window.maestro.team.create(input), fixture.input);
		const project = page.locator('[data-project-key]').filter({
			has: page.locator(`[data-team-id="${team.id}"]`),
		});
		const teamRow = project.locator(`[data-team-id="${team.id}"]`);
		await expect(teamRow).toBeVisible();
		await expect(project).toHaveAttribute('data-project-key', `path:local:${native.project}`);
		await expect(project.locator('[data-team-seat]')).toHaveCount(3);
		await expect(page.getByTestId('sidebar-new-conversation')).toBeVisible();
		await expect(
			page.getByRole('button', { name: en['workflows.team.new'], exact: true })
		).toBeVisible();
		await teamRow.click();
		const view = page.getByTestId('team-view');
		const main = view.locator('main');
		await expect(view).toBeVisible();
		const phaseStrip = page.getByTestId('team-phase-strip');
		const status = page.getByTestId('team-status');
		const header = page.getByTestId('team-header');
		const assertChrome = async () => {
			const snapshot = state();
			await expect(header).toContainText(team.title);
			await expect(header).toContainText(en['workflows.team.noDeadline']);
			await expect
				.poll(async () =>
					(await header.innerText()).includes(
						`${state().usage.turns}/${team.turnBudget} turns used`
					)
				)
				.toBe(true);
			await expect(phaseStrip.locator('[aria-current="step"]')).toHaveText(
				new RegExp(en[`workflows.team.phase.${snapshot.phase}`])
			);
			for (const phase of TEAM_PHASES)
				await expect(phaseStrip).toContainText(en[`workflows.team.phase.${phase}`]);
			await expect(status.locator('[data-status-cell]')).toHaveCount(4);
		};

		await expect
			.poll(() => state().openCards.map((card) => card.boundary), { timeout: 90_000 })
			.toEqual(['baseline']);
		const proposedVersion = state().baseline.proposedVersion;
		expect(proposedVersion).not.toBeNull();
		const baseline = main.locator('section[data-boundary="baseline"]');
		await expect(baseline).toBeVisible();
		await expect(baseline).not.toContainText(/"brief"|"trials"|"evidenceId"|Boundary:/);
		await expect(baseline).toContainText(en['workflows.team.baselineDryRun']);
		await assertChrome();
		await expect(phaseStrip).toContainText('Needs you 1');
		await expect(status.locator('[data-status-cell="now"]')).toContainText(
			en['workflows.team.waitingOwner']
		);
		await expect(status.locator('[data-status-cell="solving"]')).toContainText(
			state().brief!.scope
		);
		await expect(status.locator('[data-status-cell="next"]')).toContainText(
			en['workflows.team.baseline'].replace('{version}', String(proposedVersion))
		);
		await expect(status.locator('[data-status-cell="output"]')).toContainText(
			en['workflows.team.noneYet']
		);
		const brief = main.locator('[data-card="brief"]').first();
		await revealCard(brief);
		await expect(brief).toContainText('Deliver a text result');
		const challenges = main.locator('[data-card="challenge"]');
		await expect(challenges).toHaveCount(2);
		for (const challenge of await challenges.all()) {
			await revealCard(challenge);
			await expect(challenge).not.toHaveAttribute('open');
			await challenge.locator(':scope > summary').click();
			await expect(challenge).toContainText(/DEV_ISOLATED_TEXT|QA_ISOLATED_TEXT/);
		}
		// The app's trial check is evidence about the command, not the delivered result.
		const trial = main.locator('[data-card="check"]').first();
		await revealCard(trial);
		await trial.locator(':scope > summary').click();
		await expect(trial).toContainText(en['workflows.team.trial']);
		await expect(trial).toContainText('node check.cjs');

		const seat = project.locator('[data-team-seat="dev"]');
		await seat.click();
		const member = page.getByTestId('team-member-view');
		await expect(member).toBeVisible();
		const devModelName = await page.evaluate(async (seat) => {
			const catalog = await window.maestro.agents.getModelCatalog({
				provider: 'codex',
				account: { customEnvVars: seat.customEnv },
			});
			return catalog.models.find((model) => model.id === seat.model)?.displayName ?? seat.model!;
		}, team.seats.dev);
		await expect(member).toContainText(devModelName);
		await expect(member).toContainText('The check needs a stable result.');
		await expect(
			member.getByRole('textbox', { name: en['workflows.team.message'], exact: true })
		).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(member).toHaveCount(0);
		await expect(seat).toBeFocused();
		await expect(main).toBeVisible();

		const note = 'Please preserve the independent bad-input check.';
		await main.getByRole('textbox', { name: en['workflows.team.message'], exact: true }).fill(note);
		await main.getByRole('button', { name: en['workflows.team.send'], exact: true }).click();
		await expect.poll(() => state().pendingMessages.map((message) => message.text)).toContain(note);
		const message = main.locator('[data-card="owner-message"]').filter({ hasText: note });
		await expect(message).toContainText(/Queued for PM|Delivered to PM/);
		await baseline.scrollIntoViewIfNeeded();
		await screenshot('baseline');
		await baseline
			.getByRole('button', {
				name: en['workflows.team.confirmBaseline'],
				exact: true,
			})
			.click();
		await expect.poll(() => state().baseline.confirmedVersion).toBe(proposedVersion);
		fixture.releaseMessage();
		await expect.poll(() => state().messages[0]?.handled?.seat).toBe('pm');
		await expect.poll(() => state().phase).toBe('implement');
		await expect
			.poll(() => fixture.events(team.id).some((event) => event.kind === 'qa_boundary_restored'))
			.toBe(true);
		await expect
			.poll(() =>
				JSON.stringify(fixture.nativeRows('dev')).includes('IMPLEMENTATION_READY_FOR_RESTART')
			)
			.toBe(true);
		await assertChrome();
		fixture.releaseImplementation();
		await expect
			.poll(() => state().turns.some((turn) => turn.dispatched?.turn === 'verify'))
			.toBe(true);
		const productCheck = fixture
			.events(team.id)
			.find(
				(event) => event.kind === 'check_run' && event.purpose !== 'trial' && event.exitCode === 0
			)!;
		expect(productCheck).toBeDefined();
		const checks = main.locator(`[data-team-event="${productCheck.id}"] [data-card="check"]`);
		await revealCard(checks);
		await checks.locator(':scope > summary').click();
		await expect(checks).toContainText('node check.cjs');
		await expect(checks).toContainText(en['workflows.team.pass']);
		await assertChrome();

		fixture.releaseVerification(team.id);
		const issue = main.locator('[data-card="issue"]');
		await expect.poll(() => state().issues[0]?.state).toBe('opened');
		await revealCard(issue);
		await expect(issue).toHaveAttribute('data-state', 'opened');
		await expect(issue).toContainText('Bad-input sample fails');
		fixture.releaseFix();
		// QA's reverify can finish before this poll samples the intermediate state,
		// so wait for the fix claim to land and check the order in the ledger below.
		await expect.poll(() => state().issues[0]?.state).toMatch(/^(fixed-claimed|verified-pass)$/);
		fixture.releaseRetest();
		await expect
			.poll(() => state().openCards.map((card) => card.boundary), { timeout: 90_000 })
			.toEqual(['acceptance']);
		await revealCard(issue);
		await expect(issue).toHaveAttribute('data-state', 'verified-pass');
		for (const step of ['opened', 'fixed-claimed', 'verified-pass'] as const)
			await expect(issue).toContainText(en[`workflows.team.${step}`]);
		// The fixer never verifies: dev claims the fix, then QA closes it.
		const chain = fixture
			.events(team.id)
			.filter((event) => event.kind === 'issue_fixed' || event.kind === 'issue_verified');
		expect(chain.map((event) => `${event.kind}:${event.actor}`)).toEqual([
			'issue_fixed:dev',
			'issue_verified:qa',
		]);
		const review = main.locator('[data-card="review"]');
		await revealCard(review);
		await expect(review).toContainText(en['workflows.team.pass']);
		await revealCard(message);
		await expect(message).toHaveAttribute('data-delivery', 'handled');
		await expect(message).toContainText(
			en['workflows.team.handled'].replace('{seat}', en['workflows.team.pm'])
		);
		const receipt = state().messages.find((entry) => entry.message.text === note)!;
		expect(receipt.delivered?.kind).toBe('message_delivered');
		expect(receipt.handled?.kind).toBe('message_handled');
		expect(receipt.handled!.seq).toBeGreaterThan(receipt.delivered!.seq);
		expect(state().pendingMessages).toHaveLength(0);
		expect(fixture.events(team.id)).toContainEqual(
			expect.objectContaining({ kind: 'owner_message', to: 'pm', text: note })
		);

		const demo = main.locator('[data-card="demo"]');
		await expect(demo).toBeVisible();
		await assertChrome();
		await expect(status.locator('[data-status-cell="output"]')).toContainText(
			en['workflows.team.preview']
		);
		const output = demo.getByTestId('team-output');
		await expect(output).toBeVisible();
		await output.locator(':scope > details > summary').click();
		await expect(output).not.toContainText(native.root);
		await expect(
			demo.getByRole('button', { name: en['workflows.team.viewChanges'], exact: true })
		).toBeVisible();
		await output.getByRole('button', { name: /result\.txt$/ }).click();
		await expect(output).toContainText('implemented with bad-input handling');
		expect(
			await demo.evaluate((element) => {
				const output = element.querySelector('[data-testid="team-output"]')!;
				const summary = [...element.children].find((child) => child.tagName === 'P')!;
				return !!(output.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING);
			})
		).toBe(true);
		const events = fixture.events(team.id);
		const ordered = [
			events.find((event) => event.kind === 'brief_published'),
			events.find((event) => event.kind === 'challenge_submitted'),
			events.find((event) => event.kind === 'decision_card' && event.card.boundary === 'baseline'),
			productCheck,
			events.find((event) => event.kind === 'issue_opened'),
			events.find((event) => event.kind === 'review'),
			events.find((event) => event.kind === 'demo'),
		];
		const rendered = await main
			.locator('[data-team-event]')
			.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-team-event')));
		let previous = -1;
		for (const event of ordered) {
			expect(event).toBeDefined();
			const position = rendered.indexOf(event!.id);
			expect(position).toBeGreaterThan(previous);
			previous = position;
		}
		await demo.scrollIntoViewIfNeeded();
		await screenshot('demo');
		const accept = demo.getByRole('button', { name: en['workflows.team.accept'], exact: true });
		await expect(accept).toBeEnabled();
		await accept.click();
		await expect.poll(() => state().terminal).toBe('all');
		await expect(teamRow).toHaveAttribute('title', /已验收：全部达标|Accepted: all criteria met/);
		await expect(status.locator('[data-status-cell="now"]')).toContainText(
			en['workflows.team.accepted']
		);
		await expect(status.locator('[data-status-cell="solving"]')).toContainText(
			en['workflows.team.noProblems']
		);
		await expect(status.locator('[data-status-cell="next"]')).toContainText(
			en['workflows.team.noNext']
		);
		await assertChrome();
		await expect(main.locator('[data-card="summary"]')).toBeVisible();
		await expect(main.locator('[data-card="summary"]')).toHaveCount(1);
		await expect(main.locator('[data-card="summary"]')).toContainText(
			en['workflows.team.summaryOwnerCounts']
				.replace('{decisions}', String(state().statistics.ownerDecisions))
				.replace('{messages}', '1')
		);
		await main.locator('[data-card="summary"]').scrollIntoViewIfNeeded();
		await screenshot('terminal');
		// Terminal teams remain selectable under the same path-backed project.
		await seat.click();
		await expect(member).toBeVisible();
		await teamRow.click();
		await expect(main.locator('[data-card="summary"]')).toBeVisible();
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (open) await native.close(failed);
	}
});
