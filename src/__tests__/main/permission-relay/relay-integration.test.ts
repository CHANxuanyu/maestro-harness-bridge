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
			userDataDir: root,
			execPath: process.execPath,
		});
		const configPath = args[args.indexOf('--mcp-config') + 1];
		expect(fs.existsSync(configPath)).toBe(true);
		processManager.emit('exit', 'conversation-ai-tab', 0);
		expect(fs.existsSync(configPath)).toBe(false);
		expect(registry.relayRegistryStats()).toEqual({ bindings: 0, pending: 0 });
	});

	it('lists pending requests without relay credentials and broadcasts resolution', () => {
		const send = vi.fn();
		const window = {
			isDestroyed: () => false,
			webContents: { isDestroyed: () => false, send },
		} as unknown as BrowserWindow;
		integration.initPermissionRelay(() => window, new EventEmitter());
		const request: PermissionRequest = {
			requestId: 'request-1',
			token: 'private-spawn-token',
			sessionId: 'conversation-ai-tab',
			tabId: 'tab',
			toolName: 'Write',
			input: { content: 'approved' },
			createdAt: 1,
		};
		relay.onRequest!(request);
		const { token: _token, ...visibleRequest } = request;
		expect(integration.listPermissionRequests()).toEqual([visibleRequest]);
		expect(send).toHaveBeenCalledWith('process:permission-request', visibleRequest);
		relay.onResolved!('request-1');
		expect(integration.listPermissionRequests()).toEqual([]);
		expect(send).toHaveBeenCalledWith('process:permission-resolved', 'request-1');
	});
});
