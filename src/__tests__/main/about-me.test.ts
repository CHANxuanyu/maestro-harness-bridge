import fs from 'node:fs/promises';
import * as atomicFs from 'fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAboutMeService } from '../../main/about-me';
import { estimateTokenCount } from '../../shared/formatters';
import type { AboutMeResult, AboutMeConfirmation, AboutMeTarget } from '../../shared/aboutMe';
import * as aboutMeContract from '../../shared/aboutMe';
import type { AgentAccountDirLayers } from '../../shared/agentAccountDir';

vi.mock('../../main/utils/sentry', () => ({ captureException: vi.fn() }));
vi.mock('fs/promises', async (original) => {
	const actual = await original<typeof import('fs/promises')>();
	return { ...actual, rename: vi.fn(actual.rename) };
});
const START = '<!-- maestro:about-me:start -->';
const END = '<!-- maestro:about-me:end -->';
let root: string;
let claude: string;
let codex: string;
let values: Record<string, unknown>;
let files: AboutMeTarget[];
let layers: AgentAccountDirLayers;
const changed = vi.fn();
const store = {
	get: (key: string, fallback?: unknown) => (Object.hasOwn(values, key) ? values[key] : fallback),
	set: (key: string, value: unknown) => {
		values[key] = JSON.parse(JSON.stringify(value));
	},
};
const service = () =>
	createAboutMeService({
		settingsStore: store as never,
		getFiles: async () => files,
		getAccountDirLayers: () => layers,
		onContentChanged: changed,
	});
const confirm = (status: AboutMeResult): AboutMeConfirmation[] =>
	status.files.flatMap((file) =>
		file.resolvedPath && file.currentBlock !== undefined
			? [{ path: file.path, resolvedPath: file.resolvedPath, block: file.currentBlock }]
			: []
	);
async function applyConfirmed(api: ReturnType<typeof service>) {
	const status = await api.command({ action: 'status' });
	return api.command({ action: 'apply', content: status.content, confirmations: confirm(status) });
}
beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-about-me-')));
	claude = path.join(root, 'claude', 'CLAUDE.md');
	codex = path.join(root, 'codex', 'AGENTS.md');
	for (const file of [claude, codex]) await fs.mkdir(path.dirname(file));
	files = [
		{ path: claude, provider: 'claude-code' },
		{ path: codex, provider: 'codex' },
	];
	values = {};
	layers = {
		homeDir: root,
		env: {},
		globalShellEnvVars: {
			CLAUDE_CONFIG_DIR: path.dirname(claude),
			CODEX_HOME: path.dirname(codex),
		},
	};
	changed.mockClear();
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe('About me native file consent and byte preservation', () => {
	it('reuses the existing profile, and staging or an unconfirmed apply changes no native file', async () => {
		await fs.writeFile(claude, 'Existing user instructions\r\n');
		const api = service();
		expect(await api.command({ action: 'set', content: 'Prefer concise answers.' })).toMatchObject({
			success: true,
			content: 'Prefer concise answers.',
			estimatedTokens: estimateTokenCount('Prefer concise answers.'),
		});
		expect(values.conductorProfile).toBe('Prefer concise answers.');
		const result = await api.command({ action: 'apply', content: 'Prefer concise answers.' });
		expect(result).toMatchObject({ success: false, code: 'confirmation-required' });
		expect(result.files.map((file) => file.state)).toEqual(['unconfirmed', 'unconfirmed']);
		expect(await fs.readFile(claude, 'utf8')).toBe('Existing user instructions\r\n');
		await expect(fs.stat(codex)).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('confirmed add, update and clear preserve all original bytes, including non-UTF8 and no final newline', async () => {
		const prefix = Buffer.concat([
			Buffer.from([0xef, 0xbb, 0xbf, 0xff]),
			Buffer.from('Original\r\nNo final newline'),
		]);
		await fs.writeFile(claude, prefix);
		const api = service();
		await api.command({ action: 'set', content: 'First profile\n第二行' });
		expect((await applyConfirmed(api)).success).toBe(true);
		const first = await fs.readFile(claude);
		expect(first.subarray(0, prefix.length)).toEqual(prefix);
		expect(first.subarray(prefix.length).toString()).toBe(
			`${START}\nFirst profile\n第二行\n${END}`
		);
		await api.command({ action: 'set', content: 'Updated profile' });
		expect((await api.command({ action: 'apply', content: 'Updated profile' })).success).toBe(true);
		const updated = await fs.readFile(claude);
		expect(updated.subarray(0, prefix.length)).toEqual(prefix);
		expect(updated.subarray(prefix.length).toString()).toBe(`${START}\nUpdated profile\n${END}`);
		await api.command({ action: 'set', content: '' });
		expect((await api.command({ action: 'apply', content: '' })).success).toBe(true);
		expect(await fs.readFile(claude)).toEqual(prefix);
		expect(await fs.readFile(codex, 'utf8')).toBe('');
	});
	it('detects external managed edits and rejects stale confirmation without overwriting', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'Owned' });
		await applyConfirmed(api);
		const external = `${START}\nEdited outside Maestro\n${END}`;
		await fs.writeFile(claude, external);
		const observed = await api.command({ action: 'status' });
		expect(observed.files.find((file) => file.aliases.includes(claude))!.state).toBe(
			'external-change'
		);
		const refused = await api.command({ action: 'apply', content: 'Owned' });
		expect(refused).toMatchObject({ success: false, code: 'confirmation-required' });
		expect(await fs.readFile(claude, 'utf8')).toBe(external);
		const newer = `${START}\nA newer external edit\n${END}`;
		await fs.writeFile(claude, newer);
		expect(
			(await api.command({ action: 'apply', content: 'Owned', confirmations: confirm(observed) }))
				.success
		).toBe(false);
		expect(await fs.readFile(claude, 'utf8')).toBe(newer);
		expect((await applyConfirmed(api)).success).toBe(true);
		expect(await fs.readFile(claude, 'utf8')).toBe(`${START}\nOwned\n${END}`);
	});
	it('preserves outside edits and remembered ownership across service restart', async () => {
		const first = service();
		await first.command({ action: 'set', content: 'One' });
		await applyConfirmed(first);
		await fs.appendFile(claude, '\r\nOutside edit\r\n');
		const restarted = service();
		await restarted.command({ action: 'set', content: 'Two' });
		expect((await restarted.command({ action: 'apply', content: 'Two' })).success).toBe(true);
		expect(await fs.readFile(claude, 'utf8')).toBe(`${START}\nTwo\n${END}\r\nOutside edit\r\n`);
	});
	it('reports missing account directories and never creates them', async () => {
		const missing = path.join(root, 'missing', 'CLAUDE.md');
		files = [{ path: missing, provider: 'claude-code' }];
		const api = service();
		await api.command({ action: 'set', content: 'Preference' });
		const status = await api.command({ action: 'status' });
		expect(status.files[0].state).toBe('missing-directory');
		expect((await api.command({ action: 'apply', content: 'Preference' })).success).toBe(false);
		await expect(fs.stat(path.dirname(missing))).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('never applies a confirmation to an unrelated file or to a different profile', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'Current' });
		const status = await api.command({ action: 'status' });
		expect(
			(await api.command({ action: 'apply', content: 'Old', confirmations: confirm(status) }))
				.success
		).toBe(false);
		expect(
			(
				await api.command({
					action: 'apply',
					content: 'Current',
					confirmations: [
						{
							path: path.join(root, 'unrelated'),
							resolvedPath: path.join(root, 'unrelated'),
							block: null,
						},
					],
				})
			).success
		).toBe(false);
		await expect(fs.stat(claude)).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('reports the Codex override and leaves it untouched', async () => {
		const override = path.join(path.dirname(codex), 'AGENTS.override.md');
		await fs.writeFile(override, 'User-owned override\n');
		const api = service();
		await api.command({ action: 'set', content: 'Shared preference' });
		const result = await applyConfirmed(api);
		expect(result.files.find((file) => file.aliases.includes(codex))).toMatchObject({
			state: 'synced',
			shadowedBy: [override],
		});
		expect(await fs.readFile(override, 'utf8')).toBe('User-owned override\n');
	});
});

describe('About me write boundaries', () => {
	it.each([START, END, `${END}${START}`, `${START}${START}${END}`, `${START}${END}${END}`])(
		'refuses ambiguous existing markers: %s',
		async (bytes) => {
			await fs.writeFile(claude, bytes);
			files = [files[0]];
			const api = service();
			await api.command({ action: 'set', content: 'Preference' });
			const result = await applyConfirmed(api);
			expect(result.success).toBe(false);
			expect(result.files[0].state).toBe('invalid-block');
			expect(await fs.readFile(claude, 'utf8')).toBe(bytes);
		}
	);
	it('refuses non-UTF8 bytes inside the managed segment without altering the file', async () => {
		const bytes = Buffer.concat([Buffer.from(START), Buffer.from([0xff]), Buffer.from(END)]);
		await fs.writeFile(claude, bytes);
		files = [files[0]];
		const api = service();
		await api.command({ action: 'set', content: 'Preference' });
		expect((await applyConfirmed(api)).files[0].state).toBe('invalid-block');
		expect(await fs.readFile(claude)).toEqual(bytes);
	});
	it('does not adopt an unconfirmed matching segment as permission for later writes', async () => {
		files = [files[0]];
		const bytes = `${START}\nSame\n${END}`;
		await fs.writeFile(claude, bytes);
		const api = service();
		await api.command({ action: 'set', content: 'Same' });
		expect((await api.command({ action: 'apply', content: 'Same' })).files[0].state).toBe(
			'unconfirmed'
		);
		await api.command({ action: 'set', content: 'New' });
		expect((await api.command({ action: 'apply', content: 'New' })).success).toBe(false);
		expect(await fs.readFile(claude, 'utf8')).toBe(bytes);
	});
	it('does not create empty files or claim permission when the profile has never been applied', async () => {
		const api = service();
		expect((await api.command({ action: 'apply', content: '' })).success).toBe(true);
		await expect(fs.stat(claude)).rejects.toMatchObject({ code: 'ENOENT' });
		await api.command({ action: 'set', content: 'New' });
		expect((await api.command({ action: 'apply', content: 'New' })).files[0].state).toBe(
			'unconfirmed'
		);
	});
	it('keeps previously managed files after their agents are removed', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'One' });
		await applyConfirmed(api);
		files = [];
		await api.command({ action: 'set', content: '' });
		const result = await api.command({ action: 'apply', content: '' });
		expect(result.success).toBe(true);
		expect(result.files).toHaveLength(2);
		expect(await fs.readFile(claude, 'utf8')).toBe('');
		expect(await fs.readFile(codex, 'utf8')).toBe('');
	});
	it('serializes simultaneous applies and makes an identical apply a no-op', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'Concurrent' });
		const status = await api.command({ action: 'status' });
		const results = await Promise.all(
			[1, 2].map(() =>
				api.command({ action: 'apply', content: status.content, confirmations: confirm(status) })
			)
		);
		expect(results.every((result) => result.success)).toBe(true);
		expect(results.map((result) => result.written?.length).sort()).toEqual([0, 2]);
		expect(await fs.readFile(claude, 'utf8')).toBe(`${START}\nConcurrent\n${END}`);
	});
	it('reports partial success without rewriting unconfirmed files', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'Selective consent' });
		const status = await api.command({ action: 'status' });
		const result = await api.command({
			action: 'apply',
			content: status.content,
			confirmations: [confirm(status)[0]],
		});
		expect(result.success).toBe(false);
		expect(result.written).toEqual([claude]);
		expect(result.files.map((file) => file.state)).toEqual(['synced', 'unconfirmed']);
		await expect(fs.stat(codex)).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('leaves original bytes and ownership intact when atomic rename fails', async () => {
		files = [files[0]];
		const api = service();
		await api.command({ action: 'set', content: 'Original' });
		await applyConfirmed(api);
		const baseline = structuredClone(values.aboutMeApplied);
		const before = await fs.readFile(claude);
		await api.command({ action: 'set', content: 'Next' });
		vi.mocked(atomicFs.rename).mockRejectedValueOnce(
			Object.assign(new Error('disk rejected rename'), { code: 'EIO' })
		);
		const result = await api.command({ action: 'apply', content: 'Next' });
		expect(result.success).toBe(false);
		expect(result.files[0].state).toBe('error');
		expect(await fs.readFile(claude)).toEqual(before);
		expect(values.aboutMeApplied).toEqual(baseline);
	});
	it('reports a metadata failure after a file write and requires fresh confirmation next time', async () => {
		files = [files[0]];
		const api = service();
		await api.command({ action: 'set', content: 'Original' });
		const status = await api.command({ action: 'status' });
		const set = store.set;
		vi.spyOn(store, 'set').mockImplementation((key, value) => {
			if (key === 'aboutMeApplied') throw new Error('settings write failed');
			set(key, value);
		});
		const result = await api.command({
			action: 'apply',
			content: status.content,
			confirmations: confirm(status),
		});
		expect(result).toMatchObject({ success: false, written: [claude] });
		expect(result.files[0].state).toBe('error');
		expect(await fs.readFile(claude, 'utf8')).toContain('Original');
		vi.restoreAllMocks();
		expect((await api.command({ action: 'apply', content: status.content })).files[0].state).toBe(
			'unconfirmed'
		);
	});
	it('deduplicates account directory aliases and rechecks a repointed junction before applying consent', async () => {
		const aliasDir = path.join(root, 'alias');
		const linkType = process.platform === 'win32' ? 'junction' : 'dir';
		await fs.symlink(path.dirname(claude), aliasDir, linkType);
		const aliasFile = path.join(aliasDir, 'CLAUDE.md');
		files = [files[0], { path: aliasFile, provider: 'claude-code' }];
		const api = service();
		await api.command({ action: 'set', content: 'Preference' });
		const status = await api.command({ action: 'status' });
		expect(status.files).toHaveLength(1);
		expect(status.files[0].aliases.sort()).toEqual([claude, aliasFile].sort());
		expect((await applyConfirmed(api)).written).toEqual([claude]);
		expect((await fs.lstat(aliasDir)).isSymbolicLink()).toBe(true);
		const other = path.join(root, 'new-target');
		await fs.mkdir(other);
		await fs.unlink(aliasDir);
		await fs.symlink(other, aliasDir, linkType);
		const repointed = await api.command({ action: 'status' });
		const alias = repointed.files.find((file) => file.aliases.includes(aliasFile))!;
		expect(alias.state).toBe('unconfirmed');
		expect(alias.resolvedPath).toBe(path.join(other, 'CLAUDE.md'));
		expect(
			(
				await api.command({
					action: 'apply',
					content: status.content,
					confirmations: confirm(status),
				})
			).success
		).toBe(false);
		await expect(fs.stat(path.join(other, 'CLAUDE.md'))).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('stages long Unicode Markdown exactly and notifies only after the setting is saved', async () => {
		const api = service();
		const content = '偏好 🦉\r\n'.repeat(1000);
		const result = await api.command({ action: 'set', content }, 42);
		expect(result.content).toBe(content);
		expect(result.estimatedTokens).toBe(estimateTokenCount(content));
		expect(values.conductorProfile).toBe(content);
		expect(changed).toHaveBeenCalledExactlyOnceWith(42);
		expect((await service().command({ action: 'show' })).content).toBe(content);
	});
	it.each([
		{ action: 'other' },
		{ action: 'set', content: null },
		{ action: 'set', content: START },
		{ action: 'set', content: END },
		{ action: 'apply', content: 'x', confirmations: true },
		{ action: 'apply', content: 'x', confirmations: [{ path: 'x', resolvedPath: 'x', block: 1 }] },
	])('rejects invalid boundary input without changing the profile: %j', async (request) => {
		values.conductorProfile = 'Keep';
		const result = await service().command(request);
		expect(result).toMatchObject({ success: false, code: 'invalid-request' });
		expect(values.conductorProfile).toBe('Keep');
		expect(changed).not.toHaveBeenCalled();
	});
});

describe('preexisting managed text', () => {
	it('preserves invalid UTF-8 outside both sides while replacing and removing a confirmed segment', async () => {
		files = [files[0]];
		const prefix = Buffer.concat([
			Buffer.from([0xef, 0xbb, 0xbf, 0xff]),
			Buffer.from('Before\r\n'),
		]);
		const suffix = Buffer.concat([Buffer.from('\r\nAfter'), Buffer.from([0xfe])]);
		await fs.writeFile(
			claude,
			Buffer.concat([prefix, Buffer.from(`${START}\r\nExternal old profile\r\n${END}`), suffix])
		);
		const api = service();
		await api.command({ action: 'set', content: 'Replacement' });
		expect((await applyConfirmed(api)).success).toBe(true);
		expect(await fs.readFile(claude)).toEqual(
			Buffer.concat([prefix, Buffer.from(`${START}\nReplacement\n${END}`), suffix])
		);
		await api.command({ action: 'set', content: '' });
		expect((await api.command({ action: 'apply', content: '' })).success).toBe(true);
		expect(await fs.readFile(claude)).toEqual(Buffer.concat([prefix, suffix]));
	});
	it('does not erase an externally removed block without asking when applying a saved profile', async () => {
		files = [files[0]];
		const api = service();
		await api.command({ action: 'set', content: 'Owned' });
		await applyConfirmed(api);
		await fs.writeFile(claude, 'User replaced the entire file.');
		const result = await api.command({ action: 'apply', content: 'Owned' });
		expect(result.files[0].state).toBe('external-change');
		expect(await fs.readFile(claude, 'utf8')).toBe('User replaced the entire file.');
	});
});

describe('About Me native startup read', () => {
	it.each(['claude-code', 'codex'] as const)('uses the exact shared pointer for %s', (provider) => {
		const filename = provider === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
		expect(aboutMeContract.nativeAboutMePointer(provider)).toBe(
			`The conductor's profile is in your global ${filename}, between the maestro:about-me markers. It is not repeated here and keeps the authority described below.`
		);
	});

	it.each(['claude-code', 'codex'] as const)(
		'only reports %s loaded for a confirmed, current, nonempty managed block',
		async (toolType) => {
			const file = toolType === 'claude-code' ? claude : codex;
			const api = service();
			const request = { action: 'native', agent: { toolType } };
			await api.command({ action: 'set', content: 'Current profile' });
			await fs.writeFile(file, `${START}\nCurrent profile\n${END}`);
			expect(await api.command(request)).toMatchObject({
				success: true,
				native: { loaded: false, provider: toolType, path: file, state: 'unconfirmed' },
			});
			await applyConfirmed(api);
			expect(await api.command(request)).toMatchObject({
				native: { loaded: true, resolvedPath: file, state: 'synced', shadowedBy: [] },
			});
			await api.command({ action: 'set', content: 'Pending profile' });
			expect(await api.command(request)).toMatchObject({
				native: { loaded: false, state: 'pending' },
			});
			await fs.writeFile(file, `${START}\nExternal profile\n${END}`);
			expect(await api.command(request)).toMatchObject({
				native: { loaded: false, state: 'external-change' },
			});
			await api.command({ action: 'set', content: '' });
			await applyConfirmed(api);
			expect(await api.command(request)).toMatchObject({
				native: { loaded: false, state: 'synced' },
			});
		}
	);

	it('checks fresh bytes without discovery, file writes or ownership changes', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'Owned' });
		await applyConfirmed(api);
		const before = structuredClone(values);
		const bytes = await fs.readFile(claude);
		const stat = await fs.stat(claude);
		const getFiles = vi.fn().mockRejectedValue(new Error('must not discover other accounts'));
		const readOnly = createAboutMeService({
			settingsStore: store as never,
			getFiles,
			getAccountDirLayers: () => layers,
		});
		const set = vi.spyOn(store, 'set');
		expect(
			await readOnly.command({ action: 'native', agent: { toolType: 'claude-code' } })
		).toMatchObject({ success: true, files: [], native: { loaded: true } });
		expect(getFiles).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
		expect(values).toEqual(before);
		expect(await fs.readFile(claude)).toEqual(bytes);
		expect((await fs.stat(claude)).mtimeMs).toBe(stat.mtimeMs);
		await fs.writeFile(claude, START);
		expect(
			await readOnly.command({ action: 'native', agent: { toolType: 'claude-code' } })
		).toMatchObject({ native: { loaded: false, state: 'invalid-block' } });
	});

	it('follows live agent env replacement and the canonical account directory layers', async () => {
		const api = service();
		layers = {
			homeDir: root,
			agentLevelEnvVars: { CLAUDE_CONFIG_DIR: path.join(root, 'provider') },
			globalShellEnvVars: { CLAUDE_CONFIG_DIR: path.join(root, 'global') },
			env: { CLAUDE_CONFIG_DIR: path.join(root, 'process') },
		};
		const read = (customEnvVars?: Record<string, string>) =>
			api.command({ action: 'native', agent: { toolType: 'claude-code', customEnvVars } });
		expect(await read({ CLAUDE_CONFIG_DIR: '~/deepseek' })).toMatchObject({
			native: { path: path.join(root, 'deepseek', 'CLAUDE.md'), loaded: false },
		});
		expect(await read()).toMatchObject({
			native: { path: path.join(root, 'provider', 'CLAUDE.md') },
		});
		expect(await read({})).toMatchObject({
			native: { path: path.join(root, 'global', 'CLAUDE.md') },
		});
		expect(await read({ ANTHROPIC_BASE_URL: 'https://synthetic.invalid' })).toMatchObject({
			native: { path: path.join(root, 'global', 'CLAUDE.md') },
		});
		layers.globalShellEnvVars = {};
		expect(await read({})).toMatchObject({
			native: { path: path.join(root, 'process', 'CLAUDE.md') },
		});
		layers.env = {};
		expect(await read({})).toMatchObject({
			native: { path: path.join(root, '.claude', 'CLAUDE.md') },
		});
	});

	it('recognizes ownership through a new alias but refuses a repointed alias', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'Owned' });
		await applyConfirmed(api);
		const alias = path.join(root, 'live-alias');
		const linkType = process.platform === 'win32' ? 'junction' : 'dir';
		await fs.symlink(path.dirname(claude), alias, linkType);
		const request = {
			action: 'native',
			agent: { toolType: 'claude-code', customEnvVars: { CLAUDE_CONFIG_DIR: alias } },
		};
		expect(await api.command(request)).toMatchObject({
			native: { loaded: true, resolvedPath: claude },
		});
		await fs.unlink(alias);
		const other = path.join(root, 'other');
		await fs.mkdir(other);
		await fs.writeFile(path.join(other, 'CLAUDE.md'), `${START}\nOwned\n${END}`);
		await fs.symlink(other, alias, linkType);
		expect(await api.command(request)).toMatchObject({
			native: { loaded: false, state: 'unconfirmed' },
		});
	});

	it('does not report a Codex block loaded while its actual account has an override', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'Owned' });
		await applyConfirmed(api);
		const request = { action: 'native', agent: { toolType: 'codex' } };
		const override = path.join(path.dirname(codex), 'AGENTS.override.md');
		await fs.writeFile(override, 'Override');
		expect(await api.command(request)).toMatchObject({
			native: { loaded: false, state: 'synced', shadowedBy: [override] },
		});
		await fs.writeFile(override, ' \n');
		expect(await api.command(request)).toMatchObject({ native: { loaded: true, shadowedBy: [] } });
		await fs.unlink(override);
		await fs.mkdir(override);
		expect(await api.command(request)).toMatchObject({ native: { loaded: false, state: 'error' } });
	});

	it('keeps SSH, unknown providers, missing directories and unreadable targets unloaded', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'Owned' });
		await applyConfirmed(api);
		for (const agent of [{ toolType: 'claude-code', sshRemote: true }, { toolType: 'other' }]) {
			expect(await api.command({ action: 'native', agent })).toMatchObject({
				native: { loaded: false },
			});
		}
		layers.globalShellEnvVars = { CLAUDE_CONFIG_DIR: path.join(root, 'missing') };
		expect(
			await api.command({ action: 'native', agent: { toolType: 'claude-code' } })
		).toMatchObject({ native: { loaded: false, state: 'missing-directory' } });
		await fs.unlink(claude);
		await fs.mkdir(claude);
		layers.globalShellEnvVars = { CLAUDE_CONFIG_DIR: path.dirname(claude) };
		expect(
			await api.command({ action: 'native', agent: { toolType: 'claude-code' } })
		).toMatchObject({ native: { loaded: false, state: 'error' } });
	});

	it('keeps a file read failure and a host-layer failure unloaded without changing ownership', async () => {
		const api = service();
		await api.command({ action: 'set', content: 'Owned' });
		await applyConfirmed(api);
		const before = structuredClone(values);
		vi.spyOn(fs, 'readFile').mockRejectedValueOnce(
			Object.assign(new Error('synthetic denied'), { code: 'EACCES' })
		);
		expect(
			await api.command({ action: 'native', agent: { toolType: 'claude-code' } })
		).toMatchObject({ native: { loaded: false, state: 'error' } });
		const failingHost = createAboutMeService({
			settingsStore: store as never,
			getFiles: async () => [],
			getAccountDirLayers: () => {
				throw new Error('synthetic store failure');
			},
		});
		expect(
			await failingHost.command({ action: 'native', agent: { toolType: 'codex' } })
		).toMatchObject({ success: false, code: 'file-error', native: { loaded: false } });
		expect(values).toEqual(before);
	});

	it('queues native reads behind an in-flight apply', async () => {
		files = [files[0]];
		const api = service();
		await api.command({ action: 'set', content: 'Ordered' });
		const status = await api.command({ action: 'status' });
		const rename = atomicFs.rename;
		let release!: () => void;
		let entered!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		vi.mocked(atomicFs.rename).mockImplementationOnce(async (...args) => {
			entered();
			await gate;
			return rename(...args);
		});
		const apply = api.command({
			action: 'apply',
			content: status.content,
			confirmations: confirm(status),
		});
		await started;
		const native = api.command({ action: 'native', agent: { toolType: 'claude-code' } });
		release();
		expect((await apply).success).toBe(true);
		expect(await native).toMatchObject({ native: { loaded: true } });
	});

	it.each([
		{ action: 'native' },
		{ action: 'native', agent: null },
		{ action: 'native', agent: { toolType: 42 } },
		{ action: 'native', agent: { toolType: 'codex', customEnvVars: [] } },
		{ action: 'native', agent: { toolType: 'codex', customEnvVars: { CODEX_HOME: 42 } } },
		{ action: 'native', agent: { toolType: 'codex', sshRemote: 'false' } },
	])('rejects invalid native request %j', async (request) => {
		expect(await service().command(request)).toMatchObject({
			success: false,
			code: 'invalid-request',
		});
	});
});

describe('About Me status consumers', () => {
	it('merges agent ids and DeepSeek provenance by actual file without changing providers or ownership', async () => {
		const alias = path.join(root, 'deepseek-alias');
		await fs.symlink(
			path.dirname(claude),
			alias,
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		files = [
			{ path: claude, provider: 'claude-code', agentIds: ['first'] },
			{
				path: path.join(alias, 'CLAUDE.md'),
				provider: 'claude-code',
				agentIds: ['second', 'first'],
				deepseek: true,
			},
		];
		const api = service();
		await api.command({ action: 'set', content: 'Owned' });
		const applied = await applyConfirmed(api);
		expect(applied.files).toHaveLength(1);
		expect(applied.files[0]).toMatchObject({
			agentIds: ['first', 'second'],
			deepseek: true,
			providers: ['claude-code'],
		});
		const status = await api.command({ action: 'status' });
		expect(status.files[0]).toMatchObject({ agentIds: ['first', 'second'], deepseek: true });
		for (const record of Object.values(values.aboutMeApplied as Record<string, object>)) {
			expect(Object.keys(record).sort()).toEqual(['block', 'provider', 'resolvedPath']);
		}
		files = [];
		expect((await api.command({ action: 'status' })).files[0].agentIds).toEqual([]);
	});
});

describe('backend prompt profile selection', () => {
	it('returns the shared pointer only after apply and restores the full profile on uncertainty', async () => {
		const api = service();
		const agent = { toolType: 'claude-code' };
		await api.command({ action: 'set', content: 'Prompt profile' });
		expect(await api.promptProfile(agent)).toBe('Prompt profile');
		await applyConfirmed(api);
		expect(await api.promptProfile(agent)).toBe(
			aboutMeContract.nativeAboutMePointer('claude-code')
		);
		expect(await api.promptProfile({ ...agent, sshRemote: true })).toBe('Prompt profile');
		expect(await api.promptProfile({ toolType: 'unknown' })).toBe('Prompt profile');
		await api.command({ action: 'set', content: 'Pending profile' });
		expect(await api.promptProfile(agent)).toBe('Pending profile');
	});
});
