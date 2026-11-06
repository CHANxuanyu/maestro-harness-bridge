import { EventEmitter } from 'events';
import type { Socket } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionRelayServer } from '../../../main/permission-relay/PermissionRelayServer';
import {
	registerSpawn,
	relayRegistryStats,
	resolvePending,
} from '../../../main/permission-relay/registry';
import {
	RELAY_DECISION_TIMEOUT_MS,
	type PermissionRequest,
} from '../../../main/permission-relay/types';

const transport = vi.hoisted(() => ({
	accept: undefined as ((socket: Socket) => void) | undefined,
}));
vi.mock('net', () => ({
	createServer: (accept: (socket: Socket) => void) => {
		transport.accept = accept;
		return {
			once: vi.fn(),
			removeListener: vi.fn(),
			listen: (_path: string, ready: () => void) => ready(),
			close: vi.fn(),
		};
	},
}));
vi.mock('fs', () => ({ unlinkSync: vi.fn(), chmodSync: vi.fn() }));
vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('permission relay request lifetime without OS sockets', () => {
	let server: PermissionRelayServer;
	let cleanup: () => void;
	let socket: EventEmitter & {
		destroyed: boolean;
		setEncoding: ReturnType<typeof vi.fn>;
		write: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
	};
	let captured: PermissionRequest;

	beforeEach(async () => {
		vi.useFakeTimers();
		server = new PermissionRelayServer();
		await server.ensureStarted('/temporary-relay-test');
		socket = Object.assign(new EventEmitter(), {
			destroyed: false,
			setEncoding: vi.fn(),
			write: vi.fn(),
			destroy: vi.fn(() => {
				socket.destroyed = true;
				socket.emit('close');
			}),
		});
		transport.accept!(socket as unknown as Socket);
		const binding = registerSpawn({ sessionId: 'conversation-ai-tab', tabId: 'tab' });
		cleanup = binding.cleanup;
		server.setOnRequest((request) => {
			captured = request;
		});
		socket.emit(
			'data',
			JSON.stringify({
				type: 'permission-request',
				token: binding.token,
				requestId: 'bridge-1',
				toolName: 'Write',
				input: { file_path: '/temporary-project/approved.txt', content: 'approved' },
			}) + '\n'
		);
	});

	afterEach(() => {
		cleanup();
		server.stop();
		vi.useRealTimers();
		expect(relayRegistryStats()).toEqual({ bindings: 0, pending: 0 });
	});

	it('invalidates a disconnected bridge request before a late approval can land', async () => {
		socket.destroy();
		expect(resolvePending(captured.requestId, { behavior: 'allow' })).toBe(false);
		await Promise.resolve();
		expect(socket.write).not.toHaveBeenCalled();
	});

	it('denies pending decisions and destroys clients when the server stops', async () => {
		server.stop();
		expect(resolvePending(captured.requestId, { behavior: 'allow' })).toBe(false);
		expect(socket.destroy).toHaveBeenCalledOnce();
		await Promise.resolve();
		expect(server.isRunning()).toBe(false);
	});

	it('reports an expired request to its UI and rejects a late decision', async () => {
		const resolved = vi.fn();
		server.setOnResolved(resolved);
		await vi.advanceTimersByTimeAsync(RELAY_DECISION_TIMEOUT_MS);
		expect(resolved).toHaveBeenCalledExactlyOnceWith(captured.requestId);
		expect(resolvePending(captured.requestId, { behavior: 'allow' })).toBe(false);
		expect(JSON.parse(socket.write.mock.calls[0][0])).toEqual({
			type: 'permission-response',
			requestId: 'bridge-1',
			decision: {
				behavior: 'deny',
				message: 'Permission request timed out with no response.',
			},
		});
	});

	it.each(['allow', 'deny'] as const)(
		'returns %s exactly once and clears the UI request',
		async (behavior) => {
			const resolved = vi.fn();
			server.setOnResolved(resolved);
			const decision =
				behavior === 'allow' ? { behavior } : { behavior, message: 'User declined.' };
			expect(resolvePending(captured.requestId, decision)).toBe(true);
			expect(resolvePending(captured.requestId, { behavior: 'allow' })).toBe(false);
			await Promise.resolve();
			expect(resolved).toHaveBeenCalledExactlyOnceWith(captured.requestId);
			expect(socket.write).toHaveBeenCalledOnce();
			expect(JSON.parse(socket.write.mock.calls[0][0]).decision).toEqual(decision);
		}
	);

	it('cleans up the owning process without allowing a stale request', async () => {
		const resolved = vi.fn();
		server.setOnResolved(resolved);
		cleanup();
		await Promise.resolve();
		expect(resolved).toHaveBeenCalledExactlyOnceWith(captured.requestId);
		expect(resolvePending(captured.requestId, { behavior: 'allow' })).toBe(false);
		expect(JSON.parse(socket.write.mock.calls[0][0]).decision.behavior).toBe('deny');
	});
});
