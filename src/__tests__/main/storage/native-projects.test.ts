import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNativeProjectDiscovery } from '../../../main/storage/native-projects';

let root: string;
let project: string;
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-projects-'));
	root = await fs.realpath(root);
	project = path.join(root, 'my-project');
	await fs.mkdir(project);
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});
async function transcript(provider: string, name: string, cwd = project, account = 'account') {
	const file = path.join(
		root,
		account,
		provider === 'codex' ? 'sessions/2026/11/06' : 'projects/lossy-name',
		name
	);
	await fs.mkdir(path.dirname(file), { recursive: true });
	const content =
		JSON.stringify(provider === 'codex' ? { type: 'session_meta', payload: { cwd } } : { cwd }) +
		'\n';
	await fs.writeFile(file, name.endsWith('.zst') ? zstdCompressSync(content) : content);
	return file;
}
it('reads cwd, merges tools and aliases, sorts by activity, and never writes native history', async () => {
	const alias = path.join(root, 'alias');
	await fs.symlink(project, alias, 'junction');
	const claude = await transcript('claude-code', 'one.jsonl');
	const codex = await transcript('codex', 'rollout-20261106-abc.jsonl', alias);
	await fs.utimes(claude, 100, 100);
	await fs.utimes(codex, 200, 200);
	const before = await Promise.all([fs.readFile(claude), fs.readFile(codex)]);
	const accounts = vi.fn(async () => [path.join(root, 'account')]);
	const discover = createNativeProjectDiscovery({ accountDirs: accounts });
	expect(await discover()).toEqual([
		{ path: project, tools: ['claude-code', 'codex'], lastActivity: 200000, sessionCount: 2 },
	]);
	expect(await Promise.all([fs.readFile(claude), fs.readFile(codex)])).toEqual(before);
	expect((await fs.stat(codex)).mtimeMs).toBe(200000);
	await discover();
	expect(accounts).toHaveBeenCalledTimes(2);
});
it('omits missing directories, including directories removed after caching', async () => {
	await transcript('claude-code', 'one.jsonl');
	await transcript('claude-code', 'missing.jsonl', path.join(root, 'gone'));
	const discover = createNativeProjectDiscovery({
		accountDirs: async () => [path.join(root, 'account')],
	});
	expect(await discover()).toHaveLength(1);
	await fs.rmdir(project);
	expect(await discover()).toEqual([]);
});
it('reads compressed archived rollouts once, and reads the head of large plain files', async () => {
	const file = await transcript('codex', 'rollout-20261106-abc.jsonl.zst');
	const archive = path.join(root, 'account', 'archived_sessions');
	await fs.mkdir(archive);
	await fs.rename(file, path.join(archive, path.basename(file)));
	const plain = await transcript('codex', 'rollout-20261106-def.jsonl');
	await fs.appendFile(plain, 'x'.repeat(1024 * 1024));
	const discover = createNativeProjectDiscovery({
		accountDirs: async () => [path.join(root, 'account')],
	});
	expect((await discover())[0].sessionCount).toBe(2);
});
it('honors account roots and bounds file reads', async () => {
	await transcript('claude-code', 'one.jsonl', project, 'custom');
	await transcript('claude-code', 'two.jsonl', project, 'custom');
	await transcript('claude-code', 'three.jsonl', project, 'ignored');
	const discover = createNativeProjectDiscovery({
		accountDirs: async () => [path.join(root, 'custom')],
		maxFiles: 1,
	});
	expect((await discover())[0].sessionCount).toBe(1);
});

it('ignores a corrupt compressed archive without losing readable projects', async () => {
	const broken = await transcript('codex', 'rollout-broken.jsonl.zst');
	await fs.writeFile(broken, 'not a zstd stream');
	await transcript('claude-code', 'good.jsonl');
	const discover = createNativeProjectDiscovery({
		accountDirs: async () => [path.join(root, 'account')],
	});
	expect(await discover()).toEqual([
		{ path: project, tools: ['claude-code'], lastActivity: expect.any(Number), sessionCount: 1 },
	]);
});

it('bounds directory enumeration even when no transcripts are found', async () => {
	await transcript('claude-code', 'good.jsonl');
	const discover = createNativeProjectDiscovery({
		accountDirs: async () => [path.join(root, 'account')],
		maxEntries: 0,
	});
	expect(await discover()).toEqual([]);
});
