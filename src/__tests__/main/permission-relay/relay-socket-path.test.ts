import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionRelayServer } from '../../../main/permission-relay/PermissionRelayServer';

// The server reads os.tmpdir() through a namespace import, so mock the module.
const temp = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('os', async (importOriginal) => {
	const actual = await importOriginal<typeof import('os')>();
	const tmpdir = () => temp.dir ?? actual.tmpdir();
	return { ...actual, tmpdir, default: { ...actual, tmpdir } };
});

vi.mock('net', () => ({
	createServer: () => ({
		once: vi.fn(),
		removeListener: vi.fn(),
		listen: (_path: string, ready: () => void) => ready(),
		close: vi.fn(),
	}),
}));
vi.mock('fs', () => ({ unlinkSync: vi.fn(), chmodSync: vi.fn() }));
vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// A user data path past the unix socket limit forces the tmpdir fallback.
const longUserData = path.join(path.resolve('/'), 'u'.repeat(120), 'Maestro I18n');

describe('permission relay socket path', () => {
	afterEach(() => {
		temp.dir = undefined;
	});

	it('stays absolute when TMPDIR is relative, so a bridge in another cwd can reach it', async () => {
		temp.dir = '.';
		const socket = await new PermissionRelayServer().ensureStarted(longUserData);
		if (process.platform === 'win32') {
			expect(socket).toBe(`\\\\.\\pipe\\maestro-permission-relay-${process.pid}`);
			return;
		}
		expect(path.isAbsolute(socket)).toBe(true);
		expect(socket.length).toBeLessThanOrEqual(100);
		expect(path.basename(socket)).toBe(`maestro-relay-${process.pid}.sock`);
	});

	it('falls back to /tmp when an absolute TMPDIR is itself too long for a socket', async () => {
		temp.dir = path.join('/private/var', 't'.repeat(100));
		const socket = await new PermissionRelayServer().ensureStarted(longUserData);
		if (process.platform === 'win32') return;
		expect(socket).toBe(`/tmp/maestro-relay-${process.pid}.sock`);
	});

	it('keeps the user data socket when that path fits', async () => {
		const socket = await new PermissionRelayServer().ensureStarted('/Users/someone/Maestro');
		if (process.platform === 'win32') return;
		expect(socket).toBe('/Users/someone/Maestro/permission-relay.sock');
	});
});
