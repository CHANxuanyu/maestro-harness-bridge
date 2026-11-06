import { useMemo } from 'react';
import { latestAgentTaskList } from '../utils/agentTaskList';
import type { LogEntry, Theme } from '../types';
import { useT } from '../i18n';

export function TasksPanel({ logs, theme }: { logs: LogEntry[]; theme: Theme }) {
	const t = useT();
	const list = useMemo(() => latestAgentTaskList(logs), [logs]);
	if (!list?.tasks.length)
		return (
			<div
				data-testid="tasks-empty"
				className="h-full flex items-center justify-center text-sm"
				style={{ color: theme.colors.textDim }}
			>
				{t('workflows.newShell.tasksEmpty')}
			</div>
		);
	return (
		<div className="py-3 text-sm" data-testid="tasks-panel">
			<p
				data-testid="tasks-progress"
				className="mb-3 text-xs"
				style={{ color: theme.colors.textDim }}
			>
				{t('workflows.newShell.tasksProgress', {
					completed: list.completed,
					total: list.tasks.length,
				})}
			</p>
			<ul className="space-y-2">
				{list.tasks.map((task, index) => (
					<li
						key={index}
						className="flex items-start gap-2 break-words"
						style={{
							color: task.status === 'in_progress' ? theme.colors.accent : theme.colors.textMain,
							opacity: task.status === 'completed' ? 0.5 : 1,
						}}
					>
						<span className="shrink-0" aria-label={t(`workflows.newShell.task.${task.status}`)}>
							{task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '▸' : '○'}
						</span>
						<span className="min-w-0 break-words">{task.content}</span>
					</li>
				))}
			</ul>
		</div>
	);
}
