import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createNativeTempDir } from './temp-root.cjs';

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
for (const provider of ['claude', 'codex']) {
	describe(`new shell synthetic ${provider} writes`, () => {
		it.each([true, false])(
			'only a persisted turn writes project files, persisted %s',
			async (persist) => {
				const root = createNativeTempDir('shell-files-');
				roots.push(root);
				const scene = {
					answer: 'Written',
					writes: { 'src/cart.ts': 'export const shipping = 0;\n' },
				};
				const script = path.join(root, 'script.json');
				fs.writeFileSync(script, JSON.stringify({ scene, synopsis: scene }));
				await exec(
					process.execPath,
					[
						path.resolve(`e2e/fixtures/native/${provider}`),
						provider === 'claude' ? '--print' : 'exec',
						...(persist ? [] : ['--no-session-persistence']),
						'--',
						'Synthetic request',
					],
					{
						cwd: root,
						env: {
							...process.env,
							CLAUDE_CONFIG_DIR: root,
							CODEX_HOME: root,
							MAESTRO_NATIVE_SCRIPT: script,
						},
					}
				);
				const file = path.join(root, 'src/cart.ts');
				expect(fs.existsSync(file)).toBe(persist);
				if (persist) expect(fs.readFileSync(file, 'utf8')).toBe(scene.writes['src/cart.ts']);
			}
		);
		it('rejects a write outside the project', async () => {
			const root = createNativeTempDir('shell-files-');
			roots.push(root);
			const script = path.join(root, 'script.json');
			fs.writeFileSync(
				script,
				JSON.stringify({
					scene: { answer: 'Never written', writes: { '../outside.ts': 'escape' } },
				})
			);
			await expect(
				exec(
					process.execPath,
					[
						path.resolve(`e2e/fixtures/native/${provider}`),
						provider === 'claude' ? '--print' : 'exec',
						'--',
						'Synthetic request',
					],
					{
						cwd: root,
						env: {
							...process.env,
							CLAUDE_CONFIG_DIR: root,
							CODEX_HOME: root,
							MAESTRO_NATIVE_SCRIPT: script,
						},
					}
				)
			).rejects.toThrow('Fixture write escapes project');
		});
	});
}
