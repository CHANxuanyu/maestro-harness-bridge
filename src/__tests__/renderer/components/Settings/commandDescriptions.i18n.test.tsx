import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AICommandsPanel } from '../../../../renderer/components/AICommandsPanel';
import { SpecKitCommandsPanel } from '../../../../renderer/components/SpecKitCommandsPanel';
import { OpenSpecCommandsPanel } from '../../../../renderer/components/OpenSpecCommandsPanel';
import { NotificationsPanel } from '../../../../renderer/components/NotificationsPanel';
import { localizeAppCommandDescription } from '../../../../renderer/components/shared/commandDescriptionI18n';
import { getTranslator } from '../../../../renderer/i18n';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import type { CustomAICommand } from '../../../../renderer/types';
import { mockTheme } from '../../../helpers/mockTheme';

const commitCommand: CustomAICommand = {
	id: 'commit',
	command: '/commit',
	description: 'Commit outstanding changes and push up',
	prompt: 'Original prompt with {{AGENT_NAME}}',
	isBuiltIn: true,
};

const specKits = [
	{
		name: 'speckit',
		Panel: SpecKitCommandsPanel,
		help: 'Learn how to use spec-kit with Maestro',
		helpZh: '了解如何在 Maestro 中使用 spec-kit',
		implement: 'Execute tasks using Maestro Auto Run with worktree support',
		implementZh: '使用 Maestro 自动运行执行任务，支持工作树',
		upstream: 'Create or update feature specification',
	},
	{
		name: 'openspec',
		Panel: OpenSpecCommandsPanel,
		help: 'Learn how to use OpenSpec with Maestro',
		helpZh: '了解如何在 Maestro 中使用 OpenSpec',
		implement: 'Convert OpenSpec tasks to Maestro Auto Run documents',
		implementZh: '将 OpenSpec 任务转换为 Maestro 自动运行文档',
		upstream: 'Create a change proposal with specs, tasks, and optional design docs',
	},
] as const;

describe('Maestro command description localization', () => {
	beforeEach(() => {
		useSettingsStore.setState({ uiLanguage: 'en' });
	});

	afterEach(() => {
		cleanup();
		useSettingsStore.setState({ uiLanguage: 'en' });
	});

	it('localizes only original descriptions owned by Maestro', () => {
		const commands = [
			commitCommand,
			...specKits.flatMap((kit) => [
				{ id: 'help', command: `/${kit.name}.help`, description: kit.help, isCustom: true },
				{
					id: 'implement',
					command: `/${kit.name}.implement`,
					description: kit.implement,
					isCustom: true,
				},
			]),
		];
		for (const command of commands) {
			expect(localizeAppCommandDescription(command, getTranslator('en'))).toBe(command.description);
			expect(localizeAppCommandDescription(command, getTranslator('zh-CN'))).not.toBe(
				command.description
			);
			expect(
				localizeAppCommandDescription(
					{ ...command, description: 'My custom description' },
					getTranslator('zh-CN')
				)
			).toBe('My custom description');
			expect(
				localizeAppCommandDescription(
					{ ...command, isCustom: false, isBuiltIn: false },
					getTranslator('zh-CN')
				)
			).toBe(command.description);
		}
		const upstreamBmad = {
			id: 'help',
			command: '/bmad-help',
			description:
				'Get unstuck by showing what workflow steps come next or answering BMad Method questions.',
			isCustom: false,
		};
		expect(localizeAppCommandDescription(upstreamBmad, getTranslator('zh-CN'))).toBe(
			upstreamBmad.description
		);
	});

	it('switches and searches the commit description without replacing editable or saved content', () => {
		const onSave = vi.fn();
		function Commands() {
			const [commands, setCommands] = useState([commitCommand]);
			return (
				<AICommandsPanel
					theme={mockTheme}
					customAICommands={commands}
					setCustomAICommands={(updated) => {
						onSave(updated);
						setCommands(updated);
					}}
				/>
			);
		}
		render(<Commands />);
		expect(screen.getByText(commitCommand.description)).toBeInTheDocument();
		act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));
		expect(screen.getByText('提交尚未提交的更改并推送')).toBeInTheDocument();
		const filter = screen.getByPlaceholderText('筛选命令…');
		fireEvent.change(filter, { target: { value: '尚未提交' } });
		expect(screen.getByText('/commit')).toBeInTheDocument();
		fireEvent.change(filter, { target: { value: '' } });
		fireEvent.click(screen.getByText('/commit').closest('button')!);
		fireEvent.click(screen.getByRole('button', { name: '编辑' }));
		const description = screen.getByDisplayValue(commitCommand.description);
		expect(screen.getByDisplayValue(commitCommand.prompt)).toBeInTheDocument();
		fireEvent.change(description, { target: { value: 'My edited description' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		expect(screen.getByText('My edited description')).toBeInTheDocument();
		expect(onSave).toHaveBeenCalledWith([
			{ ...commitCommand, description: 'My edited description' },
		]);
		expect(commitCommand.description).toBe('Commit outstanding changes and push up');
	});

	it.each(specKits)(
		'localizes Maestro $name metadata while preserving upstream metadata and prompt content',
		async ({ name, Panel, help, helpZh, implement, implementZh, upstream }) => {
			const prompt = 'Original instruction {{AGENT_NAME}}';
			const savePrompt = vi.fn().mockResolvedValue({ success: true });
			(window as unknown as { maestro: Record<string, unknown> }).maestro = {
				...window.maestro,
				[name]: {
					getPrompts: vi.fn().mockResolvedValue({
						success: true,
						commands: [
							{ id: 'help', command: `/${name}.help`, description: help, prompt, isCustom: true },
							{
								id: 'implement',
								command: `/${name}.implement`,
								description: implement,
								prompt,
								isCustom: true,
							},
							{
								id: 'upstream',
								command: `/${name}.upstream`,
								description: upstream,
								prompt,
								isCustom: false,
							},
						],
					}),
					getMetadata: vi.fn().mockResolvedValue({ success: true, metadata: null }),
					savePrompt,
				},
			};
			render(<Panel theme={mockTheme} enabled onEnabledChange={vi.fn()} />);
			expect(await screen.findByText(help)).toBeInTheDocument();
			act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));
			expect(screen.getByText(helpZh)).toBeInTheDocument();
			expect(screen.getByText(implementZh)).toBeInTheDocument();
			expect(screen.getByText(upstream)).toBeInTheDocument();
			fireEvent.click(screen.getByText(`/${name}.help`).closest('button')!);
			fireEvent.click(screen.getByRole('button', { name: '编辑' }));
			expect(screen.getByDisplayValue(prompt)).toBeInTheDocument();
			fireEvent.click(screen.getByRole('button', { name: '保存' }));
			await waitFor(() => expect(savePrompt).toHaveBeenCalledWith('help', prompt));
		}
	);

	it('translates notification command-chain guidance and retains literal command examples', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		render(
			<NotificationsPanel
				theme={mockTheme}
				osNotificationsEnabled={false}
				setOsNotificationsEnabled={vi.fn()}
				audioFeedbackEnabled
				setAudioFeedbackEnabled={vi.fn()}
				audioFeedbackCommand="say"
				setAudioFeedbackCommand={vi.fn()}
				toastDuration={5000}
				setToastDuration={vi.fn()}
				toastWidth="small"
				setToastWidth={vi.fn()}
				toastPosition="bottom-right"
				setToastPosition={vi.fn()}
				idleNotificationEnabled={false}
				setIdleNotificationEnabled={vi.fn()}
				idleNotificationCommand="say"
				setIdleNotificationCommand={vi.fn()}
			/>
		);
		expect(screen.getByText(/也可以使用非语音合成命令，或组合多个命令/)).toBeInTheDocument();
		expect(screen.getByText('festival --tts')).toBeInTheDocument();
		expect(screen.getByText('tee ~/log.txt | say')).toBeInTheDocument();
		expect(screen.queryByText(/You can also use non-TTS commands/)).not.toBeInTheDocument();
	});
});
