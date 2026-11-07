import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	prepareCodexAppServerPermissions,
	listCodexAppServerPermissions,
} from '../../../main/permission-relay/codex-app-server';
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
function prepare() {
	const send = vi.fn();
	const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } };
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
	expect(listCodexAppServerPermissions()).toEqual([prompt]);
	resolvePending(prompt.requestId, { behavior: 'deny', message: 'Fixture denial' });
	await decision;
	expect(listCodexAppServerPermissions()).toEqual([]);
});
