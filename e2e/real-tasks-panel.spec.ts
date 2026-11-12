import { test, expect } from '@playwright/test';
import { RealAcceptanceApp, acceptanceEnabled } from './fixtures/real-acceptance';
import { extractAgentTaskList } from '../src/renderer/utils/agentTaskList';

// One turn each, exactly one native checklist call requested per provider.
test.skip(
	!acceptanceEnabled('TASKS_PANEL'),
	'requires MAESTRO_E2E_REAL=1 and MAESTRO_E2E_TASKS_PANEL=1 outside CI/smoke'
);
test.setTimeout(480_000);
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('real tasks: Codex update_plan and Claude TodoWrite match the native input, live and after restart', async ({}, info) => {
	const native = new RealAcceptanceApp(info, 'TASKS_PANEL', ['codex', 'claude']);
	let completed = false;
	try {
		native.initRepo({ 'README.md': 'No file changes required.\n' });
		await native.start();
		const conversations = [await native.create('codex', 1), await native.create('claude', 1)];
		const evidence: unknown[] = [];
		for (const ref of conversations) {
			await native.select(ref);
			expect(
				(await native.cli('tab', 'permission', ref.tab, 'readonly', '--agent', ref.owner)).success
			).toBe(true);
			expect(
				(await native.cli('tab', 'panel', ref.tab, 'tasks', '--agent', ref.owner)).success
			).toBe(true);
			await expect(native.page.getByTestId('tasks-empty')).toBeVisible();
			const tool = ref.provider === 'codex' ? 'update_plan' : 'TodoWrite';
			const input =
				ref.provider === 'codex'
					? {
							plan: [
								{ step: 'Calculate two plus two', status: 'completed' },
								{ step: 'Calculate three plus three', status: 'in_progress' },
							],
						}
					: {
							todos: [
								{
									content: 'Calculate two plus two',
									status: 'completed',
									activeForm: 'Calculating two plus two',
								},
								{
									content: 'Calculate three plus three',
									status: 'in_progress',
									activeForm: 'Calculating three plus three',
								},
							],
						};
			await native.sendTurn(
				ref,
				`Call ${tool} exactly once with this input: ${JSON.stringify(input)}. Leave these statuses unchanged. Then reply TASK_LIST_RECORDED. Do not use any other tools, read or write files, browse or delegate. If the tool is unavailable, say so; do not imitate a tool call in text.`
			);
			const transcript = await native.transcript(ref);
			// Native file input is the independent oracle, not the renderer IPC probe.
			const inputs =
				ref.provider === 'codex'
					? transcript.rows
							.filter(
								(row) =>
									row.type === 'response_item' &&
									row.payload?.type === 'function_call' &&
									/(?:^|\.)update_plan$/.test(row.payload.name)
							)
							.map((row) => JSON.parse(row.payload.arguments))
					: transcript.rows
							.flatMap((row) => (row.type === 'assistant' ? (row.message?.content ?? []) : []))
							.filter((block) => block.type === 'tool_use' && block.name === 'TodoWrite')
							.map((block) => block.input);
			expect(inputs).toHaveLength(1);
			expect(inputs[0]).toMatchObject(input);
			const list = extractAgentTaskList(inputs[0]);
			expect(list?.tasks).toHaveLength(2);
			const assertPanel = async () => {
				const items = native.page.getByTestId('tasks-panel').getByRole('listitem');
				await expect(items).toHaveText(list!.tasks.map((task) => task.content));
				for (const [index, task] of list!.tasks.entries())
					await expect(
						items.nth(index).getByLabel(task.status === 'completed' ? 'Completed' : 'In progress', {
							exact: true,
						})
					).toBeVisible();
				await expect(native.page.getByTestId('tasks-progress')).toHaveText('1 / 2 completed');
			};
			await assertPanel();
			evidence.push({
				provider: ref.provider,
				nativeFile: transcript.file,
				tool,
				input: inputs[0],
				rendered: await native.page
					.getByTestId('tasks-panel')
					.getByRole('listitem')
					.allTextContents(),
			});
			native.evidence.taskLists = evidence;
			// Restart restores native-backed history without another paid turn.
			await native.restart();
			await native.select(ref);
			expect(
				(await native.cli('tab', 'panel', ref.tab, 'tasks', '--agent', ref.owner)).success
			).toBe(true);
			await assertPanel();
			native.checked(
				`${tool}: exact labels, order, statuses and progress equal native input before and after restart`
			);
		}
		expect(native.git('diff', 'HEAD')).toBe('');
		completed = true;
	} finally {
		await native.finish(completed);
	}
});
