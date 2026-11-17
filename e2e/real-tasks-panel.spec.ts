import { test, expect } from '@playwright/test';
import { RealAcceptanceApp, acceptanceEnabled } from './fixtures/real-acceptance';
import { extractAgentTaskList } from '../src/renderer/utils/agentTaskList';
import { extractCodexPlan } from '../src/shared/codexSessionText';

declare global {
	interface Window {
		__tasksPanelWatch: { observer: MutationObserver; samples: number; violations: string[] };
	}
}

// One turn each: a Codex plan and a Claude 5-series answer without a plan source.
test.skip(
	!acceptanceEnabled('TASKS_PANEL'),
	'requires MAESTRO_E2E_REAL=1 and MAESTRO_E2E_TASKS_PANEL=1 outside CI/smoke'
);
test.setTimeout(480_000);
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('real tasks: Codex plan survives restart and Claude 5 has no task items or badge', async ({}, info) => {
	const native = new RealAcceptanceApp(info, 'TASKS_PANEL', ['codex', 'claude']);
	let completed = false;
	try {
		// The shared fixture requires an explicit model. Refuse a 4-series override
		// before any paid turn: its task tools are a different capability case.
		expect(native.tools.claude.model).toMatch(/^claude-(?:sonnet|opus)-5(?:[.-]|$)/);
		native.initRepo({ 'README.md': 'No file changes required.\n' });
		await native.start();
		const codex = await native.create('codex', 1);
		const claude = await native.create('claude', 1);
		for (const ref of [codex, claude]) {
			await native.select(ref);
			expect(
				(await native.cli('tab', 'permission', ref.tab, 'readonly', '--agent', ref.owner)).success
			).toBe(true);
			expect(
				(await native.cli('tab', 'panel', ref.tab, 'tasks', '--agent', ref.owner)).success
			).toBe(true);
			await expect(native.page.getByTestId('tasks-empty')).toBeVisible();
		}

		await native.select(codex);
		const input = {
			plan: [
				{ step: 'Count the sample squares', status: 'completed' },
				{ step: 'Count the sample circles', status: 'pending' },
			],
		};
		await native.sendTurn(
			codex,
			`Call update_plan exactly once with this input: ${JSON.stringify(input)}. Leave these statuses unchanged. Then reply TASK_LIST_RECORDED. Do not use any other tools, read or write files, browse or delegate. If the tool is unavailable, say so; do not imitate a tool call in text.`
		);
		const transcript = await native.transcript(codex);
		// Read the native file independently of the renderer, with the same format
		// decoder used by history. Both direct and code-mode calls count.
		const inputs = transcript.rows.flatMap((row) => {
			const plan = row.type === 'response_item' ? extractCodexPlan(row.payload) : null;
			return plan ? [plan] : [];
		});
		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toEqual(input);
		const list = extractAgentTaskList(inputs[0])!;
		const assertPlan = async () => {
			const items = native.page.getByTestId('tasks-panel').getByRole('listitem');
			await expect(items).toHaveText(list.tasks.map((task) => task.content));
			for (const [index, task] of list.tasks.entries())
				await expect(
					items
						.nth(index)
						.getByLabel(task.status === 'completed' ? 'Completed' : 'Pending', { exact: true })
				).toBeVisible();
			await expect(native.page.getByTestId('tasks-progress')).toHaveText('1 / 2 completed');
		};
		await assertPlan();
		native.evidence.taskLists = [
			{ provider: 'codex', nativeFile: transcript.file, input: inputs[0] },
		];
		await native.restart();
		await native.select(codex);
		expect(
			(await native.cli('tab', 'panel', codex.tab, 'tasks', '--agent', codex.owner)).success
		).toBe(true);
		await assertPlan();
		native.checked(
			'Codex: labels, order, statuses and progress match native input before and after restart'
		);

		await native.select(claude);
		expect(
			(await native.cli('tab', 'panel', claude.tab, 'tasks', '--agent', claude.owner)).success
		).toBe(true);
		const assertEmpty = async () => {
			await expect(native.page.getByTestId('tasks-empty')).toHaveText(
				'The tools in this conversation have not provided a task list. Checklists in replies are not shown here.'
			);
			await expect(native.page.getByTestId('tasks-panel').getByRole('listitem')).toHaveCount(0);
			// The complete label must stay bare, without a numeric count badge.
			await expect(native.page.locator('[data-tour="tasks-tab"]')).toHaveText('Tasks');
			await expect(native.page.getByTestId('tasks-progress')).toHaveCount(0);
		};
		await assertEmpty();
		// Observe every DOM mutation during the turn so a transient task list or
		// count cannot pass merely because it disappears before the final answer.
		await native.page.evaluate(() => {
			const sample = () => {
				const watch = window.__tasksPanelWatch;
				watch.samples++;
				const label = document.querySelector('[data-tour="tasks-tab"]')?.textContent?.trim();
				if (
					(document.querySelector('[data-testid="tasks-panel"] li') || label !== 'Tasks') &&
					watch.violations.length < 10
				)
					watch.violations.push(`Task items or badge appeared: ${label}`);
			};
			window.__tasksPanelWatch = {
				observer: new MutationObserver(sample),
				samples: 0,
				violations: [],
			};
			sample();
			window.__tasksPanelWatch.observer.observe(document.body, {
				subtree: true,
				childList: true,
				characterData: true,
			});
		});
		try {
			await native.sendTurn(
				claude,
				'Answer with a plain markdown checklist of these calculations: 7 plus 2, 8 plus 3. Do not use tools, read or write files, browse or delegate. Do not claim to have called a task-list tool.'
			);
			await assertEmpty();
		} finally {
			native.evidence.claudeTasks = await native.page.evaluate(() => {
				const { observer, samples, violations } = window.__tasksPanelWatch;
				observer.disconnect();
				return { samples, violations };
			});
		}
		expect(native.evidence.claudeTasks).toMatchObject({ violations: [] });
		expect((native.evidence.claudeTasks as { samples: number }).samples).toBeGreaterThan(1);
		const claudeTranscript = await native.transcript(claude);
		const assistantMessages = claudeTranscript.rows.filter((row) => row.type === 'assistant');
		expect(assistantMessages.length).toBeGreaterThan(0);
		for (const row of assistantMessages) {
			expect(row.message.model).toMatch(/^claude-(?:sonnet|opus)-5(?:[.-]|$)/);
			expect(
				row.message.content.filter((block: { type: string }) => block.type === 'tool_use')
			).toEqual([]);
		}
		await native.restart();
		await native.select(claude);
		expect(
			(await native.cli('tab', 'panel', claude.tab, 'tasks', '--agent', claude.owner)).success
		).toBe(true);
		await assertEmpty();
		native.checked(
			'Claude 5: explanatory empty state, no task items or count badge throughout the turn and after restart'
		);
		expect(native.git('diff', 'HEAD')).toBe('');
		completed = true;
	} finally {
		await native.finish(completed);
	}
});
