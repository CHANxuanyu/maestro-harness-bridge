import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/native-app';
import type { AboutMeCommand, AboutMeResult } from '../src/shared/aboutMe';

// Native file locations follow the official memory / AGENTS.md documentation
// cited in native-instructions.ts. This checks writes and consent only, never
// pretends a fixture proved that a real model loaded the instructions.
test('claude about-me: IPC and CLI preserve native files until explicit consent', async ({
	native,
}) => {
	const home = path.join(native.root, 'synthetic-home');
	for (const dir of ['.claude', '.codex']) fs.mkdirSync(path.join(home, dir), { recursive: true });
	await native.close();
	await native.start(home);
	const command = (request: AboutMeCommand): Promise<AboutMeResult> =>
		native.page.evaluate((value) => window.maestro.settings.aboutMe(value), request);
	const root = fs.realpathSync(native.root);
	const globalAccount = path.join(native.root, 'global-claude');
	fs.mkdirSync(globalAccount);
	await native.page.evaluate(
		(dir) => window.maestro.settings.set('shellEnvVars', { CLAUDE_CONFIG_DIR: dir }),
		globalAccount
	);
	const claudeFile = path.join(native.claude, 'CLAUDE.md');
	const codexFile = path.join(native.codex, 'AGENTS.md');
	const codexTarget = path.join(native.root, 'user-instructions.md');
	const prefix = Buffer.from('\ufeffUser-owned instructions\r\nNo trailing newline');
	fs.writeFileSync(claudeFile, prefix);
	fs.writeFileSync(codexTarget, prefix);
	fs.symlinkSync(codexTarget, codexFile);
	const preset = await native.page.evaluate(() =>
		window.maestro.agents.prepareDeepSeekPreset({ apiKey: 'synthetic-not-used' })
	);
	const profileFile = path.join(native.root, 'profile.md');
	const profile = 'Synthetic preference: concise answers.\n测试偏好';
	fs.writeFileSync(profileFile, profile);
	expect(await native.cli('about-me', 'set', '--file', profileFile)).toMatchObject({
		success: true,
		content: profile,
	});
	expect(await command({ action: 'show' })).toMatchObject({ success: true, content: profile });
	const status = (await native.cli('about-me', 'status')) as AboutMeResult;
	expect(status.files).toHaveLength(6);
	for (const file of status.files) {
		expect(file.resolvedPath!.startsWith(root + path.sep)).toBe(true);
		expect(file.state).toBe('unconfirmed');
	}
	expect(
		status.files.some((file) =>
			file.aliases.includes(path.join(preset.customEnvVars.CLAUDE_CONFIG_DIR, 'CLAUDE.md'))
		)
	).toBe(true);
	const refused = await command({ action: 'apply', content: profile });
	expect(refused).toMatchObject({ success: false, code: 'confirmation-required', written: [] });
	for (const file of [claudeFile, codexFile]) expect(fs.readFileSync(file)).toEqual(prefix);
	for (const file of status.files.filter((file) => ![claudeFile, codexFile].includes(file.path)))
		expect(fs.existsSync(file.path)).toBe(false);
	const applied = (await native.cli(
		'about-me',
		'apply',
		...status.files.flatMap((file) => ['--confirm', file.resolvedPath!])
	)) as AboutMeResult;
	expect(applied.success).toBe(true);
	expect(applied.written).toHaveLength(6);
	for (const file of [claudeFile, codexFile]) {
		const bytes = fs.readFileSync(file);
		expect(bytes.subarray(0, prefix.length)).toEqual(prefix);
		expect(bytes.subarray(prefix.length).toString()).toBe(
			`<!-- maestro:about-me:start -->\n${profile}\n<!-- maestro:about-me:end -->`
		);
	}
	expect(fs.lstatSync(codexFile).isSymbolicLink()).toBe(true);
	await native.close();
	await native.start(home);
	expect((await command({ action: 'status' })).files.every((file) => file.state === 'synced')).toBe(
		true
	);
	const external = Buffer.concat([
		prefix,
		Buffer.from(
			'<!-- maestro:about-me:start -->\nExternal preference\n<!-- maestro:about-me:end -->'
		),
	]);
	fs.writeFileSync(claudeFile, external);
	const blocked = await command({ action: 'apply', content: profile });
	expect(blocked.success).toBe(false);
	expect(blocked.files.find((file) => file.aliases.includes(claudeFile))!.state).toBe(
		'external-change'
	);
	expect(fs.readFileSync(claudeFile)).toEqual(external);
	expect(
		(await native.cli('about-me', 'apply', '--confirm', fs.realpathSync(claudeFile))).success
	).toBe(true);
	expect((await native.cli('about-me', 'set', '--clear')).content).toBe('');
	const cleared = await command({ action: 'apply', content: '' });
	expect(cleared.success).toBe(true);
	for (const file of [claudeFile, codexFile]) expect(fs.readFileSync(file)).toEqual(prefix);
	for (const file of cleared.files.filter((file) => ![claudeFile, codexFile].includes(file.path)))
		expect(fs.readFileSync(file.path, 'utf8')).toBe('');
	expect(fs.lstatSync(codexFile).isSymbolicLink()).toBe(true);
});
