import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';

const refusal = vi.hoisted(() => ({ visible: vi.fn() }));
vi.mock('@playwright/test', async (original) => {
	const { expect } = await import('vitest');
	return {
		...(await original<typeof import('@playwright/test')>()),
		expect: (value: unknown) => ({
			toBeVisible: refusal.visible,
			toEqual: (expected: unknown) => expect(value).toEqual(expected),
		}),
	};
});
import { NativeApp } from '../native-app';

let native: NativeApp;
const input = { fill: vi.fn(), press: vi.fn() };
const output = { getByText: vi.fn() };
beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv('MAESTRO_E2E_REAL', '1');
	native = new NativeApp({ title: 'claude worktree refusal' } as TestInfo);
	Object.assign(native, { provider: 'claude' });
	vi.spyOn(native, 'input').mockReturnValue(input as unknown as ReturnType<NativeApp['input']>);
	vi.spyOn(native, 'output').mockReturnValue(output as unknown as ReturnType<NativeApp['output']>);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	fs.rmSync(native.root, { recursive: true, force: true });
});

it('accepts a refused send with no scenes or script', async () => {
	await native.send('Continue after archive', { expectRefusal: /Worktree is gone/ });
	expect(fs.existsSync(native.script)).toBe(false);
	expect(fs.existsSync(native.control)).toBe(false);
});

it.each([false, true])(
	'a refused send needs no workload and preserves the invocation record, existing=%s',
	async (existing) => {
		const record = path.join(native.claude, 'fixture-process');
		if (existing) fs.writeFileSync(record, 'previous-pid');
		native.scriptTurns([{ answer: 'The next accepted turn.' }]);
		const script = fs.readFileSync(native.script, 'utf8');
		await native.send('Continue after archive', { expectRefusal: /Worktree is gone/ });
		expect(input.fill).toHaveBeenCalledWith('Continue after archive');
		expect(input.press).toHaveBeenCalledWith('Enter');
		expect(output.getByText).toHaveBeenCalledWith(/Worktree is gone/);
		expect(refusal.visible).toHaveBeenCalledOnce();
		expect(fs.readFileSync(native.script, 'utf8')).toBe(script);
		expect(fs.existsSync(native.control)).toBe(false);
		await native.send('An accepted send');
		expect(JSON.parse(fs.readFileSync(native.script, 'utf8')).scene.answer).toBe(
			'The next accepted turn.'
		);
	}
);

it.each([false, true])(
	'fails if a refused send starts a CLI, existing invocation record=%s',
	async (existing) => {
		const record = path.join(native.claude, 'fixture-process');
		if (existing) fs.writeFileSync(record, 'previous-pid');
		refusal.visible.mockImplementation(async () => fs.writeFileSync(record, 'unexpected-pid'));
		await expect(
			native.send('Continue after archive', { expectRefusal: /Worktree is gone/ })
		).rejects.toThrow();
	}
);

it('still requires an acceptance workload for an ordinary real send', async () => {
	await expect(native.send('Continue')).rejects.toThrow('No acceptance workload');
	expect(input.press).not.toHaveBeenCalled();
});

it('also checks the refusal message in synthetic mode', async () => {
	Object.assign(native, { real: false });
	await native.send('Continue after archive', { expectRefusal: /Worktree is gone/ });
	expect(input.fill).toHaveBeenCalledWith('Continue after archive');
	expect(refusal.visible).toHaveBeenCalledOnce();
});
