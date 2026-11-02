/**
 * The Left Bar row names the provider an agent runs. A DeepSeek preset runs
 * Claude Code underneath, but the row must say DeepSeek.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SessionItem } from '../../../renderer/components/SessionItem';
import { createMockSession } from '../../helpers/mockSession';
import { mockTheme } from '../../helpers/mockTheme';

const props = {
	variant: 'flat' as const,
	theme: mockTheme,
	isActive: false,
	isKeyboardSelected: false,
	isDragging: false,
	isEditing: false,
	leftSidebarOpen: true,
	onSelect: vi.fn(),
	onDragStart: vi.fn(),
	onContextMenu: vi.fn(),
	onFinishRename: vi.fn(),
	onStartRename: vi.fn(),
	onToggleBookmark: vi.fn(),
};

function providerText(container: HTMLElement): string | undefined {
	return container.querySelector('.row-provider')?.textContent ?? undefined;
}

describe('SessionItem provider label', () => {
	it('names a DeepSeek preset agent DeepSeek', () => {
		const { container } = render(
			<SessionItem
				{...props}
				session={createMockSession({
					toolType: 'claude-code',
					customEnvVars: {
						ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
						CLAUDE_CONFIG_DIR: '/data/accounts/deepseek-1',
					},
				})}
			/>
		);
		expect(providerText(container)).toBe('DeepSeek');
	});

	it('keeps Claude Code for a plain Claude Code agent', () => {
		const { container } = render(
			<SessionItem {...props} session={createMockSession({ toolType: 'claude-code' })} />
		);
		expect(providerText(container)).toBe('Claude Code');
	});
});
