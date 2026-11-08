import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionRequest } from '../../../main/permission-relay/types';

const relay = vi.hoisted(() => ({
	onRequest: undefined as ((request: PermissionRequest) => void) | undefined,
	onResolved: undefined as ((requestId: string) => void) | undefined,
}));
vi.mock('../../../main/permission-relay/PermissionRelayServer', () => ({
	permissionRelayServer: {
		ensureStarted: vi.fn().mockResolvedValue('/temporary-relay.sock'),
		setOnRequest: (callback: (request: PermissionRequest) => void) => {
			relay.onRequest = callback;
		},
		setOnResolved: (callback: (requestId: string) => void) => {
			relay.onResolved = callback;
		},
	},
}));
vi.mock('../../../main/permission-relay/spawn-args', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	resolveBridgeScriptPath: () => '/temporary-bridge.js',
}));
vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('permission relay Electron integration', () => {
	let root: string;
	let integration: typeof import('../../../main/permission-relay/integration');
	let registry: typeof import('../../../main/permission-relay/registry');

	beforeEach(async () => {
		vi.resetModules();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-integration-'));
		integration = await import('../../../main/permission-relay/integration');
		registry = await import('../../../main/permission-relay/registry');
		relay.onRequest = undefined;
		relay.onResolved = undefined;
	});

	afterEach(() => {
		integration.cleanupSessionRelay('conversation-ai-tab');
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('releases the spawn token when writing its MCP config fails', async () => {
		await expect(
			integration.preparePermissionRelayArgs({
				sessionId: 'conversation-ai-tab',
				cwd: path.join(root, 'project'),
				userDataDir: path.join(root, 'missing-parent'),
				execPath: process.execPath,
			})
		).rejects.toThrow();
		expect(registry.relayRegistryStats()).toEqual({ bindings: 0, pending: 0 });
	});

	it('removes the MCP config and token on process exit', async () => {
		const processManager = new EventEmitter();
		integration.initPermissionRelay(() => null, processManager);
		const args = await integration.preparePermissionRelayArgs({
			sessionId: 'conversation-ai-tab',
			cwd: path.join(root, 'project'),
			userDataDir: root,
			execPath: process.execPath,
		});
		const configPath = args[args.indexOf('--mcp-config') + 1];
		expect(fs.existsSync(configPath)).toBe(true);
		processManager.emit('exit', 'conversation-ai-tab', 0);
		expect(fs.existsSync(configPath)).toBe(false);
		expect(registry.relayRegistryStats()).toEqual({ bindings: 0, pending: 0 });
	});

	it('keeps the effective execution directory in the spawn binding', async () => {
		const cwd = path.join(root, 'project', '.claude', 'worktrees', 'approval');
		const args = await integration.preparePermissionRelayArgs({
			sessionId: 'conversation-ai-tab',
			cwd,
			userDataDir: root,
			execPath: process.execPath,
		});
		const config = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
		const token = config.mcpServers.maestro_permissions.env.MAESTRO_RELAY_TOKEN;
		expect(registry.lookupBinding(token)).toMatchObject({ cwd });
	});

	it.each([
		{ sessionId: 'conversation-ai-tab', explicit: undefined, expected: 'tab' },
		{ sessionId: 'conversation-ai-tab-fp-1234', explicit: undefined, expected: 'tab' },
		{ sessionId: 'conversation-ai-tab', explicit: 'explicit-tab', expected: 'explicit-tab' },
		{ sessionId: 'conversation-ai', explicit: undefined, expected: undefined },
	])('resolves approval ownership from the spawn identity: %j', async (scenario) => {
		const args = await integration.preparePermissionRelayArgs({
			sessionId: scenario.sessionId,
			tabId: scenario.explicit,
			cwd: path.join(root, 'project'),
			userDataDir: root,
			execPath: process.execPath,
		});
		try {
			const config = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
			const token = config.mcpServers.maestro_permissions.env.MAESTRO_RELAY_TOKEN;
			expect(registry.lookupBinding(token)).toMatchObject({ tabId: scenario.expected });
		} finally {
			integration.cleanupSessionRelay(scenario.sessionId);
		}
	});

	it('lists pending requests without relay credentials and broadcasts resolution', async () => {
		const send = vi.fn();
		const window = {
			isDestroyed: () => false,
			webContents: { id: 11, isDestroyed: () => false, send },
		} as unknown as BrowserWindow;
		integration.initPermissionRelay(() => window, new EventEmitter());
		const binding = registry.registerSpawn({ sessionId: 'conversation-ai-tab', owner: { window } });
		const pending = registry.createPending('request-1', binding.token);
		const request: PermissionRequest = {
			requestId: 'request-1',
			token: binding.token,
			sessionId: 'conversation-ai-tab',
			tabId: 'tab',
			cwd: path.join(root, 'worktree'),
			toolName: 'Write',
			input: { content: 'approved' },
			createdAt: 1,
		};
		relay.onRequest!(request);
		const { token: _token, ...visibleRequest } = request;
		expect(integration.listPermissionRequests({ webContentsId: 11 })).toEqual([visibleRequest]);
		expect(send).toHaveBeenCalledWith('process:permission-request', visibleRequest);
		registry.resolvePending('request-1', { behavior: 'deny', message: 'done' });
		await pending;
		binding.cleanup();
		relay.onResolved!('request-1');
		expect(integration.listPermissionRequests({ webContentsId: 11 })).toEqual([]);
		expect(send).toHaveBeenCalledWith('process:permission-resolved', 'request-1');
	});
	it('lists only each callers own requests across two users and windows', async () => {
		const cleanups: Array<() => void> = [];
		const decisions: Promise<unknown>[] = [];
		integration.initPermissionRelay(() => null, new EventEmitter());
		try {
			for (const [userId, id] of [
				['alice', 11],
				['bob', 22],
			] as const) {
				const window = {
					isDestroyed: () => false,
					webContents: { id, isDestroyed: () => false, send: vi.fn() },
				} as unknown as BrowserWindow;
				const { token, cleanup } = registry.registerSpawn({
					sessionId: userId,
					owner: { userId, window },
				});
				cleanups.push(cleanup);
				decisions.push(registry.createPending(userId, token));
				relay.onRequest!({
					requestId: userId,
					token,
					sessionId: userId,
					toolName: 'Write',
					input: {},
					createdAt: 1,
				});
			}
			for (const [userId, webContentsId] of [
				['alice', 11],
				['bob', 22],
			] as const) {
				expect(
					integration.listPermissionRequests({ userId, webContentsId }).map((r) => r.requestId)
				).toEqual([userId]);
				expect(
					integration.listPermissionRequests({ type: 'browser', userId }).map((r) => r.requestId)
				).toEqual([userId]);
			}
			expect(integration.listPermissionRequests({ userId: 'alice', webContentsId: 22 })).toEqual(
				[]
			);
			expect(integration.listPermissionRequests()).toEqual([]);
		} finally {
			cleanups.forEach((cleanup) => cleanup());
			await Promise.all(decisions);
		}
	});
});
