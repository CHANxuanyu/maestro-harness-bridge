import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { ProjectStartView } from '../../../renderer/components/ProjectStartView';
import { mockTheme } from '../../helpers/mockTheme';
import { chooseProject, openProject } from '../../../renderer/services/openProject';
vi.mock('../../../renderer/services/openProject', () => ({
	chooseProject: vi.fn(),
	openProject: vi.fn(),
}));
beforeEach(() => {
	useSettingsStore.setState({ uiLanguage: 'en' });
	Object.assign(window.maestro.agentSessions, { projects: vi.fn().mockResolvedValue([]) });
	window.maestro.agents.detect = vi
		.fn()
		.mockResolvedValue([{ id: 'claude-code', available: true }]);
});
it('offers a project picker and installation text without a recent list when empty', async () => {
	render(<ProjectStartView theme={mockTheme} />);
	expect(screen.getByRole('heading', { name: 'Choose a project to start' })).toBeInTheDocument();
	fireEvent.click(screen.getByRole('button', { name: 'Open project folder' }));
	expect(chooseProject).toHaveBeenCalledOnce();
	expect(
		await screen.findByText('Claude Code installed · Codex not installed')
	).toBeInTheDocument();
	expect(screen.queryByText('Recent projects')).not.toBeInTheDocument();
});
it('shows at most eight recent projects and opens the exact path', async () => {
	window.maestro.agentSessions.projects = vi.fn().mockResolvedValue(
		Array.from({ length: 10 }, (_, i) => ({
			path: `/synthetic/project-${i}`,
			tools: ['codex'],
			lastActivity: Date.now(),
			sessionCount: 2,
		}))
	);
	render(<ProjectStartView theme={mockTheme} />);
	fireEvent.click(await screen.findByRole('button', { name: /project-0/ }));
	expect(openProject).toHaveBeenCalledWith('/synthetic/project-0');
	expect(screen.getAllByRole('button')).toHaveLength(9);
	expect(screen.queryByText('project-8')).not.toBeInTheDocument();
});

it('describes installation rather than authentication in Chinese', async () => {
	useSettingsStore.setState({ uiLanguage: 'zh-CN' });
	render(<ProjectStartView theme={mockTheme} />);
	expect(await screen.findByText('Claude Code 已安装 · Codex 未安装')).toBeInTheDocument();
});
