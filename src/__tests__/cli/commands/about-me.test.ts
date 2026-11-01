import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aboutMe } from '../../../cli/commands/about-me';
import { sendSimpleCommand } from '../../../cli/services/session-command';

vi.mock('../../../cli/services/session-command', async (original) => ({
	...(await original<typeof import('../../../cli/services/session-command')>()),
	sendSimpleCommand: vi.fn(),
}));
const output = vi.fn();
const file = path.resolve('synthetic-account', 'CLAUDE.md');
const snapshot = {
	success: true,
	content: 'Profile',
	estimatedTokens: 2,
	files: [
		{
			path: file,
			aliases: [file],
			resolvedPath: file,
			currentBlock: null,
			providers: ['claude-code'],
			state: 'unconfirmed',
			shadowedBy: [],
		},
	],
};
beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'log').mockImplementation(output);
	vi.spyOn(console, 'error').mockImplementation(output);
	vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
	vi.mocked(sendSimpleCommand).mockResolvedValue(snapshot);
});
afterEach(() => vi.restoreAllMocks());

describe('About me CLI consent contract', () => {
	it.each(['show', 'status'])('only reads for %s', async (action) => {
		await aboutMe(action, { json: true });
		expect(sendSimpleCommand).toHaveBeenCalledExactlyOnceWith(
			{ type: 'about_me', request: { action } },
			'about_me_result'
		);
		expect(JSON.parse(output.mock.calls[0][0])).toEqual(snapshot);
	});
	it.each([{ stdin: true }, { file: 'synthetic-profile.md' }])(
		'stages exact file/stdin Markdown without applying: %j',
		async (options) => {
			const content = 'Native preference\r\n用户偏好';
			const read = vi.spyOn(fs, 'readFileSync').mockReturnValue(content);
			await aboutMe('set', { ...options, json: true });
			expect(read).toHaveBeenCalledWith('stdin' in options ? 0 : options.file, 'utf8');
			expect(sendSimpleCommand).toHaveBeenCalledExactlyOnceWith(
				{ type: 'about_me', request: { action: 'set', content } },
				'about_me_result'
			);
		}
	);
	it('stages removal without altering native files until apply', async () => {
		await aboutMe('set', { clear: true, json: true });
		expect(sendSimpleCommand).toHaveBeenCalledExactlyOnceWith(
			{ type: 'about_me', request: { action: 'set', content: '' } },
			'about_me_result'
		);
	});
	it('applies without inventing consent when no confirm flag is supplied', async () => {
		const failure = { ...snapshot, success: false, code: 'confirmation-required', written: [] };
		vi.mocked(sendSimpleCommand).mockResolvedValueOnce(snapshot).mockResolvedValueOnce(failure);
		await aboutMe('apply', { json: true });
		expect(sendSimpleCommand).toHaveBeenNthCalledWith(
			2,
			{ type: 'about_me', request: { action: 'apply', content: 'Profile', confirmations: [] } },
			'about_me_result'
		);
		expect(JSON.parse(output.mock.calls[0][0])).toEqual(failure);
		expect(process.exit).toHaveBeenCalledWith(1);
	});
	it('forwards exact observed segment and resolved target only for explicit file consent', async () => {
		await aboutMe('apply', { confirm: [file], json: true });
		expect(sendSimpleCommand).toHaveBeenNthCalledWith(
			2,
			{
				type: 'about_me',
				request: {
					action: 'apply',
					content: 'Profile',
					confirmations: [{ path: file, resolvedPath: file, block: null }],
				},
			},
			'about_me_result'
		);
	});
	it('does not accept an old alias after its target changed', async () => {
		vi.mocked(sendSimpleCommand).mockResolvedValue({
			...snapshot,
			files: [{ ...snapshot.files[0], resolvedPath: path.resolve('new-target', 'CLAUDE.md') }],
		});
		await aboutMe('apply', { confirm: [file], json: true });
		expect(sendSimpleCommand).toHaveBeenCalledTimes(1);
		expect(process.exit).toHaveBeenCalledWith(1);
	});
	it.each([
		{ action: 'unknown', options: {} },
		{ action: 'set', options: {} },
		{ action: 'set', options: { stdin: true, file: 'profile.md' } },
		{ action: 'set', options: { clear: true, stdin: true } },
		{ action: 'show', options: { clear: true } },
		{ action: 'status', options: { confirm: [file] } },
	])(
		'rejects invalid command combinations before contacting the desktop: %j',
		async ({ action, options }) => {
			await aboutMe(action, { ...options, json: true });
			expect(sendSimpleCommand).not.toHaveBeenCalled();
			expect(process.exit).toHaveBeenCalledWith(1);
		}
	);
	it('does not turn a failed status request into an apply', async () => {
		vi.mocked(sendSimpleCommand).mockResolvedValue({
			success: false,
			error: 'Desktop unavailable',
		});
		await aboutMe('apply', { confirm: [file], json: true });
		expect(sendSimpleCommand).toHaveBeenCalledTimes(1);
		expect(JSON.parse(output.mock.calls[0][0])).toEqual({
			success: false,
			error: 'Desktop unavailable',
		});
	});
});
