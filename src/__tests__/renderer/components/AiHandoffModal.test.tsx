/**
 * Tests for AiHandoffModal - "Continue with another AI".
 *
 * The dialog only chooses a target and asks the shared service for a DRAFT:
 * nothing may be sent from here, the user lands on the new tab, and a failure
 * either stays on screen (nothing was made) or takes the user to the draft that
 * was made (it must not be lost or recreated).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiHandoffModal } from '../../../renderer/components/AiHandoffModal';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { jumpToAgent } from '../../../renderer/services/agentNavigation';
import { notifyToast } from '../../../renderer/stores/notificationStore';
import { DEEPSEEK_PRESET } from '../../../shared/agentPresets';
import { createMockAITab, createMockSession } from '../../helpers';
import { mockTheme } from '../../helpers/mockTheme';

vi.mock('../../../renderer/services/agentNavigation', () => ({ jumpToAgent: vi.fn() }));
vi.mock('../../../renderer/stores/notificationStore', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../renderer/stores/notificationStore')>()),
	notifyToast: vi.fn(),
}));

const handoff = vi.fn();
const handoffTargets = vi.fn();
const draft = {
	text: '# Handoff',
	estimatedTokens: 2340,
	budgetTokens: 8000,
	omittedEntries: 3,
	omittedCharacters: 0,
};

function seed() {
	useSessionStore.setState({
		sessions: [
			createMockSession({
				id: 'claude-agent',
				name: 'Claude',
				toolType: 'claude-code',
				projectRoot: '/project',
				aiTabs: [
					createMockAITab({
						id: 'tab-1',
						name: 'Fix login',
						logs: [{ id: 'u', timestamp: 1, source: 'user', text: 'Why does login fail?' }],
					}),
				],
				activeTabId: 'tab-1',
			}),
			createMockSession({
				id: 'codex-agent',
				name: 'Codex Runner',
				toolType: 'codex',
				projectRoot: '/project',
			}),
		],
		activeSessionId: 'claude-agent',
	});
}

function renderModal(onClose = vi.fn()) {
	render(
		<LayerStackProvider>
			<AiHandoffModal theme={mockTheme} sessionId="claude-agent" tabId="tab-1" onClose={onClose} />
		</LayerStackProvider>
	);
	return onClose;
}

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(window.maestro.context, { handoff, handoffTargets });
	handoffTargets.mockResolvedValue({
		success: true,
		targets: [{ provider: 'codex', runnerId: 'codex-agent' }, { provider: 'deepseek' }],
	});
	seed();
});

describe('AiHandoffModal', () => {
	it('lists the other AIs and says where each draft will go', async () => {
		renderModal();
		// Named the way the header names the conversation, never by its id.
		expect(screen.getByText('Fix login')).toBeInTheDocument();
		const codex = await screen.findByRole('radio', { name: /Codex/ });
		expect(codex).toBeChecked();
		expect(screen.getByRole('radio', { name: new RegExp(DEEPSEEK_PRESET.name) })).not.toBeChecked();
		expect(screen.getByText('New tab in Codex Runner')).toBeInTheDocument();
		expect(screen.getByText('Adds a DeepSeek agent to this project')).toBeInTheDocument();
		expect(screen.queryByRole('radio', { name: /Claude Code/ })).not.toBeInTheDocument();
		expect(handoffTargets).toHaveBeenCalledWith('claude-agent');
	});

	it('prepares a draft without sending and takes the user to it', async () => {
		handoff.mockResolvedValue({
			success: true,
			agentId: 'codex-agent',
			tabId: 'new-tab',
			createdAgent: false,
			state: 'draft',
			draft,
		});
		const onClose = renderModal();
		fireEvent.click(await screen.findByRole('radio', { name: new RegExp(DEEPSEEK_PRESET.name) }));
		fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		// Exactly the draft request: no `send`, so the service cannot queue it.
		expect(handoff).toHaveBeenCalledWith({
			sourceAgentId: 'claude-agent',
			sourceTabId: 'tab-1',
			targetProvider: 'deepseek',
		});
		expect(jumpToAgent).toHaveBeenCalledWith('codex-agent', { tabId: 'new-tab' });
		expect(notifyToast).not.toHaveBeenCalled();
	});

	it('prepares with Enter', async () => {
		handoff.mockResolvedValue({ success: true, agentId: 'codex-agent', tabId: 'new-tab', draft });
		const onClose = renderModal();
		const codex = await screen.findByRole('radio', { name: /Codex/ });
		fireEvent.keyDown(codex, { key: 'Enter' });
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(handoff).toHaveBeenCalledWith(expect.objectContaining({ targetProvider: 'codex' }));
	});

	it('keeps the dialog open and says why when no draft was made', async () => {
		handoff.mockResolvedValue({
			success: false,
			code: 'invalid-request',
			error: 'The handoff budget is too small',
		});
		const onClose = renderModal();
		await screen.findByRole('radio', { name: /Codex/ });
		fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(
			"Couldn't prepare the draft: The handoff budget is too small"
		);
		expect(onClose).not.toHaveBeenCalled();
		expect(jumpToAgent).not.toHaveBeenCalled();
		// Nothing retries on its own; the button is back for the user to decide.
		expect(handoff).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Prepare draft' })).toBeEnabled();
	});

	it('takes the user to a draft that was made but not saved, and says so', async () => {
		handoff.mockResolvedValue({
			success: false,
			code: 'persistence-failed',
			error: 'The handoff draft could not be saved',
			agentId: 'codex-agent',
			tabId: 'new-tab',
			draft,
		});
		const onClose = renderModal();
		await screen.findByRole('radio', { name: /Codex/ });
		fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(jumpToAgent).toHaveBeenCalledWith('codex-agent', { tabId: 'new-tab' });
		expect(notifyToast).toHaveBeenCalledWith(
			expect.objectContaining({
				color: 'red',
				dismissible: true,
				title: 'Draft not saved',
				message:
					'The draft is open in Codex, but it could not be saved. Send or copy it before you close Maestro.',
			})
		);
		expect(handoff).toHaveBeenCalledTimes(1);
	});

	it('names an unnamed conversation by its first message, as the header does', async () => {
		useSessionStore.setState({
			sessions: [
				createMockSession({
					id: 'claude-agent',
					aiTabs: [
						createMockAITab({
							id: 'tab-1',
							name: null,
							agentSessionId: 'e0f4da7d-819b-478a-b126-4b746d814244',
							logs: [{ id: 'u', timestamp: 1, source: 'user', text: 'Why does login fail?' }],
						}),
					],
				}),
			],
		});
		renderModal();
		expect(screen.getByText('Why does login fail?')).toBeInTheDocument();
		expect(screen.queryByText('E0F4DA7D')).toBeNull();
		await screen.findByRole('radio', { name: /Codex/ });
	});

	it('explains when no other AI can take over', async () => {
		handoffTargets.mockResolvedValue({ success: true, targets: [] });
		renderModal();
		expect(await screen.findByText(/No other AI can take over here/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Prepare draft' })).toBeDisabled();
	});

	it('shows why the targets could not be listed', async () => {
		handoffTargets.mockResolvedValue({
			success: false,
			code: 'unavailable',
			error: 'Remote agents cannot hand off',
		});
		renderModal();
		expect(await screen.findByRole('alert')).toHaveTextContent('Remote agents cannot hand off');
		expect(screen.getByRole('button', { name: 'Prepare draft' })).toBeDisabled();
	});
});
