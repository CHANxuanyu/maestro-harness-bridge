import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/native-app';
import {
	nativeAboutMePointer,
	type AboutMeCommand,
	type AboutMeResult,
} from '../src/shared/aboutMe';

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
	const claudeAgent = await native.createAgent('claude');
	const codexAgent = await native.createAgent('codex');
	const nativeRequest = (toolType: 'claude-code' | 'codex'): AboutMeCommand => ({
		action: 'native',
		agent: {
			toolType,
			customEnvVars: { CLAUDE_CONFIG_DIR: native.claude, CODEX_HOME: native.codex },
		},
	});
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
	expect(await command(nativeRequest('claude-code'))).toMatchObject({
		native: { loaded: false, state: 'unconfirmed' },
	});
	expect(status.files.find((file) => file.aliases.includes(claudeFile))?.agentIds).toEqual([
		claudeAgent,
	]);
	expect(status.files.find((file) => file.aliases.includes(codexFile))?.agentIds).toEqual([
		codexAgent,
	]);
	expect(status.files.find((file) => file.deepseek)).toMatchObject({
		providers: ['claude-code'],
		agentIds: [],
		deepseek: true,
	});
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
	for (const provider of ['claude-code', 'codex'] as const)
		expect(await command(nativeRequest(provider))).toMatchObject({
			success: true,
			files: [],
			native: { loaded: true, provider, state: 'synced' },
		});
	const override = path.join(native.codex, 'AGENTS.override.md');
	fs.writeFileSync(override, 'Synthetic override');
	expect(await command(nativeRequest('codex'))).toMatchObject({
		native: { loaded: false, state: 'synced', shadowedBy: [override] },
	});
	fs.unlinkSync(override);
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
	expect(await command(nativeRequest('claude-code'))).toMatchObject({
		native: { loaded: false, state: 'external-change' },
	});
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
	expect(await command(nativeRequest('codex'))).toMatchObject({
		native: { loaded: false, state: 'synced' },
	});
	for (const file of [claudeFile, codexFile]) expect(fs.readFileSync(file)).toEqual(prefix);
	for (const file of cleared.files.filter((file) => ![claudeFile, codexFile].includes(file.path)))
		expect(fs.readFileSync(file.path, 'utf8')).toBe('');
	expect(fs.lstatSync(codexFile).isSymbolicLink()).toBe(true);
});

// The Settings page drives the same service: the full Markdown survives the
// editor, only files the user ticks are written, an edit made after the tick is
// not overwritten, and clearing removes the section. Files only; this does not
// claim a model loaded anything.
test('claude about-me settings: the page keeps long text and writes only approved files', async ({
	native,
}) => {
	test.skip(native.real, 'The page adds no CLI behaviour; claude about-me: covers the transport');
	const home = path.join(native.root, 'synthetic-home');
	for (const dir of ['.claude', '.codex']) fs.mkdirSync(path.join(home, dir), { recursive: true });
	await native.close();
	await native.start(home);
	const { page } = native;
	const claudeFile = path.join(native.claude, 'CLAUDE.md');
	const codexFile = path.join(native.codex, 'AGENTS.md');
	const codexTarget = path.join(native.root, 'user-instructions.md');
	const prefix = Buffer.from('﻿User-owned instructions\r\nNo trailing newline');
	fs.writeFileSync(claudeFile, prefix);
	fs.writeFileSync(codexTarget, prefix);
	fs.symlinkSync(codexTarget, codexFile);
	const block = (content: string) =>
		`<!-- maestro:about-me:start -->\n${content}\n<!-- maestro:about-me:end -->`;
	const long = `${'Synthetic preference line.\n'.repeat(220)}End of the long profile.`;
	expect(long.length).toBeGreaterThan(5000);
	const profileFile = path.join(native.root, 'profile.md');
	fs.writeFileSync(profileFile, long);
	expect((await native.cli('about-me', 'set', '--file', profileFile)).content).toBe(long);

	await page.keyboard.press('ControlOrMeta+,');
	const settings = page.locator('[role="dialog"][aria-label="Settings"]');
	const editor = settings.getByRole('textbox', { name: 'About Me' });
	await expect(editor).toHaveValue(long);
	const edited = `${long}\nEdited in Settings.`;
	await editor.fill(edited);
	await expect(settings.getByTestId('about-me-save-state')).toHaveText('Saved');
	expect((await native.cli('about-me', 'show')).content).toBe(edited);

	const row = (file: string) => settings.getByTestId(`about-me-file-${file}`);
	await expect(row(claudeFile)).toContainText('Needs your OK');
	await expect(row(codexFile)).toContainText(`Real file: ${fs.realpathSync(codexTarget)}`);
	const write = settings.getByTestId('about-me-write');
	await expect(write).toBeDisabled();
	await row(claudeFile)
		.getByRole('checkbox', { name: 'Add an About Me section to this file' })
		.check();
	await expect(write).toHaveText('Write to 1 file');
	await write.click();
	const outcome = settings.getByTestId('about-me-outcome');
	await expect(outcome).toContainText(/^Wrote 1 of \d+ files\./);
	await expect(row(claudeFile)).toContainText('Up to date');
	expect(fs.readFileSync(claudeFile)).toEqual(Buffer.concat([prefix, Buffer.from(block(edited))]));
	expect(fs.readFileSync(codexTarget)).toEqual(prefix);
	expect(fs.lstatSync(codexFile).isSymbolicLink()).toBe(true);
	for (const dir of ['.claude', '.codex']) expect(fs.readdirSync(path.join(home, dir))).toEqual([]);

	// An outside edit needs a new OK, and an edit made after the OK is kept.
	const external = Buffer.concat([prefix, Buffer.from(block('Edited outside Maestro.'))]);
	fs.writeFileSync(claudeFile, external);
	await settings.getByRole('button', { name: 'Check again' }).click();
	await expect(row(claudeFile)).toContainText('Edited outside Maestro');
	const replace = row(claudeFile).getByRole('checkbox', {
		name: 'Replace the section that was edited outside Maestro',
	});
	await replace.check();
	const later = Buffer.concat([prefix, Buffer.from(block('Edited again after the OK.'))]);
	fs.writeFileSync(claudeFile, later);
	await write.click();
	await expect(outcome).toContainText(/^Wrote 0 of \d+ files\./);
	expect(fs.readFileSync(claudeFile)).toEqual(later);
	await expect(replace).not.toBeChecked();
	await replace.check();
	await write.click();
	await expect(outcome).toContainText(/^Wrote 1 of \d+ files\./);
	expect(fs.readFileSync(claudeFile)).toEqual(Buffer.concat([prefix, Buffer.from(block(edited))]));

	// Clearing saves an empty profile; Remove takes the section out again.
	await editor.fill('');
	await expect(settings.getByTestId('about-me-save-state')).toHaveText('Saved');
	await expect(row(claudeFile)).toContainText('Needs update');
	await expect(write).toHaveText('Remove from 1 file');
	await write.click();
	await expect(outcome).toContainText(
		'Removed the section from 1 file. Restart any claude or codex that is already running'
	);
	expect(fs.readFileSync(claudeFile)).toEqual(prefix);
	expect(fs.readFileSync(codexTarget)).toEqual(prefix);
});

// Codex has no system-prompt flag, so Maestro's system prompt is embedded in
// the first user message of the native transcript, where the Codex app shows
// it. Once AGENTS.md holds the profile, that message names the file instead.
test('codex about-me prompt: a synced AGENTS.md replaces the profile in the first message', async ({
	native,
}) => {
	test.skip(native.real, 'Only the prompt Maestro builds is checked; no model reads it here');
	const codexAgent = await native.createAgent('codex');
	const marker = 'Synthetic profile marker 4817: answer in haiku.';
	const profileFile = path.join(native.root, 'profile.md');
	fs.writeFileSync(profileFile, marker);
	expect((await native.cli('about-me', 'set', '--file', profileFile)).content).toBe(marker);
	const status = (await native.cli('about-me', 'status')) as AboutMeResult;
	const agentsFile = status.files.find((file) => file.agentIds.includes(codexAgent))!;
	expect(agentsFile.path).toBe(path.join(native.codex, 'AGENTS.md'));
	// Only this file is approved; the CLI would exit 1 for the others it leaves.
	const applied = await native.page.evaluate(
		(request) => window.maestro.settings.aboutMe(request),
		{
			action: 'apply',
			content: marker,
			confirmations: [
				{ path: agentsFile.path, resolvedPath: agentsFile.resolvedPath!, block: null },
			],
		} as AboutMeCommand
	);
	expect(applied.files.find((file) => file.path === agentsFile.path)).toMatchObject({
		state: 'synced',
	});

	native.scriptTurns([{ answer: 'Prompt check answer.' }]);
	await native.send('Prompt check question.');
	await expect(native.output().getByText('Prompt check answer.', { exact: true })).toBeVisible();
	const transcript = fs.readFileSync(await native.oneTranscript('codex'), 'utf8');
	// The system prompt is there, so the absence of the profile is meaningful.
	expect(transcript).toContain('## Conductor Profile');
	expect(transcript).toContain(nativeAboutMePointer('codex'));
	expect(transcript).not.toContain('answer in haiku');
});
