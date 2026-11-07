import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	prepareCodexAppServerPermissions,
	listCodexAppServerPermissions,
} from '../../../main/permission-relay/codex-app-server';
import { resolvePermissionResponse } from '../../../main/permission-relay/integration';
import { runAsActingUser } from '../../../main/web-server/auth/acting-user';
import { relayRegistryStats, resolvePending } from '../../../main/permission-relay/registry';

const request = {
	requestId: 'number:7',
	method: 'item/commandExecution/requestApproval',
	threadId: 'thread-fixture',
	turnId: 'turn-fixture',
	itemId: 'item-fixture',
	command: 'printf synthetic',
	cwd: '/fixture/project',
	reason: 'fixture approval',
};
const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.useRealTimers();
	expect(relayRegistryStats()).toEqual({ bindings: 0, pending: 0 });
});
function prepare(windowId = 11) {
	const send = vi.fn();
	const win = {
		isDestroyed: () => false,
		webContents: { id: windowId, isDestroyed: () => false, send },
	};
	const bridge = prepareCodexAppServerPermissions({
		sessionId: 'project-ai-tab',
		tabId: 'tab',
		getMainWindow: () => win as any,
	});
	cleanups.push(bridge.onDispose);
	return { bridge, send };
}
describe('Codex app-server permission integration', () => {
	it('uses the existing permission registry with a unique UI request id', async () => {
		const { bridge, send } = prepare();
		const decision = bridge.onPermissionRequest(request);
		const [channel, prompt] = send.mock.calls[0];
		expect(channel).toBe('process:permission-request');
		expect(prompt).toMatchObject({
			sessionId: 'project-ai-tab',
			tabId: 'tab',
			toolName: 'Bash',
			input: { command: request.command, cwd: request.cwd, reason: request.reason },
		});
		expect(prompt.requestId).not.toBe(request.requestId);
		expect(resolvePending(prompt.requestId, { behavior: 'allow' })).toBe(true);
		await expect(decision).resolves.toBe('accept');
		expect(send).toHaveBeenLastCalledWith('process:permission-resolved', prompt.requestId);
		expect(resolvePending(prompt.requestId, { behavior: 'allow' })).toBe(false);
	});
	it('denies unavailable UI, server-resolved requests and stopped processes', async () => {
		const unavailable = prepareCodexAppServerPermissions({
			sessionId: 'missing-window',
			getMainWindow: () => null,
		});
		cleanups.push(unavailable.onDispose);
		await expect(unavailable.onPermissionRequest(request)).resolves.toBe('decline');
		const { bridge, send } = prepare();
		const decision = bridge.onPermissionRequest(request);
		const id = send.mock.calls[0][1].requestId;
		bridge.onPermissionResolved(request.requestId);
		await expect(decision).resolves.toBe('decline');
		expect(resolvePending(id, { behavior: 'allow' })).toBe(false);
		const stopped = bridge.onPermissionRequest({ ...request, requestId: 'number:8' });
		bridge.onDispose();
		await expect(stopped).resolves.toBe('decline');
		await expect(bridge.onPermissionRequest({ ...request, requestId: 'number:9' })).resolves.toBe(
			'decline'
		);
	});
	it('expires the UI prompt and rejects late approval', async () => {
		vi.useFakeTimers();
		const { bridge, send } = prepare();
		const decision = bridge.onPermissionRequest(request);
		const id = send.mock.calls[0][1].requestId;
		await vi.advanceTimersByTimeAsync(300_000);
		await expect(decision).resolves.toBe('decline');
		expect(send).toHaveBeenLastCalledWith('process:permission-resolved', id);
		expect(resolvePending(id, { behavior: 'allow' })).toBe(false);
	});
});

it('lists only pending prototype approvals with the same IDs the prompt receives', async () => {
	const { bridge, send } = prepare();
	const decision = bridge.onPermissionRequest(request);
	const prompt = send.mock.calls[0][1];
	expect(listCodexAppServerPermissions({ webContentsId: 11 })).toEqual([prompt]);
	resolvePending(prompt.requestId, { behavior: 'deny', message: 'Fixture denial' });
	await decision;
	expect(listCodexAppServerPermissions({ webContentsId: 11 })).toEqual([]);
});

const userA = { id: 'user-a', username: 'alice', displayName: 'Alice' };
it('hides another user and window requests and refuses their decisions', async () => {
	const { bridge, send } = runAsActingUser(userA, () => prepare());
	const decision = bridge.onPermissionRequest(request);
	const id = send.mock.calls[0][1].requestId;
	const stranger = { userId: 'user-b', webContentsId: 11 };
	expect(listCodexAppServerPermissions(stranger)).toEqual([]);
	expect(resolvePermissionResponse(id, { behavior: 'allow' }, stranger)).toBe(false);
	expect(
		resolvePermissionResponse(id, { behavior: 'allow' }, { userId: userA.id, webContentsId: 22 })
	).toBe(false);
	const owner = { userId: userA.id, webContentsId: 11 };
	expect(listCodexAppServerPermissions(owner)).toHaveLength(1);
	expect(resolvePermissionResponse(id, { behavior: 'allow' }, owner)).toBe(true);
	await expect(decision).resolves.toBe('accept');
	expect(resolvePermissionResponse(id, { behavior: 'allow' }, owner)).toBe(false);
});

it('rejects a response with no authenticated caller', async () => {
	const { bridge, send } = prepare();
	const decision = bridge.onPermissionRequest(request);
	expect(resolvePermissionResponse(send.mock.calls[0][1].requestId, { behavior: 'allow' })).toBe(
		false
	);
	bridge.onDispose();
	await expect(decision).resolves.toBe('decline');
});

it('keeps the original window and refuses approval after it closes', async () => {
	const destroyed = vi.fn(() => false);
	const send = vi.fn();
	const original = {
		isDestroyed: destroyed,
		webContents: { id: 11, isDestroyed: destroyed, send },
	};
	let window = original;
	const bridge = prepareCodexAppServerPermissions({
		sessionId: 'owner',
		getMainWindow: () => window as any,
	});
	cleanups.push(bridge.onDispose);
	window = { ...original, webContents: { ...original.webContents, id: 22, send: vi.fn() } };
	const decision = bridge.onPermissionRequest(request);
	const id = send.mock.calls[0][1].requestId;
	expect(window.webContents.send).not.toHaveBeenCalled();
	destroyed.mockReturnValue(true);
	expect(resolvePermissionResponse(id, { behavior: 'allow' }, { webContentsId: 11 })).toBe(false);
	bridge.onDispose();
	await expect(decision).resolves.toBe('decline');
});
