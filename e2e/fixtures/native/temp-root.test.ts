import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';
import { NativeApp } from '../native-app';
import { createOmpTurn } from './omp-protocol.cjs';

const roots: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('uses a physical native app root when the configured temporary root is a symlink', () => {
	const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'maestro-temp-root-'));
	roots.push(root);
	const physical = path.join(root, 'physical');
	const alias = path.join(root, 'alias');
	fs.mkdirSync(physical);
	fs.symlinkSync(physical, alias, 'junction');
	vi.stubEnv('MAESTRO_E2E_TEMP_ROOT', alias);
	const native = new NativeApp({ title: 'omp temporary root' } as TestInfo);
	expect(native.root).toBe(fs.realpathSync(native.root));
	expect(path.dirname(native.root)).toBe(physical);
});

it('OMP uses the configured native root and still refuses projects outside it', () => {
	const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'maestro-temp-root-'));
	roots.push(root);
	const systemTemp = path.join(root, 'system');
	const nativeTemp = path.join(root, 'native');
	fs.mkdirSync(systemTemp);
	fs.mkdirSync(nativeTemp);
	for (const key of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(key, systemTemp);
	vi.stubEnv('MAESTRO_E2E_TEMP_ROOT', nativeTemp);
	const native = new NativeApp({ title: 'omp temporary root' } as TestInfo);
	const turn = createOmpTurn({
		configDir: native.omp,
		cwd: native.project,
		prompt: 'Temporary root',
	});
	expect(fs.existsSync(turn.file)).toBe(true);
	expect(() =>
		createOmpTurn({ configDir: native.omp, cwd: systemTemp, prompt: 'Outside' })
	).toThrow('Fixture project must be under the temporary root');
});
