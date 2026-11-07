import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { NativeCommandContext } from '../../../src/shared/nativeCommands';
import { createNativeTempDir } from './temp-root.cjs';
import { holdNativeCommandScan } from './command-scan-gate';

const channel = 'agents:getNativeCommands';
const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>();
const ipcMain = {
	_invokeHandlers: handlers,
	handle: vi.fn((name: string, handler: Parameters<IpcMain['handle']>[1]) => {
		if (handlers.has(name)) throw new Error(`Handler already registered: ${name}`);
		handlers.set(name, handler);
	}),
	removeHandler: vi.fn((name: string) => {
		handlers.delete(name);
	}),
};
const electron = { ipcMain: ipcMain as unknown as IpcMain };
const event = { sender: { id: 1 } } as IpcMainInvokeEvent;
const snapshot = { commands: [{ command: '/deploy', description: 'Deploy', source: 'project' }] };
const original = vi.fn().mockResolvedValue(snapshot);
let root: string;
let target: Parameters<typeof holdNativeCommandScan>[1];
let request: NativeCommandContext;
let gate: ReturnType<typeof holdNativeCommandScan> | undefined;

// Playwright serializes this function into a main-process context without require or imports.
const install = runInNewContext(
	`(${holdNativeCommandScan.toString()})`
) as typeof holdNativeCommandScan;

beforeEach(() => {
	vi.clearAllMocks();
	original.mockReset().mockResolvedValue(snapshot);
	handlers.clear();
	handlers.set(channel, original);
	root = createNativeTempDir('command-scan-');
	target = { cwd: path.join(root, 'project'), accountDir: path.join(root, 'account') };
	request = {
		toolType: 'claude-code',
		cwd: target.cwd,
		customEnvVars: { CLAUDE_CONFIG_DIR: target.accountDir },
	};
	gate = undefined;
});

afterEach(async () => {
	gate?.release();
	await fs.rm(root, { recursive: true, force: true });
});

it('holds target scans in the serialized context, then restores the handler and releases every request', async () => {
	gate = install(electron, target);
	expect(gate.waiting).toBe(false);
	const held = handlers.get(channel)!;
	let completed = 0;
	const first = held(event, request).then((result: unknown) => {
		completed++;
		return result;
	});
	const second = held(event, request, false).then((result: unknown) => {
		completed++;
		return result;
	});
	expect(gate.waiting).toBe(true);
	await Promise.resolve();
	expect(completed).toBe(0);
	expect(original).not.toHaveBeenCalled();
	gate.release();
	expect(handlers.get(channel)).toBe(original);
	expect(await first).toBe(snapshot);
	expect(await second).toBe(snapshot);
	expect(completed).toBe(2);
	expect(original.mock.calls).toEqual([
		[event, request],
		[event, request, false],
	]);
	expect(await handlers.get(channel)!(event, request)).toBe(snapshot);
	expect(original).toHaveBeenCalledTimes(3);
});

it('passes cached reads and other accounts, projects, providers, remote contexts and conversation lookups through', async () => {
	gate = install(electron, target);
	const held = handlers.get(channel)!;
	const calls = [
		[request, true],
		[{ ...request, customEnvVars: { CLAUDE_CONFIG_DIR: path.join(root, 'other-account') } }],
		[{ ...request, cwd: path.join(root, 'other-project') }],
		[{ ...request, toolType: 'codex' }],
		[{ ...request, sessionSshRemoteConfig: { enabled: true, remoteId: 'fixture-remote' } }],
		[{ sessionId: 'fixture-session', tabId: 'fixture-tab' }],
	];
	for (const args of calls) {
		expect(await held(event, ...args)).toBe(snapshot);
		expect(gate.waiting).toBe(false);
	}
	expect(original.mock.calls).toEqual(calls.map((args) => [event, ...args]));
	original.mockClear();
	const scan = held(event, request);
	for (const args of calls) {
		expect(await held(event, ...args)).toBe(snapshot);
		expect(gate.waiting).toBe(true);
	}
	expect(original.mock.calls).toEqual(calls.map((args) => [event, ...args]));
	gate.release();
	expect(await scan).toBe(snapshot);
	expect(original).toHaveBeenLastCalledWith(event, request);
});

it('preserves handler rejection after releasing a held scan', async () => {
	const error = new Error('Fixture scan failed');
	original.mockRejectedValueOnce(error);
	gate = install(electron, target);
	const scan = handlers.get(channel)!(event, request);
	expect(gate.waiting).toBe(true);
	expect(original).not.toHaveBeenCalled();
	gate.release();
	await expect(scan).rejects.toBe(error);
	expect(handlers.get(channel)).toBe(original);
	expect(original).toHaveBeenCalledExactlyOnceWith(event, request);
});

it('can release before a scan and tolerates repeated cleanup without replacing a later handler', async () => {
	gate = install(electron, target);
	gate.release();
	expect(gate.waiting).toBe(false);
	expect(handlers.get(channel)).toBe(original);
	expect(await handlers.get(channel)!(event, request)).toBe(snapshot);
	const replacement = vi.fn();
	ipcMain.removeHandler(channel);
	ipcMain.handle(channel, replacement);
	gate.release();
	expect(handlers.get(channel)).toBe(replacement);
});

it.each(['registry', 'handler'])(
	'fails explicitly when the Electron %s is unavailable',
	(missing) => {
		if (missing === 'handler') handlers.clear();
		const module =
			missing === 'registry' ? { ipcMain: { ...ipcMain, _invokeHandlers: undefined } } : electron;
		expect(() => install(module as typeof electron, target)).toThrow(
			'Cannot hold scan: Electron IPC handler agents:getNativeCommands is unavailable'
		);
		expect(ipcMain.removeHandler).not.toHaveBeenCalled();
		expect(ipcMain.handle).not.toHaveBeenCalled();
	}
);
