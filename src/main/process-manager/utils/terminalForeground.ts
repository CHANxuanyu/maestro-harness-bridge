import path from 'path';

/**
 * Whether the PTY's foreground process is the shell itself rather than a
 * command running in it. macOS /bin/sh is a stub for bash, so the name node-pty
 * reports differs from the one we spawned.
 */
export function isShellForeground(command: string, foreground: string): boolean {
	const shell = path.basename(command);
	return foreground === shell || (shell === 'sh' && foreground === 'bash');
}
