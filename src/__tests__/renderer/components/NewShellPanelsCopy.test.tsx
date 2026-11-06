import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { mockTheme } from '../../helpers/mockTheme';
import { NewFileModal } from '../../../renderer/components/FileExplorerPanel/components/NewFileModal';
import { MoveConflictModal } from '../../../renderer/components/FileExplorerPanel/components/MoveConflictModal';
import { FileTreeTruncatedBanner } from '../../../renderer/components/FileExplorerPanel/components/FileTreeTruncatedBanner';
import { RetryCountdown } from '../../../renderer/components/FileExplorerPanel/components/RetryCountdown';
import { ImageViewer } from '../../../renderer/components/FilePreview/ImageViewer';
import { PreviewTierChip } from '../../../renderer/components/FilePreview/PreviewTierChip';

vi.mock('../../../renderer/components/ui/Modal', () => ({
	Modal: ({ title, children, footer }: any) => (
		<div>
			<h1>{title}</h1>
			{children}
			{footer}
		</div>
	),
	ModalFooter: ({ confirmLabel, cancelLabel = 'Cancel' }: any) => (
		<div>
			<button>{cancelLabel}</button>
			<button>{confirmLabel}</button>
		</div>
	),
}));

beforeEach(() => useSettingsStore.setState({ newShell: true, uiLanguage: 'zh-CN' }));
afterEach(() => {
	cleanup();
	useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
});

describe('new shell panel copy', () => {
	it('localizes the file creation dialog', () => {
		render(
			<NewFileModal
				theme={mockTheme}
				kind="file"
				parentFolderLabel="src"
				value=""
				setValue={vi.fn()}
				error={null}
				isCreating={false}
				onClose={vi.fn()}
				onCreate={vi.fn()}
			/>
		);
		expect(screen.getByRole('heading').textContent).toBe('在 src 中新建文件');
		expect(screen.getByPlaceholderText('输入文件名')).toBeTruthy();
		expect(screen.getByRole('button', { name: '新建' })).toBeTruthy();
	});
	it('localizes conflict decisions and preserves file names', () => {
		render(
			<MoveConflictModal
				theme={mockTheme}
				destFolderLabel="dest"
				conflicts={[
					{
						sourceName: 'a.txt',
						sourceRelativePath: 'a.txt',
						sourceAbsolutePath: '/tmp/a.txt',
						destAbsolutePath: '/tmp/dest/a.txt',
						autoRenameName: 'a (2).txt',
						autoRenameAbsolutePath: '/tmp/dest/a (2).txt',
					},
				]}
				nonConflictingCount={0}
				isMoving={false}
				onCancel={vi.fn()}
				onOverwriteAll={vi.fn()}
				onAutoRenameAll={vi.fn()}
				onSkipConflicts={vi.fn()}
			/>
		);
		expect(screen.getByRole('heading').textContent).toBe('文件名重复');
		expect(screen.getByText('重命名为“a (2).txt”')).toBeTruthy();
		expect(screen.getByText('替换目标位置的文件。此操作无法撤销。')).toBeTruthy();
	});
	it('localizes bounded file scan feedback', () => {
		render(
			<FileTreeTruncatedBanner
				theme={mockTheme}
				previousCap={1000}
				onLoadMore={vi.fn()}
				onLoadAll={vi.fn()}
				isRefreshing={false}
				onCollapse={vi.fn()}
			/>
		);
		expect(screen.getByText('部分文件尚未显示')).toBeTruthy();
		expect(screen.getByRole('button', { name: '加载全部' })).toBeTruthy();
		expect(screen.getByLabelText('收起文件扫描提示')).toBeTruthy();
	});
	it('localizes retry feedback', () => {
		render(<RetryCountdown theme={mockTheme} retryAt={Date.now() + 10000} onRetryNow={vi.fn()} />);
		expect(screen.getByRole('button', { name: '立即重试' })).toBeTruthy();
		expect(screen.getByText('10 秒后重试')).toBeTruthy();
	});
	it('localizes image controls and load errors', () => {
		render(<ImageViewer src="" alt="sample" theme={mockTheme} />);
		expect(screen.getByTitle('缩小')).toBeTruthy();
		expect(screen.getByText('图片加载失败')).toBeTruthy();
	});
	it('uses plain preview mode descriptions', () => {
		render(
			<PreviewTierChip theme={mockTheme} autoTier="fast" override={undefined} onSelect={vi.fn()} />
		);
		fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
		expect(
			screen.getByRole('menuitem', { name: '快速预览 适合较长文档，减少加载等待。' })
		).toBeTruthy();
		expect(screen.getByText('适合较长文档，减少加载等待。')).toBeTruthy();
	});
	it('keeps old shell English copy even with Chinese selected', () => {
		useSettingsStore.setState({ newShell: false });
		render(<ImageViewer src="" alt="sample" theme={mockTheme} />);
		expect(screen.getByTitle('Zoom out')).toBeTruthy();
		expect(screen.getByText('Failed to load image')).toBeTruthy();
	});
});
