import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Provider } from './fixtures/native-app';
import { createTurn } from './fixtures/native/protocol.cjs';

for (const provider of ['claude', 'codex'] satisfies Provider[]) {
	test(`${provider} f: external turns follow only when idle and preserve reading and drafts`, async ({
		native,
	}) => {
		native.scriptTurns([
			{
				answer: '',
				waitForStop: true,
				tools: [{ id: 'busy-tool', command: 'sleep 60', output: '' }],
			},
		]);
		const configDir = provider === 'claude' ? native.claude : native.codex;
		const seed = await native.externalTurn(provider, 'External follow history', {
			answer: Array.from({ length: 80 }, (_, i) => `History paragraph ${i}.`).join('\n\n'),
		});
		const identity = { provider, configDir, cwd: native.project, id: seed.id };
		await native.createAgent(provider);
		await native.page
			.locator('[data-conversation-kind="history"] button[data-tree-nav]')
			.filter({ hasText: 'External follow history' })
			.click();
		await expect(native.output().getByText('History paragraph 79.', { exact: true })).toBeVisible();
		const scroll = native.output().locator(':scope > .overflow-y-auto');
		await native.externalTurn(
			provider,
			'An external idle turn',
			{ answer: 'Idle external answer.' },
			seed.id
		);
		await expect(native.output().getByText('Idle external answer.', { exact: true })).toBeVisible();
		await expect
			.poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
			.toBeLessThanOrEqual(1);
		await native.input().fill('Preserve this draft.');
		await scroll.evaluate((node) => {
			node.scrollTop = 0;
			node.dispatchEvent(new Event('scroll'));
		});
		const anchor = native.output().getByText('History paragraph 0.', { exact: true });
		const before = await anchor.boundingBox();
		const tool = {
			id: 'external-result',
			command: 'printf external-output',
			output: 'external-output',
		};
		const gate = path.join(native.root, 'external-work');
		const external = native.real
			? native.externalTurn(
					provider,
					'External work while reading',
					{
						answer: 'External work completed.',
						tools: [{ ...tool, updates: ['external-output'], gates: [gate] }],
					},
					seed.id
				)
			: undefined;
		external?.catch(() => {}); // Awaited below after releasing the workload gate.
		const synthetic = native.real
			? undefined
			: createTurn({ ...identity, prompt: 'External work while reading' });
		synthetic?.startTool(tool);
		const unread = native
			.output()
			.getByTitle('New messages (click to pin to bottom)', { exact: true });
		await expect(unread).toHaveText('1');
		fs.writeFileSync(gate, 'continue');
		if (external) await external;
		else {
			synthetic.finishTool(tool);
			synthetic.finish('External work completed.');
		}
		await expect(
			native.output().getByText('External work completed.', { exact: true })
		).toBeVisible();
		await expect(unread).toHaveText('2');
		expect(await scroll.evaluate((node) => node.scrollTop)).toBe(0);
		expect(Math.abs((await anchor.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(1);
		await expect(native.input()).toHaveValue('Preserve this draft.');
		await unread.click();
		await native.send('Run a tool while the other writer appends');
		await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
		const concurrent = native.externalTurn(
			provider,
			'An external append while Maestro is busy',
			{ answer: 'Wait until Maestro becomes idle.' },
			seed.id
		);
		concurrent.catch(() => {}); // Awaited after Stop; never turn a CLI refusal into success.
		// Observe two real 2-second probes from useNativeTranscriptFollow.
		// This synthetic append tests the read guard, not supported concurrent writes.
		await native.page.waitForTimeout(4200);
		await expect(
			native.output().getByText('Wait until Maestro becomes idle.', { exact: true })
		).toHaveCount(0);
		await native.page.getByRole('button', { name: /^Stop/ }).click();
		await concurrent;
		await expect(
			native.output().getByText('Wait until Maestro becomes idle.', { exact: true })
		).toBeVisible();
		expect(native.files(provider)).toHaveLength(1);
	});

	test(`${provider} h: saving history leaves native bytes and the project list unchanged`, async ({
		native,
	}) => {
		const exitGate = path.join(native.root, 'finish-original-turn');
		native.scriptTurns([
			{
				answer: 'Saved work answer.',
				// A real synopsis answers NOTHING_TO_REPORT for a turn that changes
				// nothing, so the workload writes a project file it can report.
				tools: [
					{
						id: 'history-work',
						command: 'printf saved-work | tee saved-work.txt',
						output: 'saved-work',
					},
				],
				exitGate,
			},
			{ answer: 'Unexpected persisted synopsis.' },
		]);
		const agentId = await native.createAgent(provider);
		if (provider === 'claude') await native.cli('update-agent', agentId, '--token-source', 'api');
		await native.cli('tab', 'save-to-history', 'active', 'true', '--agent', agentId);
		await expect(native.page.getByTitle(/^Save to History/)).not.toHaveClass(/opacity-40/);
		try {
			await native.send('Complete work and save its history');
			await expect(native.output().getByText('Saved work answer.', { exact: true })).toBeVisible();
			const file = await native.oneTranscript(provider);
			const before = fs.readFileSync(file);
			const files = native.files(provider);
			const rows = await native.page.locator('[data-conversation-key]').count();
			fs.writeFileSync(exitGate, 'exit');
			await native.openRightBar();
			await native.page.locator('[data-tour="history-tab"]').click();
			const summary =
				provider === 'claude' ? 'A native acceptance turn completed.' : 'Saved work answer.';
			await native.historyEntry(agentId, summary);
			expect(fs.readFileSync(file)).toEqual(before);
			expect(native.files(provider)).toEqual(files);
			await expect(native.page.locator('[data-conversation-key]')).toHaveCount(rows);
		} finally {
			fs.writeFileSync(exitGate, 'exit');
		}
	});

	test(`${provider} i: both sidebars and composer controls fit at 1000 pixels`, async ({
		native,
	}) => {
		fs.writeFileSync(path.join(native.project, 'acceptance.txt'), 'synthetic file');
		native.scriptTurns([]);
		await native.createAgent(provider);
		await native.app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].setSize(1000, 900)
		);
		// Resize can collapse a sidebar automatically. Reopen both, as in the
		// frontend-followups regression, before measuring the constrained layout.
		await expect.poll(() => native.page.evaluate(() => innerWidth)).toBe(1000);
		const expandLeft = native.page.getByTitle(/^Expand Sidebar/);
		if (await expandLeft.isVisible()) await expandLeft.click();
		await native.openRightBar();
		const left = native.page.locator('[data-tour="session-list"]');
		await expect(left).toBeVisible();
		await expect.poll(async () => (await left.boundingBox())!.width).toBeGreaterThan(200);
		const collapse = native.page.getByTitle(/^Collapse Right Panel/);
		await expect(collapse).toBeVisible();
		const files = native.page.locator('[data-tour="files-panel"]');
		const fileToolbar = files.getByTitle(/^Find files/).locator('..');
		const stats = files.locator('.file-stats-container');
		await expect(stats).toBeVisible();
		const viewport = await native.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
		expect(viewport.width).toBe(1000);
		const controls = [
			collapse,
			...(await fileToolbar.getByRole('button').all()),
			...(await stats.locator(':scope > span').all()),
		];
		const toolbar = native.page.locator('[data-tour="toolbar-toggles"]').locator('..');
		const buttons = [];
		for (const button of await toolbar.getByRole('button').all())
			if (await button.isVisible()) buttons.push(button);
		expect(buttons.length).toBeGreaterThanOrEqual(5);
		for (const control of [...controls, ...buttons]) {
			const box = await control.boundingBox();
			expect(box).not.toBeNull();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.y).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
			expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
		}
		const boxes = await Promise.all(buttons.map((button) => button.boundingBox()));
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i]!,
					b = boxes[j]!;
				const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
				const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
				expect(width > 0 && height > 0, `composer buttons ${i} and ${j} overlap`).toBe(false);
			}
	});

	test(`${provider} j: click, Enter and new conversation put typing in the composer`, async ({
		native,
	}) => {
		native.scriptTurns([]);
		for (const title of ['First focus history', 'Second focus history'])
			await native.externalTurn(provider, title, { answer: `${title} answer.` });
		await native.createAgent(provider);
		const rows = native.page.locator('[data-conversation-kind="history"] button[data-tree-nav]');
		await rows.filter({ hasText: 'First focus history' }).click();
		await expect(native.input()).toBeFocused();
		await native.page.keyboard.type('Typed after click.');
		await expect(native.input()).toHaveValue('Typed after click.');
		const second = rows.filter({ hasText: 'Second focus history' });
		await second.focus();
		await second.press('Enter');
		await expect(native.input()).toBeFocused();
		await native.page.keyboard.type('Typed after Enter.');
		await expect(native.input()).toHaveValue('Typed after Enter.');
		await native.page.getByRole('button', { name: /^New conversation:/ }).click();
		await expect(native.input()).toBeFocused();
		await native.page.keyboard.type('Typed in a new conversation.');
		await expect(native.input()).toHaveValue('Typed in a new conversation.');
		expect(native.files(provider)).toHaveLength(2);
	});
}

test('codex compressed history opens and follows replaced archives', async ({ native }) => {
	const { zstdCompressSync } = await import('node:zlib');
	const seed = await native.externalTurn('codex', 'Compressed history fixture', {
		answer: 'Older compressed answer.',
	});
	const bytes = fs.readFileSync(seed.file);
	fs.writeFileSync(seed.file + '.zst', zstdCompressSync(bytes));
	fs.unlinkSync(seed.file);
	await native.createAgent('codex');
	await native.page
		.locator('[data-conversation-kind="history"] button[data-tree-nav]')
		.filter({ hasText: 'Compressed history fixture' })
		.click();
	await expect(
		native.output().getByText('Older compressed answer.', { exact: true })
	).toBeVisible();
	const appended = Buffer.from(
		JSON.stringify({
			type: 'response_item',
			payload: {
				type: 'message',
				role: 'assistant',
				content: [{ type: 'output_text', text: 'Externally revised archive.' }],
			},
		}) + '\n'
	);
	fs.writeFileSync(seed.file + '.zst', zstdCompressSync(Buffer.concat([bytes, appended])));
	await expect(
		native.output().getByText('Externally revised archive.', { exact: true })
	).toBeVisible();
	expect(fs.existsSync(seed.file)).toBe(false);
});

for (const provider of ['claude', 'codex'] as const) {
	test(`${provider} worktree history stays readable after Git removes its working folder`, async ({
		native,
	}) => {
		const { execFileSync } = await import('node:child_process');
		const git = (...args: string[]) =>
			execFileSync('git', args, {
				cwd: native.project,
				stdio: 'pipe',
				env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
			});
		git('init');
		git(
			'-c',
			'user.name=Fixture',
			'-c',
			'user.email=fixture@example.test',
			'commit',
			'--allow-empty',
			'-m',
			'fixture'
		);
		const cwd = path.join(native.project, '.claude', 'worktrees', 'history-x');
		git('worktree', 'add', '-b', 'history-x', cwd);
		const turn = createTurn({
			provider,
			configDir: provider === 'claude' ? native.claude : native.codex,
			cwd,
			prompt: 'Managed worktree history',
		});
		turn.finish('Worktree transcript answer.');
		const before = fs.readFileSync(turn.file);
		git('worktree', 'remove', '--force', cwd);
		await native.createAgent(provider);
		await native.page
			.locator('[data-conversation-kind="history"] button[data-tree-nav]')
			.filter({ hasText: 'Managed worktree history' })
			.click();
		await expect(
			native.output().getByText('Worktree transcript answer.', { exact: true })
		).toBeVisible();
		await native.send('Continue after archive');
		await expect(native.output().getByText(/Worktree is gone or unavailable/)).toBeVisible();
		expect(fs.readFileSync(turn.file)).toEqual(before);
	});
}
