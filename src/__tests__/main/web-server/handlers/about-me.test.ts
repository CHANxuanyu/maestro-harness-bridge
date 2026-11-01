import { describe, expect, it, vi } from 'vitest';
import { handleAboutMe } from '../../../../main/web-server/handlers/messageHandlers/settings';
import type {
	MessageHandlerContext,
	WebClient,
} from '../../../../main/web-server/handlers/messageHandlers/types';

const client = { id: 'synthetic-client' } as WebClient;
describe('About Me WebSocket result', () => {
	it('preserves a partial failure and correlates the response', async () => {
		const result = {
			success: false,
			content: 'Profile',
			estimatedTokens: 2,
			files: [],
			written: ['/synthetic/CLAUDE.md'],
			code: 'file-error',
		};
		const callback = vi.fn().mockResolvedValue(result);
		const send = vi.fn();
		const ctx = {
			callbacks: { aboutMeCommand: callback },
			send,
		} as unknown as MessageHandlerContext;
		const command = { action: 'apply', content: 'Profile', confirmations: [] };
		await handleAboutMe(ctx, client, {
			type: 'about_me',
			requestId: 'test-request',
			request: command,
		});
		expect(callback).toHaveBeenCalledExactlyOnceWith(command);
		expect(send).toHaveBeenCalledExactlyOnceWith(client, {
			type: 'about_me_result',
			requestId: 'test-request',
			...result,
		});
	});
	it('returns a typed failure when no service is registered', async () => {
		const send = vi.fn();
		await handleAboutMe({ callbacks: {}, send } as unknown as MessageHandlerContext, client, {
			type: 'about_me',
			requestId: 'missing',
			request: { action: 'show' },
		});
		expect(send).toHaveBeenCalledWith(
			client,
			expect.objectContaining({
				type: 'about_me_result',
				requestId: 'missing',
				success: false,
				code: 'unavailable',
			})
		);
	});
	it('answers unexpected failures instead of leaving the CLI waiting', async () => {
		const send = vi.fn();
		const callback = vi.fn().mockRejectedValue(new Error('Synthetic filesystem failure'));
		await handleAboutMe(
			{ callbacks: { aboutMeCommand: callback }, send } as unknown as MessageHandlerContext,
			client,
			{ type: 'about_me', requestId: 'failed', request: { action: 'status' } }
		);
		expect(send).toHaveBeenCalledWith(
			client,
			expect.objectContaining({
				type: 'about_me_result',
				requestId: 'failed',
				success: false,
				code: 'file-error',
			})
		);
	});
});
