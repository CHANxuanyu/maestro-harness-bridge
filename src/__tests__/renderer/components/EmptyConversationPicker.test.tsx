import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmptyConversationPicker } from '../../../renderer/components/EmptyConversationPicker';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { createMockSession, createMockAITab } from '../../helpers';
import { mockTheme } from '../../helpers/mockTheme';

const conversation = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	window.maestro.context.conversation = conversation;
	conversation.mockImplementation(async (request) =>
		request.action === 'targets'
			? { success: true, targets: [{ provider: 'claude-code' }, { provider: 'codex' }] }
			: { success: true }
	);
});

describe('empty conversation tools', () => {
	it.each([false, true])(
		'shows only available tools and prepares without sending, new shell %s',
		async (newShell) => {
			useSettingsStore.setState({ newShell });
			const tab = createMockAITab({ id: 'empty', logs: [], agentSessionId: null });
			const session = createMockSession({
				id: 'source',
				projectRoot: '/projects/shop',
				toolType: 'claude-code',
			});
			render(<EmptyConversationPicker session={session} tab={tab} theme={mockTheme} />);
			if (newShell) {
				expect(screen.getByText('shop')).toBeInTheDocument();
				expect(await screen.findByRole('button', { name: 'Claude Code' })).toHaveAttribute(
					'aria-pressed',
					'true'
				);
				expect(screen.queryByRole('button', { name: 'DeepSeek' })).toBeNull();
				fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
				await waitFor(() =>
					expect(conversation).toHaveBeenCalledWith({
						action: 'new-conversation',
						sourceAgentId: 'source',
						targetProvider: 'codex',
						replaceTabId: 'empty',
					})
				);
			} else {
				expect(screen.queryByTestId('empty-conversation-picker')).toBeNull();
				expect(conversation).not.toHaveBeenCalled();
			}
		}
	);
	it('disappears as soon as the first message is present', () => {
		useSettingsStore.setState({ newShell: true });
		render(
			<EmptyConversationPicker
				session={createMockSession()}
				tab={createMockAITab({ logs: [{ id: 'u', timestamp: 1, source: 'user', text: 'hello' }] })}
				theme={mockTheme}
			/>
		);
		expect(screen.queryByTestId('empty-conversation-picker')).toBeNull();
	});
});
