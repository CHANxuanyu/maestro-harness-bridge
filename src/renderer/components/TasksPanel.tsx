import { Check, CircleDot, Circle } from 'lucide-react';
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
				className="h-full flex items-center justify-center px-4 text-center text-sm"
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
					<li key={index} className="flex items-start gap-2 break-words">
						<span
							className="w-4 h-4 shrink-0 flex items-center justify-center mt-0.5"
							style={{
								color: task.status === 'in_progress' ? theme.colors.accent : theme.colors.textDim,
							}}
							aria-label={t(`workflows.newShell.task.${task.status}`)}
						>
							{task.status === 'completed' ? (
								<Check size={16} />
							) : task.status === 'in_progress' ? (
								<CircleDot size={16} />
							) : (
								<Circle size={16} />
							)}
						</span>
						<span
							className={`min-w-0 break-words${task.status === 'in_progress' ? ' font-medium' : ''}`}
							style={{
								color: task.status === 'completed' ? theme.colors.textDim : theme.colors.textMain,
							}}
						>
							{task.content}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
