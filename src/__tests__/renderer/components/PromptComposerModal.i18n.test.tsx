import type { ComponentProps, ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptComposerModal } from '../../../renderer/components/PromptComposerModal';
import { ResizeHandles } from '../../../renderer/components/ui/ResizeHandles';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useModalStore } from '../../../renderer/stores/modalStore';
import { createMockSession } from '../../helpers/mockSession';
import { mockTheme } from '../../helpers/mockTheme';

const mockGetSuggestions = vi.fn().mockReturnValue([]);
vi.mock('../../../renderer/hooks/input/useAtMentionCompletion', () => ({
	useAtMentionCompletion: () => ({ getSuggestions: mockGetSuggestions }),
}));

const renderComposer = (ui: ReactElement) => render(<LayerStackProvider>{ui}</LayerStackProvider>);

const createProps = (): ComponentProps<typeof PromptComposerModal> => ({
	isOpen: true,
	onClose: vi.fn(),
	theme: mockTheme,
	initialValue: 'Original prompt {{AGENT_NAME}}',
	onSubmit: vi.fn(),
	onSend: vi.fn(),
	sessionName: 'My Claude workspace',
});

describe('PromptComposerModal language switching', () => {
	beforeEach(() => {
		useSettingsStore.setState({ uiLanguage: 'en', modalSizes: {} });
		useModalStore.setState({ promptComposerFullscreen: false });
		mockGetSuggestions.mockReset().mockReturnValue([]);
	});

	afterEach(() => {
		cleanup();
		useSettingsStore.setState({ uiLanguage: 'en', modalSizes: {} });
		useModalStore.setState({ promptComposerFullscreen: false });
		vi.clearAllMocks();
	});

	it('updates all editor chrome while retaining the draft, textarea, focus, selection and scroll', () => {
		const props = {
			...createProps(),
			setStagedImages: vi.fn(),
			onToggleTabSaveToHistory: vi.fn(),
			onToggleTabReadOnlyMode: vi.fn(),
			onToggleTabShowThinking: vi.fn(),
			onToggleEnterToSend: vi.fn(),
			supportsThinking: true,
		};
		renderComposer(<PromptComposerModal {...props} />);
		const textarea = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;
		const draft = '  Unsaved prompt {{AGENT_NAME}}\nKeep native text.\n';
		fireEvent.change(textarea, { target: { value: draft } });
		textarea.focus();
		textarea.setSelectionRange(4, 12);
		textarea.scrollTop = 44;
		vi.mocked(props.onSubmit).mockClear();

		act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));

		expect(screen.getByRole('textbox', { name: '提示词' })).toBe(textarea);
		expect(textarea).toHaveValue(draft);
		expect(document.activeElement).toBe(textarea);
		expect(textarea.selectionStart).toBe(4);
		expect(textarea.selectionEnd).toBe(12);
		expect(textarea.scrollTop).toBe(44);
		expect(props.onSubmit).not.toHaveBeenCalled();
		expect(props.onToggleTabReadOnlyMode).not.toHaveBeenCalled();
		expect(props.onToggleTabShowThinking).not.toHaveBeenCalled();
		expect(screen.getByText('提示词编辑器')).toBeInTheDocument();
		expect(screen.getByText('- My Claude workspace')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: '关闭提示词编辑器' })).toBeInTheDocument();
		expect(screen.getByTitle('展开至全屏')).toBeInTheDocument();
		expect(screen.getByTitle('关闭（Escape）')).toBeInTheDocument();
		expect(screen.getByTitle('添加图片')).toBeInTheDocument();
		expect(textarea).toHaveAttribute('placeholder', '在此输入提示词…（输入 @ 引用文件）');
		expect(screen.getByText(`${draft.length} 个字符`)).toBeInTheDocument();
		expect(screen.getByText(/^约 [\d,]+ 个 token$/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: '历史记录' })).toHaveAttribute(
			'title',
			expect.stringContaining('每次完成后添加摘要')
		);
		expect(screen.getByRole('button', { name: '只读' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: '思考过程' })).toHaveAttribute(
			'title',
			'显示思考过程，点击实时查看 AI 推理'
		);
		expect(screen.getByTitle('切换为 Enter 发送')).toBeInTheDocument();
		fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
		expect(props.onSend).toHaveBeenCalledWith(draft);
		expect(props.onClose).toHaveBeenCalledOnce();
	});

	it.each([
		{
			agentId: 'claude-code',
			label: '规划模式',
			hint: '切换规划模式（智能体进行规划，不修改文件）',
		},
		{ agentId: 'codex', label: '只读', hint: '切换只读模式（智能体不会修改文件）' },
	])(
		'keeps $agentId native mode values and toggle callbacks unchanged',
		({ agentId, label, hint }) => {
			const onToggleTabReadOnlyMode = vi.fn();
			const onToggleTabShowThinking = vi.fn();
			const props: ComponentProps<typeof PromptComposerModal> = {
				...createProps(),
				agentId,
				tabReadOnlyMode: true,
				tabShowThinking: 'sticky',
				supportsThinking: true,
				onToggleTabReadOnlyMode,
				onToggleTabShowThinking,
			};
			const { rerender } = renderComposer(<PromptComposerModal {...props} />);
			act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));
			const permissionButton = screen.getByRole('button', { name: label });
			expect(permissionButton).toHaveAttribute('title', hint);
			expect(screen.getByRole('button', { name: '思考过程' })).toHaveAttribute(
				'title',
				'持续显示思考过程，点击关闭'
			);
			expect(props.tabReadOnlyMode).toBe(true);
			expect(props.tabShowThinking).toBe('sticky');
			expect(onToggleTabReadOnlyMode).not.toHaveBeenCalled();
			expect(onToggleTabShowThinking).not.toHaveBeenCalled();
			fireEvent.click(permissionButton);
			fireEvent.click(screen.getByRole('button', { name: '思考过程' }));
			expect(onToggleTabReadOnlyMode).toHaveBeenCalledOnce();
			expect(onToggleTabReadOnlyMode.mock.calls[0][0].type).toBe('click');
			expect(onToggleTabShowThinking).toHaveBeenCalledOnce();
			expect(onToggleTabShowThinking.mock.calls[0][0].type).toBe('click');
			rerender(
				<LayerStackProvider>
					<PromptComposerModal {...props} tabShowThinking="on" />
				</LayerStackProvider>
			);
			expect(screen.getByRole('button', { name: '思考过程' })).toHaveAttribute(
				'title',
				'临时显示思考过程，点击持续显示'
			);
		}
	);

	it('translates file mention badges without changing the inserted path', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		mockGetSuggestions.mockReturnValue([
			{
				value: 'src/native.ts',
				type: 'file',
				displayText: 'native.ts',
				fullPath: 'src/native.ts',
				source: 'autorun',
			},
		]);
		const props = createProps();
		renderComposer(<PromptComposerModal {...props} />);
		const textarea = screen.getByRole('textbox', { name: '提示词' });
		fireEvent.change(textarea, { target: { value: '@' } });
		expect(screen.getByText('自动运行')).toBeInTheDocument();
		expect(screen.getByText('文件')).toBeInTheDocument();
		fireEvent.click(screen.getByText('src/native.ts'));
		expect(textarea).toHaveValue('@src/native.ts ');
		expect(props.onSubmit).toHaveBeenLastCalledWith('@src/native.ts ');
	});

	it('translates group counts while inserting original agent mentions', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		const props = createProps();
		renderComposer(
			<PromptComposerModal
				{...props}
				sessions={[
					createMockSession({ id: 'a', name: 'Alice', groupId: 'team' }),
					createMockSession({ id: 'b', name: 'Bob', groupId: 'team' }),
				]}
				groups={[{ id: 'team', name: 'TEAM', emoji: '📁', collapsed: false }]}
			/>
		);
		const textarea = screen.getByRole('textbox', { name: '提示词' });
		expect(textarea).toHaveAttribute('placeholder', '在此输入提示词…（输入 @ 提及智能体）');
		fireEvent.change(textarea, { target: { value: '@' } });
		expect(screen.getByText('群组 · 2')).toBeInTheDocument();
		fireEvent.click(screen.getByText('@TEAM'));
		expect(textarea).toHaveValue('@Alice @Bob ');
		expect(props.onSubmit).toHaveBeenLastCalledWith('@Alice @Bob ');
	});

	it('localizes image actions while passing the original staged image to the lightbox', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		const image = 'data:image/png;base64,aGVsbG8=';
		const onOpenLightbox = vi.fn();
		const setStagedImages = vi.fn();
		renderComposer(
			<PromptComposerModal
				{...createProps()}
				stagedImages={[image]}
				setStagedImages={setStagedImages}
				onOpenLightbox={onOpenLightbox}
			/>
		);
		const thumbnail = screen.getByAltText('提示词编辑器待发送图片 1');
		expect(thumbnail).toHaveAttribute('src', image);
		expect(thumbnail).toHaveAttribute('title', expect.stringContaining('点击查看'));
		fireEvent.click(thumbnail);
		expect(onOpenLightbox).toHaveBeenCalledWith(image, [image], 'staged');
		fireEvent.click(screen.getByRole('button', { name: '移除图片 1' }));
		expect(setStagedImages.mock.calls[0][0]([image])).toEqual([]);
	});

	it('switches shared resize hints without replacing the handle or its callbacks', () => {
		const onResizeStart = vi.fn();
		const onResetSize = vi.fn();
		render(<ResizeHandles onResizeStart={onResizeStart} onResetSize={onResetSize} canReset />);
		const handle = screen.getByTestId('modal-resize-handle-se');
		expect(handle).toHaveAttribute('title', 'Drag to resize, double-click to reset');
		act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));
		expect(screen.getByTestId('modal-resize-handle-se')).toBe(handle);
		expect(handle).toHaveAttribute('title', '拖动调整大小，双击重置');
		fireEvent.doubleClick(handle);
		expect(onResetSize).toHaveBeenCalledOnce();
	});
});
