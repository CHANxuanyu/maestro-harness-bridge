/**
 * Tests for deep link URL parsing and protocol setup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { app, type BrowserWindow } from 'electron';

// Mock electron before importing the module under test
vi.mock('electron', () => ({
	app: {
		isPackaged: false,
		setAsDefaultProtocolClient: vi.fn(),
		requestSingleInstanceLock: vi.fn().mockReturnValue(true),
		on: vi.fn(),
		quit: vi.fn(),
	},
	BrowserWindow: {
		getAllWindows: vi.fn().mockReturnValue([]),
	},
}));

vi.mock('../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../main/utils/safe-send', () => ({
	isWebContentsAvailable: vi.fn().mockReturnValue(true),
}));

import { parseDeepLink, setupDeepLinkHandling, flushPendingDeepLink } from '../../main/deep-links';

describe('parseDeepLink', () => {
	describe('focus action', () => {
		it('should parse maestro://focus', () => {
			expect(parseDeepLink('maestro://focus')).toEqual({ action: 'focus' });
		});

		it('should parse empty path as focus', () => {
			expect(parseDeepLink('maestro://')).toEqual({ action: 'focus' });
		});

		it('should parse protocol-only as focus', () => {
			expect(parseDeepLink('maestro:')).toEqual({ action: 'focus' });
		});
	});

	describe('session action', () => {
		it('should parse session URL', () => {
			expect(parseDeepLink('maestro://session/abc123')).toEqual({
				action: 'session',
				sessionId: 'abc123',
			});
		});

		it('should parse session URL with tab', () => {
			expect(parseDeepLink('maestro://session/abc123/tab/tab456')).toEqual({
				action: 'session',
				sessionId: 'abc123',
				tabId: 'tab456',
			});
		});

		it('should decode URI-encoded session IDs', () => {
			expect(parseDeepLink('maestro://session/session%20with%20space')).toEqual({
				action: 'session',
				sessionId: 'session with space',
			});
		});

		it('should decode URI-encoded tab IDs', () => {
			expect(parseDeepLink('maestro://session/abc/tab/tab%2Fslash')).toEqual({
				action: 'session',
				sessionId: 'abc',
				tabId: 'tab/slash',
			});
		});

		it('should return null for session without ID', () => {
			expect(parseDeepLink('maestro://session')).toBeNull();
			expect(parseDeepLink('maestro://session/')).toBeNull();
		});

		it('should ignore extra path segments after tab ID', () => {
			const result = parseDeepLink('maestro://session/abc/tab/tab1/extra/stuff');
			expect(result).toEqual({
				action: 'session',
				sessionId: 'abc',
				tabId: 'tab1',
			});
		});
	});

	describe('group action', () => {
		it('should parse group URL', () => {
			expect(parseDeepLink('maestro://group/grp789')).toEqual({
				action: 'group',
				groupId: 'grp789',
			});
		});

		it('should decode URI-encoded group IDs', () => {
			expect(parseDeepLink('maestro://group/group%20name')).toEqual({
				action: 'group',
				groupId: 'group name',
			});
		});

		it('should return null for group without ID', () => {
			expect(parseDeepLink('maestro://group')).toBeNull();
			expect(parseDeepLink('maestro://group/')).toBeNull();
		});
	});

	describe('Windows compatibility', () => {
		it('should handle Windows maestro: prefix (no double slash)', () => {
			expect(parseDeepLink('maestro:session/abc123')).toEqual({
				action: 'session',
				sessionId: 'abc123',
			});
		});

		it('should handle Windows focus without double slash', () => {
			expect(parseDeepLink('maestro:focus')).toEqual({ action: 'focus' });
		});
	});

	describe('error handling', () => {
		it('should return null for unrecognized resource', () => {
			expect(parseDeepLink('maestro://unknown/abc')).toBeNull();
		});

		it('should return null for completely malformed URLs', () => {
			// parseDeepLink is tolerant of most inputs, but unrecognized resources return null
			expect(parseDeepLink('maestro://settings')).toBeNull();
		});
	});
});

describe('setupDeepLinkHandling protocol registration opt-out', () => {
	const originalArgv = process.argv;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('MAESTRO_SKIP_PROTOCOL_REGISTRATION', undefined);
		vi.stubEnv('REGISTER_DEEP_LINKS_IN_DEV', undefined);
		vi.stubEnv('ENFORCE_SINGLE_INSTANCE_IN_DEV', undefined);
		Object.defineProperty(app, 'isPackaged', { value: true, configurable: true });
		vi.mocked(app.requestSingleInstanceLock).mockReturnValue(true);
		process.argv = ['/test/maestro', '/test/app.js'];
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		Object.defineProperty(app, 'isPackaged', { value: false, configurable: true });
		process.argv = originalArgv;
	});

	function makeWindow() {
		return {
			isMinimized: vi.fn().mockReturnValue(false),
			restore: vi.fn(),
			show: vi.fn(),
			focus: vi.fn(),
			webContents: { send: vi.fn() },
		};
	}

	function registeredHandlers() {
		return new Map(
			vi.mocked(app.on).mock.calls as unknown as Array<[string, (...args: unknown[]) => void]>
		);
	}

	it('keeps registration enabled for a normal packaged app', () => {
		expect(setupDeepLinkHandling(() => null)).toBe(true);
		expect(app.setAsDefaultProtocolClient).toHaveBeenCalledExactlyOnceWith('maestro');
		expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
		expect([...registeredHandlers().keys()]).toEqual(['second-instance', 'open-url']);
	});

	it.each(['0', 'true', ''])('only the exact value 1 disables registration, not %j', (value) => {
		vi.stubEnv('MAESTRO_SKIP_PROTOCOL_REGISTRATION', value);
		expect(setupDeepLinkHandling(() => null)).toBe(true);
		expect(app.setAsDefaultProtocolClient).toHaveBeenCalledExactlyOnceWith('maestro');
	});

	it('skips OS registration while keeping the lock and both live deep-link handlers', () => {
		vi.stubEnv('MAESTRO_SKIP_PROTOCOL_REGISTRATION', '1');
		const window = makeWindow();
		expect(setupDeepLinkHandling(() => window as unknown as BrowserWindow)).toBe(true);
		expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
		expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
		const handlers = registeredHandlers();
		expect([...handlers.keys()]).toEqual(['second-instance', 'open-url']);

		const event = { preventDefault: vi.fn() };
		handlers.get('open-url')!(event, 'maestro://session/mac-session/tab/mac-tab');
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(window.webContents.send).toHaveBeenLastCalledWith('app:deepLink', {
			action: 'session',
			sessionId: 'mac-session',
			tabId: 'mac-tab',
		});
		handlers.get('second-instance')!({}, ['/test/maestro', 'maestro://session/other-session']);
		expect(window.webContents.send).toHaveBeenLastCalledWith('app:deepLink', {
			action: 'session',
			sessionId: 'other-session',
		});
		expect(window.show).toHaveBeenCalledTimes(2);
		expect(window.focus).toHaveBeenCalledTimes(2);
	});

	it('still refuses a second instance when registration is disabled', () => {
		vi.stubEnv('MAESTRO_SKIP_PROTOCOL_REGISTRATION', '1');
		vi.mocked(app.requestSingleInstanceLock).mockReturnValue(false);
		expect(setupDeepLinkHandling(() => null)).toBe(false);
		expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
		expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
		expect(app.on).not.toHaveBeenCalled();
	});

	it('preserves cold-start deep links when registration is disabled', () => {
		vi.stubEnv('MAESTRO_SKIP_PROTOCOL_REGISTRATION', '1');
		process.argv.push('maestro://group/cold-start-group');
		const window = makeWindow();
		expect(setupDeepLinkHandling(() => null)).toBe(true);
		flushPendingDeepLink(() => window as unknown as BrowserWindow);
		expect(window.webContents.send).toHaveBeenCalledWith('app:deepLink', {
			action: 'group',
			groupId: 'cold-start-group',
		});
	});

	it('overrides explicit dev registration without changing dev lock policy', () => {
		Object.defineProperty(app, 'isPackaged', { value: false, configurable: true });
		vi.stubEnv('REGISTER_DEEP_LINKS_IN_DEV', '1');
		vi.stubEnv('MAESTRO_SKIP_PROTOCOL_REGISTRATION', '1');
		expect(setupDeepLinkHandling(() => null)).toBe(true);
		expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
		expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
		expect([...registeredHandlers().keys()]).toEqual(['second-instance', 'open-url']);
	});
});
