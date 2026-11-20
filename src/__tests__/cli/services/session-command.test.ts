import { afterEach, expect, it, vi } from 'vitest';
import { failCommand } from '../../../cli/services/session-command';

afterEach(() => vi.restoreAllMocks());

it('keeps the JSON failure envelope and prints a diagnostic to stderr before exiting', () => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error('exit');
	});
	expect(() => failCommand('Invalid owner message', true)).toThrow('exit');
	expect(console.log).toHaveBeenCalledWith(
		JSON.stringify({ success: false, error: 'Invalid owner message' })
	);
	expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid owner message'));
	expect(process.exit).toHaveBeenCalledWith(1);
});
