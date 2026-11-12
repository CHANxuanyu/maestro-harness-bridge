import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { RealAcceptanceApp, acceptanceEnabled } from './fixtures/real-acceptance';

// Three user turns, no automatic retries. DeepSeek is optional only in this relay.
test.skip(
	!acceptanceEnabled('RELAY'),
	'requires MAESTRO_E2E_REAL=1 and MAESTRO_E2E_RELAY=1 outside CI/smoke'
);
test.setTimeout(720_000);
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('real relay: Claude edits, Codex continues in the same cwd, another provider reviews read-only', async ({}, info) => {
	const deepseek =
		process.env.MAESTRO_E2E_DEEPSEEK === '1' && !!process.env.MAESTRO_E2E_DEEPSEEK_KEY;
	const native = new RealAcceptanceApp(
		info,
		'RELAY',
		deepseek ? ['claude', 'codex', 'deepseek'] : ['claude', 'codex']
	);
	let completed = false;
	try {
		native.evidence.deepseek = deepseek
			? 'covered'
			: 'not covered: flag or supplied key absent; real Claude review';
		native.initRepo({ 'value.txt': 'one\n' });
		await native.start();
		expect(
			(
				await native.cli(
					'project',
					'settings',
					'set',
					'--path',
					native.project,
					'--permission',
					'full',
					'--acknowledge-full-access'
				)
			).success
		).toBe(true);
		const source = await native.create('claude', deepseek ? 1 : 2);
		const codexRunner = await native.create('codex', 1);
		const reviewer = deepseek ? await native.create('deepseek', 1) : source;
		await native.sendTurn(
			source,
			'In this tiny repo edit only value.txt from one to two, preserving its final newline. Use at most three tool calls. Do not delegate, browse, inspect accounts or run tests. End with RELAY_CLAUDE_DONE.'
		);
		expect(fs.readFileSync(path.join(native.project, 'value.txt'), 'utf8')).toBe('two\n');
		expect(await native.answer(source)).toContain('RELAY_CLAUDE_DONE');
		await native.transcript(source);

		await native.page.getByTestId('header-handoff').click();
		const dialog = native.page.getByTestId('ai-handoff-modal');
		await dialog.getByRole('radio', { name: /^Codex/ }).check();
		await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(native.input()).toHaveValue(/RELAY_CLAUDE_DONE/);
		await expect
			.poll(
				async () =>
					(await native.cli('tab', 'show', 'active', '--agent', codexRunner.owner)).tab.origin?.kind
			)
			.toBe('handoff');
		const handoff = await native.conversation(codexRunner.owner, 'codex');
		const draft = await native.input().inputValue();
		await native
			.input()
			.fill(
				`${draft}\nContinue here: create second.txt containing exactly three followed by a newline. Leave value.txt unchanged. Use at most three tool calls, no delegation, browsing or tests. End with RELAY_CODEX_DONE.`
			);
		await native.input().press('Enter');
		await native.settled(handoff);
		expect(fs.readFileSync(path.join(native.project, 'second.txt'), 'utf8')).toBe('three\n');
		expect(fs.readFileSync(path.join(native.project, 'value.txt'), 'utf8')).toBe('two\n');
		expect(native.invocations(handoff.owner)).toHaveLength(1);
		expect(native.invocations(handoff.owner)[0].cwd).toBe(native.project);
		expect(
			(await native.cli('tab', 'show', handoff.tab, '--agent', handoff.owner)).tab.origin
		).toMatchObject({ kind: 'handoff', sourceTabId: source.tab });
		await native.transcript(handoff);
		native.checked(
			'Claude and Codex edits exist; handoff preserves source context and physical cwd'
		);

		expect(
			(await native.cli('tab', 'panel', handoff.tab, 'changes', '--agent', handoff.owner)).success
		).toBe(true);
		await native.page.getByTestId('changes-review').click();
		await dialog.getByRole('radio', { name: deepseek ? /^DeepSeek/ : /^Claude/ }).check();
		await dialog.getByRole('button', { name: 'Prepare review', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect
			.poll(
				async () =>
					(await native.cli('tab', 'show', 'active', '--agent', reviewer.owner)).tab.origin?.kind
			)
			.toBe('review');
		const review = await native.conversation(reviewer.owner, deepseek ? 'deepseek' : 'claude');
		const shown = (await native.cli('tab', 'show', review.tab, '--agent', review.owner)).tab;
		expect(shown).toMatchObject({
			permissionMode: 'readonly',
			origin: { kind: 'review', sourceTabId: handoff.tab },
		});
		await expect(native.input()).toHaveValue(/value\.txt/);
		const snapshot = () =>
			Object.fromEntries(
				native
					.git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
					.split('\0')
					.filter((file) => file && !file.startsWith('.maestro/'))
					.sort()
					.map((file) => [
						file,
						createHash('sha256')
							.update(fs.readFileSync(path.join(native.project, file)))
							.digest('hex'),
					])
			);
		const before = snapshot();
		const diff = native.git('diff', 'HEAD', '--binary');
		await native
			.input()
			.fill(
				`${await native.input().inputValue()}\nReview only value.txt and second.txt, at most three read-only tool calls. Never change files or delegate. Reply in at most 40 words and include RELAY_REVIEW_DONE.`
			);
		await native.input().press('Enter');
		await native.settled(review);
		expect(await native.answer(review)).toContain('RELAY_REVIEW_DONE');
		expect(snapshot()).toEqual(before);
		expect(native.git('diff', 'HEAD', '--binary')).toBe(diff);
		const last = native.invocations(review.owner).at(-1)!;
		expect(last.args).toContain('--permission-mode');
		expect(last.args[last.args.indexOf('--permission-mode') + 1]).toBe('plan');
		await native.transcript(review);
		native.evidence.reviewFiles = before;
		native.checked('Review is a new read-only conversation; tracked and untracked files unchanged');

		// Required nesting, including after completion. Do not compensate for the old top-level bug.
		for (const ref of [source, handoff]) {
			const toggle = native
				.row(ref)
				.getByRole('button', { name: /^Show subtasks:/ })
				.first();
			if (await toggle.count()) await toggle.click();
		}
		await expect(
			native.row(source).locator(`[data-conversation-key="${handoff.owner}:${handoff.tab}"]`)
		).toBeVisible();
		await expect(
			native.row(handoff).locator(`[data-conversation-key="${review.owner}:${review.tab}"]`)
		).toBeVisible();
		for (const [ref, answer] of [
			[source, 'RELAY_CLAUDE_DONE'],
			[handoff, 'RELAY_CODEX_DONE'],
			[review, 'RELAY_REVIEW_DONE'],
		] as const) {
			await native.row(ref).locator(':scope > div > button[data-tree-nav]').last().click();
			await expect(native.output()).toContainText(answer);
		}
		native.checked(
			'All three conversations remain clickable; handoff and review are nested under their sources'
		);
		completed = true;
	} finally {
		await native.finish(completed);
	}
});
