import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtMentionPopover } from '../../../../renderer/components/InputArea/overlays/AtMentionPopover';
import { MentionRoutingBar } from '../../../../renderer/components/InputArea/components/MentionRoutingBar';
import { PermissionModeMenu } from '../../../../renderer/components/InputArea/components/PermissionModeMenu';
import { InputTextarea } from '../../../../renderer/components/InputArea/components/InputTextarea';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { createInputAreaSession, createItemRefs, inputAreaTheme } from './_fixtures';

const originalSettings = useSettingsStore.getState();
afterEach(() => {
	cleanup();
	useSettingsStore.setState({
		newShell: originalSettings.newShell,
		uiLanguage: originalSettings.uiLanguage,
	});
});

describe('new shell composer copy', () => {
	it.each([
		['en', 'Conversations', 'Open another conversation in the sidebar to consult it.'],
		['zh-CN', '对话', '在左栏打开另一条对话，即可向它提问。'],
	] as const)('uses conversation names in the %s mention picker', (uiLanguage, label, empty) => {
		useSettingsStore.setState({ newShell: true, uiLanguage });
		render(
			<AtMentionPopover
				isOpen
				isTerminalMode={false}
				items={[]}
				category="agents"
				selectedIndex={0}
				filter=""
				startIndex={0}
				inputValue="@"
				itemRefs={createItemRefs<HTMLButtonElement>()}
				theme={inputAreaTheme}
				setInputValue={vi.fn()}
				inputRef={{ current: null }}
			/>
		);
		expect(screen.getByText(label)).toBeInTheDocument();
		expect(screen.getByText(empty)).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/智能体|\bagents?\b/i);
	});

	it.each([
		['en', '@Review answers. This conversation does not run.'],
		['zh-CN', '由 @Review 回答，当前对话不运行。'],
	] as const)('explains mention routing in %s', (uiLanguage, description) => {
		useSettingsStore.setState({ newShell: true, uiLanguage });
		render(<MentionRoutingBar theme={inputAreaTheme} routing="only" agentNames={['Review']} />);
		expect(screen.getByText(description)).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/智能体|\bagents?\b/i);
	});

	it.each(['en', 'zh-CN'] as const)('removes old nouns from %s permission hints', (uiLanguage) => {
		useSettingsStore.setState({ newShell: true, uiLanguage });
		render(
			<PermissionModeMenu
				theme={inputAreaTheme}
				agentId="claude-code"
				mode="full"
				hasStandardCapability
				onChange={vi.fn()}
			/>
		);
		expect(screen.getByRole('button').title).not.toMatch(/智能体|\bagents?\b/i);
		expect(screen.getByRole('button').title).toContain(
			uiLanguage === 'en' ? 'without confirmation' : '无需确认'
		);
	});

	it.each([
		['en', 'Run a shell command. ! asks for a command. Esc returns to the conversation.'],
		['zh-CN', '输入终端命令。! 生成命令，Esc 返回对话。'],
	] as const)('localizes %s command mode instructions', (uiLanguage, placeholder) => {
		useSettingsStore.setState({ newShell: true, uiLanguage });
		render(
			<InputTextarea
				session={createInputAreaSession()}
				theme={inputAreaTheme}
				isTerminalMode={false}
				isCommandModeDraft
				inputValue=""
				spellCheckEnabled={false}
				inputRef={{ current: null }}
				onInputFocus={vi.fn()}
				onChange={vi.fn()}
				handleInputKeyDown={vi.fn()}
				handlePaste={vi.fn()}
				handleDrop={vi.fn()}
			/>
		);
		expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', placeholder);
	});

	it.each([
		['en', '@Review answers; this agent does not'],
		['zh-CN', '由 @Review 回答；当前智能体不参与'],
	] as const)('preserves classic %s routing copy', (uiLanguage, description) => {
		useSettingsStore.setState({ newShell: false, uiLanguage });
		render(<MentionRoutingBar theme={inputAreaTheme} routing="only" agentNames={['Review']} />);
		expect(screen.getByText(description)).toBeInTheDocument();
	});
});
