import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { InputTextarea } from '../../../renderer/components/InputArea/components/InputTextarea';
import { MentionRoutingBar } from '../../../renderer/components/InputArea/components/MentionRoutingBar';
import { AutoRunErrorBadge } from '../../../renderer/components/SessionList/AutoRunErrorBadge';
import { buildSessionJumpCommands } from '../../../renderer/components/QuickActionsModal/commands/sessionCommands';
import { buildFeatureCommands } from '../../../renderer/components/QuickActionsModal/commands/featureCommands';
import { buildTileCommands } from '../../../renderer/components/QuickActionsModal/commands/tileCommands';
import { tileNewTabInSession } from '../../../renderer/services/tileNewTabAction';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { createInputAreaSession, inputAreaTheme } from './InputArea/_fixtures';

vi.mock('../../../renderer/services/tileNewTabAction', () => ({
	tileNewTabInSession: vi.fn(),
}));

describe('daily workflow language switching', () => {
	beforeEach(() => {
		useSettingsStore.setState({ uiLanguage: 'en' });
		vi.clearAllMocks();
	});

	afterEach(() => {
		useSettingsStore.setState({ uiLanguage: 'system' });
	});

	it('updates the composer placeholder without remounting, changing the draft, or losing selection', () => {
		const inputRef = createRef<HTMLTextAreaElement>();
		const draft = 'Review settings.json and keep Claude / Codex names unchanged';
		const onChange = vi.fn();
		const { container } = render(
			<InputTextarea
				session={createInputAreaSession({ name: 'My English Agent', toolType: 'codex' })}
				theme={inputAreaTheme}
				isTerminalMode={false}
				inputValue={draft}
				spellCheckEnabled={false}
				inputRef={inputRef}
				onInputFocus={vi.fn()}
				onChange={onChange}
				handleInputKeyDown={vi.fn()}
				handlePaste={vi.fn()}
				handleDrop={vi.fn()}
			/>
		);
		const textarea = container.querySelector('textarea')!;
		const englishPlaceholder = textarea.placeholder;
		textarea.focus();
		textarea.setSelectionRange(7, 20);

		act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));

		expect(container.querySelector('textarea')).toBe(textarea);
		expect(textarea).toHaveValue(draft);
		expect(document.activeElement).toBe(textarea);
		expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([7, 20]);
		expect(textarea.placeholder).toContain('正在与 My English Agent 对话');
		expect(textarea.placeholder).toContain('Codex');
		expect(onChange).not.toHaveBeenCalled();

		act(() => useSettingsStore.setState({ uiLanguage: 'en' }));
		expect(textarea.placeholder).toBe(englishPlaceholder);
		expect(textarea).toHaveValue(draft);
	});

	it('refreshes a memoized routing bar while preserving agent names and routing semantics', () => {
		render(<MentionRoutingBar theme={inputAreaTheme} routing="handoff" agentNames={['History']} />);
		expect(screen.getByText('This agent answers, then its answer goes to @History')).toBeVisible();

		act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));

		expect(screen.getByText('当前智能体先回答，然后将回答交给 @History')).toBeVisible();
		expect(screen.getByTestId('mention-routing-bar')).toHaveAttribute('data-routing', 'handoff');
		expect(screen.getByText('修改措辞以更改')).toHaveAttribute(
			'title',
			expect.stringContaining('send it to')
		);
	});

	it('translates palette labels while dispatching the original file and terminal kind values', () => {
		const session = createInputAreaSession();
		const args = { activeSession: session, setQuickActionOpen: vi.fn() };
		const english = buildTileCommands(args);
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		const chinese = buildTileCommands(args);

		expect(chinese.map((command) => command.id)).toEqual(english.map((command) => command.id));
		const file = chinese.find((command) => command.id === 'tileBelow:file')!;
		const terminal = chinese.find((command) => command.id === 'tileBelow:terminal')!;
		expect(file.label).toBe('在下方新建文件分屏');
		expect(terminal.label).toBe('在下方新建终端分屏');
		file.action();
		terminal.action();
		expect(tileNewTabInSession).toHaveBeenNthCalledWith(1, session.id, 'file');
		expect(tileNewTabInSession).toHaveBeenNthCalledWith(2, session.id, 'terminal');
	});

	it('updates automatic resume notices and handles an exhausted run without a known count', () => {
		const { rerender } = render(
			<AutoRunErrorBadge
				errorPaused
				attempts={2}
				maxAttempts={5}
				nextResumeAt={Date.now() + 5 * 60_000}
			/>
		);
		expect(screen.getByText('ERR')).toHaveAttribute(
			'title',
			'Auto Run error - resuming in about 5 minutes (2 of 5)'
		);
		act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));
		expect(screen.getByText('错误')).toHaveAttribute(
			'title',
			'自动运行出错，预计将在 5 分钟后恢复（第 2 次，共 5 次）'
		);
		rerender(<AutoRunErrorBadge errorPaused exhausted />);
		expect(screen.getByText('错误')).toHaveAttribute(
			'title',
			'自动运行出错，自动恢复次数已用尽。请手动恢复以继续。'
		);
	});

	it('localizes a session jump status without changing the session state or target', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		const session = createInputAreaSession({ state: 'idle', name: '中文验收 Alpha' });
		const setActiveSessionId = vi.fn();
		const commands = buildSessionJumpCommands({
			sessions: [session],
			setActiveSessionId,
			revealJumpTarget: vi.fn(),
		});
		expect(commands[0].subtext).toBe('空闲');
		commands[0].action();
		expect(session.state).toBe('idle');
		expect(setActiveSessionId).toHaveBeenCalledWith(session.id);
	});

	it('translates both enabled and disabled feature states in the command palette', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		for (const enabled of [true, false]) {
			const commands = buildFeatureCommands({
				activeSession: undefined,
				setQuickActionOpen: vi.fn(),
				setSuccessFlashNotification: vi.fn(),
				setAgentSessionsOpen: vi.fn(),
				setActiveAgentSessionId: vi.fn(),
				bionifyReadingMode: enabled,
				setBionifyReadingMode: vi.fn(),
				audioFeedbackEnabled: enabled,
				setAudioFeedbackEnabled: vi.fn(),
				idleNotificationEnabled: enabled,
				setIdleNotificationEnabled: vi.fn(),
				showStarredSessionsSection: false,
				setShowStarredSessionsSection: vi.fn(),
				shortcuts: {},
			});
			const state = enabled ? '开启' : '关闭';
			expect(commands.find((command) => command.id === 'toggleBionifyReadingMode')?.subtext).toBe(
				'Bionify 阅读强调：' + state
			);
			expect(commands.find((command) => command.id === 'toggleCustomNotification')?.subtext).toBe(
				'自定义通知：' + state
			);
			expect(commands.find((command) => command.id === 'toggleIdleNotification')?.subtext).toBe(
				'空闲通知：' + state
			);
		}
	});
});
