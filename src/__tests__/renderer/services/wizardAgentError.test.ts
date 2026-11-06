import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentError } from '../../../shared/types';
import { conversationManager } from '../../../renderer/components/Wizard/services/conversationManager';
import { phaseGenerator } from '../../../renderer/components/Wizard/services/phaseGenerator';
import {
	startInlineWizardConversation,
	sendWizardMessage,
} from '../../../renderer/services/inlineWizardConversation';
import { generateInlineDocuments } from '../../../renderer/services/inlineWizardDocumentGeneration';
import { FeedbackConversationManager } from '../../../renderer/services/feedbackConversation';

const config = {
	agentType: 'claude-code' as const,
	directoryPath: '/test/project',
	projectName: 'Test Project',
	conversationHistory: [],
};
const authError: AgentError = {
	type: 'auth_expired',
	message: 'Authentication failed. Sign in again to continue.',
	agentId: 'claude-code',
	recoverable: true,
	timestamp: 1,
};
const feedback = new FeedbackConversationManager();
const surfaces = [
	{
		name: 'conversationManager',
		start: async () => {
			await conversationManager.startConversation(config);
			return conversationManager.sendMessage('Hello', []);
		},
	},
	{ name: 'phaseGenerator', start: () => phaseGenerator.generateDocuments(config) },
	{
		name: 'inlineWizardConversation',
		start: async () => {
			const session = await startInlineWizardConversation({ ...config, mode: 'ask' });
			return sendWizardMessage(session, 'Hello', []);
		},
	},
	{
		name: 'inlineWizardDocumentGeneration',
		start: () =>
			generateInlineDocuments({
				...config,
				mode: 'new',
				autoRunFolderPath: '/test/project/.maestro/playbooks',
			}),
	},
	{
		name: 'feedbackConversation',
		start: () => {
			feedback.start({ agentType: 'claude-code', systemPrompt: 'Test prompt' });
			return feedback.sendTurn('Hello', []);
		},
	},
];

let onData: ((sessionId: string, data: string) => void) | undefined;
let onExit: ((sessionId: string, code: number) => void) | undefined;
let onAgentError: ((sessionId: string, error: AgentError) => void) | undefined;
const dataCleanup = vi.fn(() => {
	onData = undefined;
});
const exitCleanup = vi.fn(() => {
	onExit = undefined;
});
const errorCleanup = vi.fn(() => {
	onAgentError = undefined;
});

beforeEach(() => {
	vi.clearAllMocks();
	onData = undefined;
	onExit = undefined;
	onAgentError = undefined;
	Object.assign(window.maestro.process, {
		onData: vi.fn((callback) => {
			onData = callback;
			return dataCleanup;
		}),
		onExit: vi.fn((callback) => {
			onExit = callback;
			return exitCleanup;
		}),
		onAgentError: vi.fn((callback) => {
			onAgentError = callback;
			return errorCleanup;
		}),
	});
	vi.mocked(window.maestro.process.spawn).mockResolvedValue({ pid: 12345, success: true });
	vi.mocked(window.maestro.agents.get).mockResolvedValue({
		id: 'claude-code',
		name: 'Claude Code',
		available: true,
		command: 'claude',
		args: [],
	});
	Object.assign(window.maestro.autorun, {
		watchFolder: vi.fn().mockResolvedValue({ success: true }),
		unwatchFolder: vi.fn().mockResolvedValue({ success: true }),
		onFileChanged: vi.fn(() => vi.fn()),
		listDocs: vi.fn().mockResolvedValue({ success: true, files: [] }),
	});
});

afterEach(async () => {
	await conversationManager.endConversation();
	phaseGenerator.abort();
	feedback.cleanup();
});

describe.each(surfaces)('$name structured process errors', ({ name, start }) => {
	it('reports auth_expired without any data and supplies the Claude login command', async () => {
		const pending = start();
		await vi.waitFor(() => expect(window.maestro.process.spawn).toHaveBeenCalledOnce());
		const sessionId = vi.mocked(window.maestro.process.spawn).mock.calls[0][0].sessionId;
		onAgentError?.(sessionId, authError);
		onExit!(sessionId, 1);
		const result = await pending;
		if (name === 'conversationManager') {
			expect(result).toMatchObject({
				success: false,
				detectedError: {
					type: 'auth_expired',
					title: 'Authentication Required',
					recoveryHint: expect.stringContaining('claude auth login'),
					canRetry: false,
				},
			});
		}
		expect(result.error).toContain('Authentication Required');
		expect(result.error).toContain('claude auth login');
		expect(result.error).not.toMatch(/check the terminal/i);
		expect(errorCleanup).toHaveBeenCalledOnce();
		expect(dataCleanup).toHaveBeenCalledOnce();
		expect(exitCleanup).toHaveBeenCalledOnce();
		expect(onAgentError).toBeUndefined();
	});

	it('ignores agent errors from a different session', async () => {
		const pending = start();
		await vi.waitFor(() => expect(window.maestro.process.spawn).toHaveBeenCalledOnce());
		const sessionId = vi.mocked(window.maestro.process.spawn).mock.calls[0][0].sessionId;
		onAgentError?.('other-session', authError);
		onExit!(sessionId, 1);
		const result = await pending;
		expect(result.error).not.toContain('Authentication Required');
		expect(result.error).not.toContain('claude auth login');
		expect(result.error).not.toMatch(/check the terminal/i);
		expect(errorCleanup).toHaveBeenCalledOnce();
	});

	it('retains text detection when there is no structured error', async () => {
		const pending = start();
		await vi.waitFor(() => expect(window.maestro.process.spawn).toHaveBeenCalledOnce());
		const sessionId = vi.mocked(window.maestro.process.spawn).mock.calls[0][0].sessionId;
		onData!(sessionId, 'OAuth token has expired');
		onExit!(sessionId, 1);
		const result = await pending;
		expect(result.error).toContain('Authentication Required');
		expect(result.error).toContain('claude auth login');
	});

	it('uses the structured type even when the message does not match a pattern and exit is zero', async () => {
		const pending = start();
		await vi.waitFor(() => expect(window.maestro.process.spawn).toHaveBeenCalledOnce());
		const sessionId = vi.mocked(window.maestro.process.spawn).mock.calls[0][0].sessionId;
		onData!(sessionId, '{"confidence":90,"ready":true,"message":"Earlier response"}');
		onAgentError!(sessionId, { ...authError, message: 'Provider refusal A17' });
		onExit!(sessionId, 0);
		const result = await pending;
		expect(result.error).toContain('Authentication Required');
		expect(result.error).toContain('Provider refusal A17');
		expect(result.error).toContain('claude auth login');
	});

	it('removes the error listener when spawning fails', async () => {
		vi.mocked(window.maestro.process.spawn).mockRejectedValue(new Error('spawn ENOENT'));
		const result = await start();
		expect(result.error).toContain('spawn ENOENT');
		expect(errorCleanup).toHaveBeenCalledOnce();
		expect(dataCleanup).toHaveBeenCalledOnce();
		expect(exitCleanup).toHaveBeenCalledOnce();
		expect(onAgentError).toBeUndefined();
	});
});
