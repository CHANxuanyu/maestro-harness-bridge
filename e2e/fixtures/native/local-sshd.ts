import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import type { SshRemoteConfig } from '../../../src/shared/types';
import { shellEscape } from '../../../src/main/utils/shell-escape';

/** Call before constructing NativeApp. Missing tools are a Playwright skip, not a failure. */
export function localSshdUnavailableReason(): string | undefined {
	if (process.platform !== 'darwin' && process.platform !== 'linux')
		return 'Loopback OpenSSH acceptance requires macOS or Linux';
	for (const binary of ['/usr/sbin/sshd', '/usr/bin/ssh-keygen', '/usr/bin/ssh']) {
		try {
			fs.accessSync(binary, fs.constants.X_OK);
		} catch {
			return `Loopback OpenSSH acceptance requires executable ${binary}`;
		}
	}
	if (os.userInfo().uid === 0)
		return 'Loopback OpenSSH acceptance requires a non-root user (PermitRootLogin no)';
	return undefined;
}

/** Owns only files beneath the caller's native temp directory and its own process group. */
export class LocalSshd {
	readonly home: string;
	readonly clientBin: string;
	readonly configFile: string;
	readonly logFile: string;
	readonly clientLogFile: string;
	remote!: SshRemoteConfig;
	private child?: ChildProcess;
	private closed?: Promise<void>;
	private failure?: Error;
	private stopping?: Promise<void>;

	constructor(readonly root: string) {
		this.home = path.join(root, 'home');
		this.clientBin = path.join(root, 'client-bin');
		this.configFile = path.join(root, 'sshd_config');
		this.logFile = path.join(root, 'sshd.log');
		this.clientLogFile = path.join(root, 'client-invocations.jsonl');
	}

	prepare(port: number) {
		for (const dir of [this.root, this.home, this.clientBin])
			fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		const env = { HOME: this.home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
		for (const name of ['host_key', 'client_key']) {
			execFileSync(
				'/usr/bin/ssh-keygen',
				[
					'-q',
					'-t',
					'ed25519',
					'-N',
					'',
					'-C',
					'maestro-synthetic',
					'-f',
					path.join(this.root, name),
				],
				{ cwd: this.root, env, timeout: 10_000, stdio: 'pipe' }
			);
		}
		fs.copyFileSync(
			path.join(this.root, 'client_key.pub'),
			path.join(this.root, 'authorized_keys')
		);
		// OpenSSH resolves its config via passwd, not HOME. Never consult the real ~/.ssh.
		const recorder = path.join(this.clientBin, 'record.cjs');
		fs.writeFileSync(this.clientLogFile, '');
		fs.writeFileSync(
			recorder,
			[
				"const fs = require('node:fs');",
				"fs.appendFileSync(process.argv[2], JSON.stringify({ args: process.argv.slice(3), cwd: process.cwd() }) + '\\n');",
				'',
			].join('\n')
		);
		fs.writeFileSync(
			path.join(this.clientBin, 'ssh'),
			[
				'#!/bin/sh',
				// The recorder never reads stdin: the app's remote script passes through intact.
				`${shellEscape(process.execPath)} ${shellEscape(recorder)} ${shellEscape(this.clientLogFile)} "$@" || exit $?`,
				'exec /usr/bin/ssh -F /dev/null "$@"',
				'',
			].join('\n'),
			{ mode: 0o700 }
		);
		const username = os.userInfo().username;
		fs.writeFileSync(
			this.configFile,
			[
				'ListenAddress 127.0.0.1',
				`Port ${port}`,
				`HostKey ${JSON.stringify(path.join(this.root, 'host_key'))}`,
				`AuthorizedKeysFile ${JSON.stringify(path.join(this.root, 'authorized_keys'))}`,
				`PidFile ${JSON.stringify(path.join(this.root, 'sshd.pid'))}`,
				'UsePAM no',
				'StrictModes no',
				'PasswordAuthentication no',
				'KbdInteractiveAuthentication no',
				'PubkeyAuthentication yes',
				'PermitRootLogin no',
				`AllowUsers ${username}`,
				'LogLevel VERBOSE',
				'PermitUserRC no',
				'PermitUserEnvironment no',
				'PrintMotd no',
				'PrintLastLog no',
				'UseDNS no',
				// Set before the user's command shell starts, including non-interactive zsh.
				`SetEnv ${JSON.stringify(`HOME=${this.home}`)} ${JSON.stringify(`ZDOTDIR=${this.home}`)} BASH_ENV=/dev/null ENV=/dev/null SHELL=/bin/bash`,
				'',
			].join('\n')
		);
		this.remote = {
			id: 'synthetic-loopback-sshd',
			name: 'Synthetic loopback sshd',
			host: '127.0.0.1',
			port,
			username,
			privateKeyPath: path.join(this.root, 'client_key'),
			enabled: true,
			sshOptions: {
				Port: String(port),
				StrictHostKeyChecking: 'no',
				UserKnownHostsFile: JSON.stringify(path.join(this.root, 'known_hosts')),
				GlobalKnownHostsFile: '/dev/null',
				IdentitiesOnly: 'yes',
				IdentityAgent: 'none',
			},
		};
	}

	async start() {
		// Reserve an OS-assigned port and release it immediately before sshd binds.
		const port = await new Promise<number>((resolve, reject) => {
			const listener = net.createServer();
			listener.once('error', reject);
			listener.listen(0, '127.0.0.1', () => {
				const address = listener.address() as net.AddressInfo;
				listener.close((error) => (error ? reject(error) : resolve(address.port)));
			});
		});
		this.prepare(port);
		fs.writeFileSync(this.logFile, '');
		this.child = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', this.configFile], {
			cwd: this.root,
			env: { HOME: this.home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
			detached: true,
			stdio: ['ignore', 'ignore', 'pipe'],
		});
		this.closed = new Promise((resolve) => this.child!.once('close', () => resolve()));
		this.child.once('error', (error) => {
			this.failure = error;
		});
		this.child.once('close', (code, signal) => {
			this.failure ??= new Error(`sshd exited: ${code ?? signal}`);
		});
		this.child.stderr!.on('data', (chunk: Buffer) => fs.appendFileSync(this.logFile, chunk));
		try {
			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline) {
				if (this.failure) throw this.failure;
				const connected = await new Promise<boolean>((resolve) => {
					const socket = net.createConnection({ host: '127.0.0.1', port });
					const finish = (ready: boolean) => {
						clearTimeout(timer);
						socket.destroy();
						resolve(ready);
					};
					const timer = setTimeout(() => finish(false), 200);
					socket.once('connect', () => finish(true));
					socket.once('error', () => finish(false));
				});
				if (this.failure) throw this.failure;
				if (connected) return;
				await new Promise<void>((resolve) => setTimeout(resolve, 50));
			}
			throw new Error('Timed out waiting for loopback sshd');
		} catch (error) {
			await this.stop();
			throw new Error(`${String(error)}\n${this.log()}`, { cause: error });
		}
	}

	log(): string {
		return fs.existsSync(this.logFile) ? fs.readFileSync(this.logFile, 'utf8') : '';
	}

	clientInvocations(): Array<{ args: string[]; cwd: string }> {
		return fs
			.readFileSync(this.clientLogFile, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	}

	stop(): Promise<void> {
		return (this.stopping ??= this.stopGroup());
	}

	private async stopGroup() {
		const pid = this.child?.pid;
		if (!pid) return;
		const kill = (signal: NodeJS.Signals) => {
			try {
				process.kill(-pid, signal);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
			}
		};
		kill('SIGTERM');
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.closed,
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, 2_000);
				}),
			]);
		} finally {
			clearTimeout(timer);
			// The listener may have exited while one of its sessions still lives.
			kill('SIGKILL');
			await this.closed;
		}
	}
}
