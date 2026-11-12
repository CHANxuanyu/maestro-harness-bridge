import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { createNativeTempDir } from './temp-root.cjs';
import { LocalSshd, localSshdUnavailableReason } from './local-sshd';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
vi.mock('node:net', () => ({ default: { createServer: vi.fn(), createConnection: vi.fn() } }));

let root: string;
let child: EventEmitter & { pid: number; stderr: PassThrough; exitCode: number | null };
let listener: EventEmitter & {
	listen: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	address: ReturnType<typeof vi.fn>;
};
let socket: EventEmitter & { destroy: ReturnType<typeof vi.fn> };

beforeEach(() => {
	vi.clearAllMocks();
	root = createNativeTempDir('local-sshd-unit-');
	child = Object.assign(new EventEmitter(), {
		pid: 41999,
		stderr: new PassThrough(),
		exitCode: null as number | null,
	});
	listener = Object.assign(new EventEmitter(), {
		listen: vi.fn((_port, _host, ready) => queueMicrotask(ready)),
		close: vi.fn((closed) => closed()),
		address: vi.fn(() => ({ port: 41861 })),
	});
	vi.mocked(net.createServer).mockReturnValue(listener as unknown as net.Server);
	vi.mocked(net.createConnection).mockImplementation(() => {
		socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
		queueMicrotask(() => socket.emit('connect'));
		return socket as unknown as net.Socket;
	});
	vi.mocked(execFileSync).mockImplementation((_command, args) => {
		const key = args![args!.indexOf('-f') + 1];
		fs.writeFileSync(key, 'synthetic private key');
		fs.writeFileSync(`${key}.pub`, 'ssh-ed25519 synthetic-public-key\n');
		return Buffer.alloc(0);
	});
	vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
	vi.spyOn(process, 'kill').mockImplementation(() => {
		child.exitCode = 0;
		queueMicrotask(() => child.emit('close', 0, 'SIGTERM'));
		return true;
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	fs.rmSync(root, { recursive: true, force: true });
});

describe('throwaway loopback sshd', () => {
	it('records exact client arguments and cwd, including spaces and newlines', async () => {
		const server = new LocalSshd(root);
		server.prepare(41861);
		const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
		const args = ['-o', 'Port=41861', 'synthetic@127.0.0.1', "cat '/remote/file with spaces'\n"];
		actual.execFileSync(
			process.execPath,
			[path.join(server.clientBin, 'record.cjs'), server.clientLogFile, ...args],
			{ cwd: root, input: 'stdin script must reach ssh' }
		);
		expect(server.clientInvocations()).toEqual([{ args, cwd: root }]);
	});

	it('reports missing OpenSSH tools before any key generation or server launch', () => {
		vi.spyOn(fs, 'accessSync').mockImplementation(() => {
			throw Object.assign(new Error('missing'), { code: 'ENOENT' });
		});
		expect(localSshdUnavailableReason()).toMatch(/sshd|OpenSSH/);
		expect(execFileSync).not.toHaveBeenCalled();
		expect(spawn).not.toHaveBeenCalled();
	});

	it('keeps both keys, configuration, HOME and client trust in the supplied temp directory', () => {
		const server = new LocalSshd(path.join(root, 'server with spaces'));
		server.prepare(41861);
		expect(execFileSync).toHaveBeenCalledTimes(2);
		for (const [, args, options] of vi.mocked(execFileSync).mock.calls) {
			expect(args).toEqual([
				'-q',
				'-t',
				'ed25519',
				'-N',
				'',
				'-C',
				'maestro-synthetic',
				'-f',
				expect.stringContaining(server.root),
			]);
			expect(options).toMatchObject({
				cwd: server.root,
				env: { HOME: server.home },
				timeout: 10_000,
			});
		}
		expect(fs.readFileSync(path.join(server.root, 'authorized_keys'), 'utf8')).toBe(
			'ssh-ed25519 synthetic-public-key\n'
		);
		const config = fs.readFileSync(server.configFile, 'utf8');
		for (const directive of [
			'ListenAddress 127.0.0.1',
			'Port 41861',
			'UsePAM no',
			'StrictModes no',
			'PasswordAuthentication no',
			'KbdInteractiveAuthentication no',
			'PubkeyAuthentication yes',
			'PermitRootLogin no',
			'PermitUserRC no',
			'LogLevel VERBOSE',
			`HostKey ${JSON.stringify(path.join(server.root, 'host_key'))}`,
			`AuthorizedKeysFile ${JSON.stringify(path.join(server.root, 'authorized_keys'))}`,
			`PidFile ${JSON.stringify(path.join(server.root, 'sshd.pid'))}`,
			`SetEnv ${JSON.stringify(`HOME=${server.home}`)}`,
		])
			expect(config).toContain(directive);
		expect(server.remote).toMatchObject({
			host: '127.0.0.1',
			port: 41861,
			enabled: true,
			privateKeyPath: path.join(server.root, 'client_key'),
			sshOptions: {
				Port: '41861',
				StrictHostKeyChecking: 'no',
				IdentitiesOnly: 'yes',
				IdentityAgent: 'none',
				UserKnownHostsFile: JSON.stringify(path.join(server.root, 'known_hosts')),
			},
		});
		expect(fs.readFileSync(path.join(server.clientBin, 'ssh'), 'utf8')).toContain(
			'exec /usr/bin/ssh -F /dev/null "$@"'
		);
		expect(config).not.toContain('Include');
	});

	it('waits for a loopback connection and stops its process group exactly once', async () => {
		const server = new LocalSshd(root);
		await server.start();
		expect(listener.listen).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function));
		expect(listener.close).toHaveBeenCalledOnce();
		expect(net.createConnection).toHaveBeenCalledWith({ host: '127.0.0.1', port: 41861 });
		expect(socket.destroy).toHaveBeenCalledOnce();
		expect(spawn).toHaveBeenCalledWith(
			'/usr/sbin/sshd',
			['-D', '-e', '-f', server.configFile],
			expect.objectContaining({ detached: true, cwd: root })
		);
		child.stderr.write('Starting session: command for synthetic\n');
		expect(server.log()).toContain('Starting session: command');
		await server.stop();
		const calls = vi.mocked(process.kill).mock.calls.length;
		await server.stop();
		expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
		expect(vi.mocked(process.kill).mock.calls).toHaveLength(calls);
	});

	it('fails with sshd diagnostics and cleans up if startup exits early', async () => {
		vi.mocked(spawn).mockImplementation(() => {
			queueMicrotask(() => {
				child.stderr.write('sshd: bad configuration\n');
				child.exitCode = 255;
				child.emit('close', 255, null);
			});
			return child as unknown as ReturnType<typeof spawn>;
		});
		await expect(new LocalSshd(root).start()).rejects.toThrow(/bad configuration/);
		expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
	});

	it('bounds readiness and escalates teardown when the server does not exit', async () => {
		vi.useFakeTimers();
		vi.mocked(net.createConnection).mockImplementation(() => {
			socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
			return socket as unknown as net.Socket;
		});
		vi.mocked(process.kill).mockImplementation((_pid, signal) => {
			if (signal === 'SIGKILL') child.emit('close', null, signal);
			return true;
		});
		const started = new LocalSshd(root).start();
		const rejected = expect(started).rejects.toThrow(/Timed out.*sshd/);
		await vi.advanceTimersByTimeAsync(13_000);
		await rejected;
		expect(socket.destroy).toHaveBeenCalled();
		expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
		expect(vi.getTimerCount()).toBe(0);
	});
});
