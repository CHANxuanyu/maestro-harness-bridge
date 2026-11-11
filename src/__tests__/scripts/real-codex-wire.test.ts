// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { createNativeTempDir } from '../../../e2e/fixtures/native/temp-root.cjs';
import { observeCodexWire, type Wire } from '../../../e2e/fixtures/real-codex';
import type { NativeApp } from '../../../e2e/fixtures/native-app';

vi.mock('../../../e2e/fixtures/native-app', () => ({ NativeApp: class {} }));

let root: string;
afterEach(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
});

it('installs in an evaluate scope without require and observes the cached controller without changing delivery', async () => {
	root = createNativeTempDir('maestro-wire-unit-');
	const modulePath = path.join(root, 'controller.cjs');
	fs.writeFileSync(
		modulePath,
		`
module.exports.CodexAppServerSession = class {
	constructor() { this.calls = []; }
	send(message) { this.calls.push(message); return message; }
	handleMessage(message) {
		this.calls.push(message);
		if (message.method === 'throw') throw new Error('original handler error');
		return message;
	}
};
`
	);
	const { CodexAppServerSession } = createRequire(modulePath)(modulePath);
	const controller = new CodexAppServerSession();
	const context = vm.createContext({ process });
	expect(vm.runInContext('typeof require', context)).toBe('undefined');
	const native = {
		app: {
			evaluate: async (
				callback: (electron: unknown, modulePath: string) => unknown,
				requestedPath: string
			) => {
				expect(requestedPath).toBe(
					path.resolve('dist/main/process-manager/CodexAppServerSession.js')
				);
				const serialized = vm.runInContext(`(${callback.toString()})`, context);
				await serialized({}, modulePath);
			},
		},
	} as unknown as NativeApp;
	await observeCodexWire(native);
	const sent = { id: 1, method: 'initialize' };
	const received = { method: 'turn/completed' };
	expect(controller.send(sent)).toBe(sent);
	expect(controller.send(sent)).toBe(sent);
	expect(controller.handleMessage(received)).toBe(received);
	expect(controller.handleMessage(received)).toBe(received);
	expect(controller.calls).toEqual([sent, sent, received, received]);
	const wire: Wire[] = context.__realCodexWire;
	expect(wire).toEqual([
		{ direction: 'send', message: sent },
		{ direction: 'send', message: sent },
		{ direction: 'receive', message: received },
	]);
	received.method = 'changed after delivery';
	expect(wire[2].message.method).toBe('turn/completed');
	expect(() => controller.handleMessage({ method: 'throw' })).toThrow('original handler error');
	expect(wire).toHaveLength(4);
});
