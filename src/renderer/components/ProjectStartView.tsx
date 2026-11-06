import { useEffect, useState } from 'react';
import type { Theme } from '../types';
import type { NativeProject } from '../../shared/projects';
import { getBasename, truncatePath } from '../../shared/formatters';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { readableTextOn } from '../../shared/colorContrast';
import { chooseProject, openProject } from '../services/openProject';
import { useT, useFormatRelativeTime } from '../i18n';
import { captureException } from '../utils/sentry';

/** First project, without introducing the engine's agent configuration layer. */
export function ProjectStartView({ theme }: { theme: Theme }) {
	const t = useT();
	const formatRelativeTime = useFormatRelativeTime();
	const [projects, setProjects] = useState<NativeProject[]>([]);
	const [ready, setReady] = useState<string[]>([]);
	useEffect(() => {
		let active = true;
		void window.maestro.agentSessions
			.projects()
			.then((items) => {
				if (active) setProjects(items.slice(0, 8));
			})
			.catch((error) => captureException(error));
		void window.maestro.agents
			.detect()
			.then((agents) => {
				if (active) setReady(agents.filter((agent) => agent.available).map((agent) => agent.id));
			})
			.catch((error) => captureException(error));
		return () => {
			active = false;
		};
	}, []);
	const dim = readableTextOn(theme.colors.textDim, [theme.colors.bgMain]);
	return (
		<main
			className="flex-1 min-w-0 flex flex-col items-center justify-center px-8 py-12 overflow-auto"
			data-testid="project-start"
		>
			<div className="w-full max-w-xl">
				<h1 className="text-2xl font-semibold text-center">{t('workflows.projects.start')}</h1>
				<p className="mt-4 text-sm text-center" style={{ color: dim }}>
					{t('workflows.projects.description')}
				</p>
				<div className="flex justify-center mt-8">
					<button
						type="button"
						onClick={() => void chooseProject()}
						className="px-5 py-2.5 rounded-md text-sm font-medium focus-ring"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						{t('workflows.projects.folder')}
					</button>
				</div>
				{projects.length > 0 && (
					<section className="mt-12">
						<h2 className="text-xs mb-3" style={{ color: dim }}>
							{t('workflows.projects.recent')}
						</h2>
						<ul>
							{projects.map((project) => (
								<li key={project.path}>
									<button
										type="button"
										onClick={() => void openProject(project.path)}
										className="w-full flex items-center gap-3 py-2.5 px-2 rounded text-left hover:bg-white/5 focus-ring"
										title={project.path}
									>
										<span className="flex-1 min-w-0">
											<span className="block truncate text-sm">{getBasename(project.path)}</span>
											<span className="block truncate text-xs mt-1" style={{ color: dim }}>
												{truncatePath(project.path, 55)}
											</span>
										</span>
										<span className="text-xs shrink-0" style={{ color: dim }}>
											{project.tools.map((tool) => getAgentDisplayName(tool)).join(' · ')}
										</span>
										<time
											className="text-xs shrink-0"
											style={{ color: dim }}
											dateTime={new Date(project.lastActivity).toISOString()}
										>
											{formatRelativeTime(project.lastActivity)}
										</time>
									</button>
								</li>
							))}
						</ul>
					</section>
				)}
				<p className="mt-12 text-xs text-center" style={{ color: dim }}>
					{['claude-code', 'codex']
						.map((id) =>
							t(
								ready.includes(id)
									? 'workflows.projects.installed'
									: 'workflows.projects.notInstalled',
								{ tool: getAgentDisplayName(id) }
							)
						)
						.join(' · ')}
				</p>
			</div>
		</main>
	);
}
