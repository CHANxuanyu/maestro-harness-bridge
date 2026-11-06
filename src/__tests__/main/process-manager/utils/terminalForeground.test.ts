import { describe, expect, it } from 'vitest';
import { isShellForeground } from '../../../../main/process-manager/utils/terminalForeground';

describe('isShellForeground', () => {
	it('recognizes the shell we spawned', () => {
		expect(isShellForeground('/bin/zsh', 'zsh')).toBe(true);
		expect(isShellForeground('bash', 'bash')).toBe(true);
	});

	it('treats any other foreground process as a running command', () => {
		expect(isShellForeground('/bin/zsh', 'vim')).toBe(false);
		expect(isShellForeground('/bin/zsh', 'bash')).toBe(false);
	});

	it('accepts bash under /bin/sh, which is a stub for bash on macOS', () => {
		expect(isShellForeground('/bin/sh', 'bash')).toBe(true);
		expect(isShellForeground('/bin/sh', 'sh')).toBe(true);
		expect(isShellForeground('/bin/sh', 'vim')).toBe(false);
	});
});
