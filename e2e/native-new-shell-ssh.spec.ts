import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';
import { LocalSshd, localSshdUnavailableReason } from './fixtures/native/local-sshd';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import type { Session } from '../src/renderer/types';

// Skip before NativeApp construction: real mode must never inspect credentials.
test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'SSH new shell acceptance uses synthetic providers only'
);
test.setTimeout(180_000);

// eslint-disable-next-line no-empty-pattern
test('new shell SSH: changes, files, terminal, handoff and localhost preview', async ({}, info) => {
	const unavailable = localSshdUnavailableReason();
	test.skip(!!unavailable, unavailable);
	const native = new NativeApp(info, { providerCli: false });
	const sshd = new LocalSshd(path.join(native.root, 'sshd'));
	const remoteProject = path.join(native.root, 'remote-project');
	const remoteClaude = path.join(native.root, 'remote-claude');
	const remoteCodex = path.join(native.root, 'remote-codex');
	const fixtures = path.resolve('e2e/fixtures/native');
	const baseline = 'export const shipping = 12;\n';
	const changed = 'export const shipping = 0;\nexport const threshold = 80;\n';
	const edited = changed.replace('80', '100');
	const localSentinel = 'Local project must remain untouched.\n';
	const claudeGate = path.join(native.root, 'claude-exit');
	const codexGate = path.join(native.root, 'codex-exit');
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	const saved = (): Session[] =>
		JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')).sessions;
	const scene = (value: NativeScene) =>
		fs.writeFileSync(native.script, JSON.stringify({ scene: value }));
	const remoteCommandsSince = (index: number) =>
		sshd
			.clientInvocations()
			.slice(index)
			.map(({ args }) => args.at(-1) ?? '');
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
			cwd: remoteProject,
			env: {
				PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin`,
				HOME: native.syntheticHome,
				GIT_CONFIG_NOSYSTEM: '1',
				GIT_CONFIG_GLOBAL: '/dev/null',
			},
			encoding: 'utf8',
		});
	const web = http.createServer((_request, response) => response.end('Synthetic local preview'));
	let failed = true;
	try {
		for (const dir of [remoteProject, remoteClaude, remoteCodex]) fs.mkdirSync(dir);
		fs.writeFileSync(path.join(native.project, 'cart.ts'), localSentinel);
		git('init', '-b', 'main');
		git('config', 'user.name', 'Synthetic SSH');
		git('config', 'user.email', 'ssh@example.invalid');
		git('config', 'commit.gpgsign', 'false');
		fs.writeFileSync(path.join(remoteProject, 'cart.ts'), baseline);
		git('add', '.');
		git('commit', '-m', 'Synthetic SSH baseline');
		await sshd.start();
		await new Promise<void>((resolve, reject) => {
			web.once('error', reject);
			web.listen(0, '127.0.0.1', resolve);
		});
		const webPort = (web.address() as { port: number }).port;
		// Same sshRemotes store shape written by create-ssh-remote. Keep provider
		// account env on the remote, separate from NativeApp's local account dirs.
		const remote = {
			...sshd.remote,
			remoteEnv: {
				PATH: `${fixtures}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin`,
				HOME: sshd.home,
				MAESTRO_NATIVE_SCRIPT: native.script,
				CLAUDE_CONFIG_DIR: remoteClaude,
				CODEX_HOME: remoteCodex,
				GIT_CONFIG_NOSYSTEM: '1',
				GIT_CONFIG_GLOBAL: '/dev/null',
			},
		};
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				newShell: true,
				rightPanelOpen: true,
				defaultSaveToHistory: false,
				crashReportingEnabled: false,
				sshRemotes: [remote],
			})
		);
		// Detection uses these local fixture paths. The remote spawn uses the
		// binaryName unless a session explicitly supplies its own customPath.
		fs.writeFileSync(
			path.join(native.data, 'maestro-agent-configs.json'),
			JSON.stringify({
				configs: {
					'claude-code': { customPath: path.join(fixtures, 'claude') },
					codex: { customPath: path.join(fixtures, 'codex') },
				},
			})
		);
		const source = createMockSession({
			id: 'ssh-claude',
			name: 'Synthetic SSH project',
			cwd: remoteProject,
			fullPath: remoteProject,
			projectRoot: remoteProject,
			isGitRepo: true,
			enableMaestroP: false,
			sessionSshRemoteConfig: {
				enabled: true,
				remoteId: remote.id,
				workingDirOverride: remoteProject,
			},
			activeTabId: 'ssh-source',
			aiTabs: [
				createMockAITab({
					id: 'ssh-source',
					name: 'SSH implementation',
					logs: [],
					permissionMode: 'full',
					readOnlyMode: false,
					newShellPanel: { tab: 'changes', open: true },
				}),
			],
			unifiedTabOrder: [{ type: 'ai', id: 'ssh-source' }],
		});
		fs.writeFileSync(
			path.join(native.data, 'maestro-sessions.json'),
			JSON.stringify({ sessions: [source], activeSessionId: source.id })
		);
		// Include all expanded system PATH entries so buildExpandedPath does not
		// prepend a system ssh ahead of the fixture's -F /dev/null client wrapper.
		const localPath = [
			sshd.clientBin,
			fixtures,
			path.dirname(process.execPath),
			'/opt/homebrew/bin',
			'/opt/homebrew/sbin',
			'/usr/local/bin',
			'/usr/local/sbin',
			'/home/linuxbrew/.linuxbrew/bin',
			'/usr/bin',
			'/bin',
			'/usr/sbin',
			'/sbin',
		].join(':');
		await native.start(undefined, {
			PATH: localPath,
			SHELL: '/bin/bash',
			NVM_DIR: path.join(native.syntheticHome, '.nvm'),
			FNM_DIR: path.join(native.syntheticHome, '.fnm'),
			ZDOTDIR: native.syntheticHome,
		});
		await native.page.locator('[data-conversation-key$=":ssh-source"] [data-tree-nav]').click();
		// This also verifies that project settings address the remote host scope.
		expect(
			await native.cli(
				'project',
				'settings',
				'set',
				'--path',
				remoteProject,
				'--ssh-remote',
				remote.id,
				'--provider',
				'claude-code'
			)
		).toMatchObject({ success: true });

		const verifyRemoteTurn = async (
			provider: 'claude' | 'codex',
			ownerId: string,
			gate: string
		) => {
			const home = provider === 'claude' ? remoteClaude : remoteCodex;
			const record = path.join(home, 'fixture-invocations.jsonl');
			await expect.poll(() => fs.existsSync(record)).toBe(true);
			const invocations = fs
				.readFileSync(record, 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			expect(invocations).toHaveLength(1);
			expect(invocations[0]).toMatchObject({
				provider,
				cwd: remoteProject,
				processCwd: remoteProject,
			});
			expect(invocations[0].sshConnection).toMatch(
				new RegExp(`^127\\.0\\.0\\.1 \\d+ 127\\.0\\.0\\.1 ${remote.port}$`)
			);
			const active = await native.page.evaluate(() =>
				window.maestro.process.getActiveProcesses({ includeChildProcesses: false })
			);
			const agent = active.find(
				(process) =>
					process.sessionId.startsWith(ownerId) &&
					process.toolType === (provider === 'claude' ? 'claude-code' : 'codex')
			);
			expect(agent).toBeDefined();
			for (const process of active) {
				expect(process.cwd).not.toBe(native.project);
				if (!process.isTerminal) expect(process.command).toBe(path.join(sshd.clientBin, 'ssh'));
			}
			expect(agent!.args).toContain(`${remote.username}@127.0.0.1`);
			expect(agent!.args).toContain(`Port=${remote.port}`);
			expect(sshd.log()).toContain('Accepted publickey');
			expect(sshd.log()).toContain('Starting session: command');
			fs.writeFileSync(gate, 'release');
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		};

		await test.step('A9: Claude writes over SSH; changes, diff, stage and unstage use the remote repo', async () => {
			const beforeTurn = sshd.clientInvocations().length;
			scene({
				answer: 'SSH implementation finished. See [cart.ts](cart.ts:2).',
				writes: { 'cart.ts': changed },
				exitGate: claudeGate,
			});
			await native.send('Implement shipping in the SSH project.');
			await expect(native.output()).toContainText('SSH implementation finished.');
			await verifyRemoteTurn('claude', source.id, claudeGate);
			expect(fs.readFileSync(path.join(remoteProject, 'cart.ts'), 'utf8')).toBe(changed);
			await native.page.locator('[data-tour="changes-tab"]').click();
			await expect(native.page.getByTestId('changes-summary')).toHaveText('1 file changed +2 -1');
			expect(
				remoteCommandsSince(beforeTurn).some(
					(command) => command.includes(remoteProject) && command.includes('--numstat')
				)
			).toBe(true);
			const panel = native.page.getByTestId('changes-panel');
			const beforeDiff = sshd.clientInvocations().length;
			await panel.getByRole('button', { name: 'Diff cart.ts', exact: true }).click();
			await expect(panel.locator('.diff')).toContainText('export const shipping = 12;');
			await expect(panel.locator('.diff')).toContainText('export const threshold = 80;');
			expect(
				remoteCommandsSince(beforeDiff).some(
					(command) =>
						command.includes(remoteProject) &&
						command.includes('cart.ts') &&
						/\bdiff\b/.test(command)
				)
			).toBe(true);
			const beforeStage = sshd.clientInvocations().length;
			await panel.getByRole('button', { name: 'Stage cart.ts', exact: true }).click();
			await expect(
				panel.getByRole('button', { name: 'Unstage cart.ts', exact: true })
			).toBeVisible();
			expect(git('diff', '--cached', '--numstat').trim()).toBe('2\t1\tcart.ts');
			expect(
				remoteCommandsSince(beforeStage).some(
					(command) =>
						command.includes(remoteProject) &&
						command.includes('cart.ts') &&
						/\badd\b/.test(command)
				)
			).toBe(true);
			const beforeUnstage = sshd.clientInvocations().length;
			await panel.getByRole('button', { name: 'Unstage cart.ts', exact: true }).click();
			await expect(panel.getByRole('button', { name: 'Stage cart.ts', exact: true })).toBeVisible();
			expect(git('diff', '--cached').trim()).toBe('');
			expect(git('diff', '--numstat').trim()).toBe('2\t1\tcart.ts');
			expect(
				remoteCommandsSince(beforeUnstage).some(
					(command) =>
						command.includes(remoteProject) &&
						command.includes('cart.ts') &&
						/\breset\b/.test(command)
				)
			).toBe(true);
		});

		await test.step('A10: file names and transcript line links open Files; save edits remotely', async () => {
			const beforeRead = sshd.clientInvocations().length;
			await native.page
				.getByTestId('changes-list')
				.getByRole('button', { name: 'cart.ts', exact: true })
				.click();
			const files = native.page.locator('[data-tour="files-panel"]');
			await expect(files).toContainText('export const threshold = 80;');
			expect(
				remoteCommandsSince(beforeRead).some(
					(command) =>
						command.includes(path.join(remoteProject, 'cart.ts')) && /\bcat\b/.test(command)
				)
			).toBe(true);
			// A transcript link jumps to its line in the preview; Edit opens the editor.
			await native.output().getByText('cart.ts', { exact: true }).click();
			await expect(files).toContainText('export const threshold = 80;');
			await files.getByTitle('Edit', { exact: true }).click();
			const editor = files.locator('.cm-content[contenteditable="true"]');
			await expect(editor).toBeVisible();
			await editor.click();
			await expect(editor.locator('.cm-line').nth(1)).toHaveText('export const threshold = 80;');
			await editor.fill(edited);
			const beforeSave = sshd.clientInvocations().length;
			await files.getByTitle('Save', { exact: true }).click();
			await expect
				.poll(() => fs.readFileSync(path.join(remoteProject, 'cart.ts'), 'utf8'))
				.toBe(edited);
			expect(
				remoteCommandsSince(beforeSave).some(
					(command) =>
						command.includes(path.join(remoteProject, 'cart.ts')) && command.includes('base64 -d >')
				)
			).toBe(true);
			expect(fs.readFileSync(path.join(native.project, 'cart.ts'), 'utf8')).toBe(localSentinel);
		});

		await test.step('B1: the terminal has the remote cwd and an SSH connection', async () => {
			const beforeTerminal = sshd.clientInvocations().length;
			await native.page.locator('[data-tour="terminal-tab"]').click();
			const input = native.page
				.getByTestId('terminal-panel')
				.locator('.xterm-helper-textarea')
				.first();
			await expect(input).toBeVisible();
			await input.focus();
			await input.pressSequentially('pwd; echo "$SSH_CONNECTION"');
			await input.press('Enter');
			// The right panel terminal is narrow, so long output wraps across screen
			// rows. Read the screen as one string without the row breaks.
			const screen = async () =>
				((await native.cli('read-terminal', '--agent', source.id)).lines as string[]).join('');
			await expect.poll(screen).toContain(remoteProject);
			await expect
				.poll(screen)
				.toMatch(new RegExp(`127\\.0\\.0\\.1 \\d+ 127\\.0\\.0\\.1 ${remote.port}`));
			expect(
				sshd
					.clientInvocations()
					.slice(beforeTerminal)
					.some(
						({ args }) =>
							args.includes('-t') &&
							args.includes(`${remote.username}@127.0.0.1`) &&
							args.at(-1)?.includes(remoteProject)
					)
			).toBe(true);
		});

		await test.step('A13: header handoff creates Codex on the same host and cwd, then sends over SSH', async () => {
			await native.page.getByTestId('header-handoff').click();
			const dialog = native.page.getByTestId('ai-handoff-modal');
			await dialog.getByRole('radio', { name: /^Codex/ }).check();
			await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
			await expect(dialog).toHaveCount(0);
			await expect(native.input()).toHaveValue(/SSH implementation finished/);
			await expect
				.poll(() => saved().filter((session) => session.toolType === 'codex').length)
				.toBe(1);
			const target = saved().find((session) => session.toolType === 'codex')!;
			expect(target.cwd).toBe(remoteProject);
			expect(target.sessionSshRemoteConfig).toMatchObject({
				enabled: true,
				remoteId: remote.id,
				workingDirOverride: remoteProject,
			});
			expect(native.files('codex', remoteCodex)).toEqual([]);
			const beforeSessions = (sshd.log().match(/Starting session: command/g) ?? []).length;
			scene({ answer: 'Codex continued over SSH.', exitGate: codexGate });
			await native.input().press('Enter');
			await expect(native.output()).toContainText('Codex continued over SSH.');
			await verifyRemoteTurn('codex', target.id, codexGate);
			expect((sshd.log().match(/Starting session: command/g) ?? []).length).toBeGreaterThan(
				beforeSessions
			);
			const transcript = await native.oneTranscript('codex', remoteCodex);
			expect(fs.readFileSync(transcript, 'utf8')).toContain('Codex continued over SSH.');
			expect(fs.readFileSync(transcript, 'utf8')).toContain(remoteProject);
		});

		await test.step('B3: localhost preview notice when implemented on this branch', async () => {
			const panel = native.page.locator('[data-panel="right"]');
			await panel.getByRole('button', { name: 'Web', exact: true }).click();
			const url = panel.getByRole('textbox', { name: 'Browser URL' });
			await url.fill(`http://localhost:${webPort}`);
			await url.press('Enter');
			// TODO(web-preview-local-notice): another branch adds this notice. Check
			// source support so a missing rendered notice cannot silently pass there.
			if (
				fs
					.readFileSync(path.resolve('src/renderer/components/NewShellWebPanel.tsx'), 'utf8')
					.includes('web-preview-local-notice')
			) {
				await expect(native.page.getByTestId('web-preview-local-notice')).toBeVisible();
			}
		});
		for (const home of [native.claude, native.codex])
			expect(fs.existsSync(path.join(home, 'fixture-invocations.jsonl'))).toBe(false);
		expect(native.files('claude')).toEqual([]);
		expect(native.files('codex')).toEqual([]);
		expect(fs.readFileSync(path.join(native.project, 'cart.ts'), 'utf8')).toBe(localSentinel);
		failed = false;
	} finally {
		try {
			// Release held synthetic writers even when an assertion fails, before closing SSH clients.
			for (const gate of [claudeGate, codexGate]) fs.writeFileSync(gate, 'release');
			if (native.app) await native.close(failed);
		} finally {
			try {
				await sshd.stop();
				if (failed && fs.existsSync(sshd.logFile))
					await info.attach('synthetic-sshd', { path: sshd.logFile, contentType: 'text/plain' });
				if (failed && fs.existsSync(sshd.clientLogFile))
					await info.attach('synthetic-ssh-client', {
						path: sshd.clientLogFile,
						contentType: 'text/plain',
					});
			} finally {
				web.closeAllConnections();
				if (web.listening)
					await new Promise<void>((resolve, reject) =>
						web.close((error) => (error ? reject(error) : resolve()))
					);
				fs.rmSync(native.root, { recursive: true, force: true });
			}
		}
	}
});
