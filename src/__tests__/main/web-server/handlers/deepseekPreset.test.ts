import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPath } = vi.hoisted(() => ({ getPath: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath } }));

import { handleCreateSession } from '../../../../main/web-server/handlers/messageHandlers/sessions';
import type {
	MessageHandlerContext,
	WebClient,
	WebClientMessage,
} from '../../../../main/web-server/handlers/messageHandlers/types';

describe('DeepSeek preset creation through the desktop bridge', () => {
	let root: string;
	const createSession = vi.fn();
	let ctx: MessageHandlerContext;
	beforeEach(() => {
		vi.clearAllMocks();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-deepseek-'));
		getPath.mockReturnValue(root);
		createSession.mockResolvedValue({ sessionId: 'created' });
		ctx = {
			callbacks: { createSession },
			send: vi.fn(),
			sendError: vi.fn(),
		} as unknown as MessageHandlerContext;
	});
	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
	const message = (extra: Record<string, unknown> = {}) =>
		({
			name: 'DeepSeek',
			toolType: 'claude-code',
			cwd: '/project',
			preset: 'deepseek',
			presetApiKey: 'synthetic-key',
			requestId: 'request',
			...extra,
		}) as WebClientMessage;

	it('allocates separate native account directories and maps only DeepSeek models', async () => {
		await handleCreateSession(ctx, {} as WebClient, message());
		await handleCreateSession(ctx, {} as WebClient, message());
		const configs = createSession.mock.calls.map((call) => call[4]);
		expect(configs).toHaveLength(2);
		for (const config of configs) {
			expect(config.customModel).toBe('deepseek-flash[1m]');
			expect(config.customEnvVars).toMatchObject({
				ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
				ANTHROPIC_AUTH_TOKEN: 'synthetic-key',
				ANTHROPIC_API_KEY: '',
				CLAUDE_CODE_OAUTH_TOKEN: '',
			});
			expect(fs.statSync(config.customEnvVars.CLAUDE_CONFIG_DIR).isDirectory()).toBe(true);
			expect(path.relative(root, config.customEnvVars.CLAUDE_CONFIG_DIR)).not.toMatch(/^\.\./);
		}
		expect(configs[0].customEnvVars.CLAUDE_CONFIG_DIR).not.toBe(
			configs[1].customEnvVars.CLAUDE_CONFIG_DIR
		);
	});

	it.each([
		{ type: 'create_preset_session', preset: undefined },
		{ customModel: 'sonnet' },
		{ presetApiKey: '' },
		{ customEnvVars: { CLAUDE_CONFIG_DIR: '/other-account' } },
		{ sessionSshRemoteConfig: { enabled: true, remoteId: 'remote' } },
	])(
		'rejects unsupported preset input without creating an agent or directory: %j',
		async (extra) => {
			await handleCreateSession(ctx, {} as WebClient, message(extra));
			expect(createSession).not.toHaveBeenCalled();
			expect(fs.readdirSync(root)).toEqual([]);
			expect(ctx.send).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					type: 'create_session_result',
					success: false,
					requestId: 'request',
				})
			);
		}
	);
});
