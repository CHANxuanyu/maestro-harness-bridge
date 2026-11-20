import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { captureTeamOutput } from '../../../main/team/output-capture';
import { captureWebContentsPage } from '../../../main/utils/capture-page';
import { execGitReadOnly } from '../../../main/utils/remote-git';
import { BrowserWindow } from 'electron';
import type { Criterion } from '../../../shared/team/types';
import qaCriterion from '../../shared/team/real-output-criterion.json';

vi.mock('../../../main/utils/remote-git', () => ({ execGitReadOnly: vi.fn() }));
vi.mock('../../../main/utils/capture-page', () => ({ captureWebContentsPage: vi.fn() }));
vi.mock('electron', () => ({
	BrowserWindow: vi.fn(
		class {
			webContents = {
				setWindowOpenHandler: vi.fn(),
				loadURL: vi.fn(async () => {}),
				executeJavaScript: vi.fn(async () => {}),
			};
			destroy = vi.fn();
		}
	),
	webContents: { getAllWebContents: () => [] },
}));

let root: string;
let cwd: string;
const revision = 'a'.repeat(40);
const criteria: Criterion[] = [
	{
		id: 'E1',
		text: 'Readable in two places',
		proof: 'pm',
		locations: [
			{ label: 'First', target: 'result.html', kind: 'preview' },
			{ label: 'Second', target: 'other.html', kind: 'preview' },
		],
	},
];
beforeEach(async () => {
	vi.clearAllMocks();
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'team-m2-output-')));
	cwd = path.join(root, 'dev');
	await fs.mkdir(cwd);
	await fs.writeFile(path.join(cwd, 'result.html'), '<h1>before</h1>');
	await fs.writeFile(path.join(cwd, 'other.html'), '<h1>other</h1>');
	vi.mocked(execGitReadOnly).mockResolvedValue({
		stdout: 'result.html\0other.html\0',
		stderr: '',
		exitCode: 0,
	});
	vi.mocked(captureWebContentsPage).mockResolvedValue('data:image/png;base64,aW1hZ2U=');
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));

describe('M2 real output receipts', () => {
	it('captures the real C2 QA test from QA and its README from dev, preserving both sources', async () => {
		const qa = path.join(root, 'qa');
		await fs.mkdir(path.join(qa, 'qa'), { recursive: true });
		await fs.writeFile(path.join(qa, 'qa/clamp.qa.test.cjs'), '17 independent passing cases');
		await fs.writeFile(path.join(cwd, 'README.md'), 'finite inputs, min <= max');
		await expect(fs.stat(path.join(cwd, 'qa/clamp.qa.test.cjs'))).rejects.toThrow();
		const output = await captureTeamOutput(
			cwd,
			revision,
			[qaCriterion as Criterion],
			undefined,
			qa
		);
		expect(output.locations?.map((item) => item.error)).toEqual([undefined, undefined]);
		expect(output.locations?.map((item) => item.workspace)).toEqual(['dev', 'qa']);
		expect(output.locations?.[1].source).toBe(path.join(qa, 'qa/clamp.qa.test.cjs'));
		expect(await Promise.all(output.files.map((file) => fs.readFile(file, 'utf8')))).toEqual([
			'finite inputs, min <= max',
			'17 independent passing cases',
		]);
		await fs.mkdir(path.join(cwd, 'qa'));
		await fs.writeFile(path.join(cwd, 'qa/clamp.qa.test.cjs'), 'wrong workspace');
		await fs.writeFile(path.join(qa, 'qa/clamp.qa.test.cjs'), '18 independent passing cases');
		const next = await captureTeamOutput(cwd, revision, [qaCriterion as Criterion], 'prior', qa);
		expect(await fs.readFile(next.files[1], 'utf8')).toBe('18 independent passing cases');
		expect(await fs.readFile(output.files[1], 'utf8')).toBe('17 independent passing cases');
	});
	it('never falls back to dev for qa targets and rejects QA symlinks that leave qa/', async () => {
		const qa = path.join(root, 'qa');
		await fs.mkdir(path.join(qa, 'qa'), { recursive: true });
		await fs.mkdir(path.join(cwd, 'qa'));
		await fs.writeFile(path.join(cwd, 'qa/clamp.qa.test.cjs'), 'dev decoy');
		let output = await captureTeamOutput(cwd, revision, [qaCriterion as Criterion]);
		expect(output.locations?.[1]).toMatchObject({ workspace: 'qa', error: expect.any(String) });
		await fs.writeFile(path.join(qa, 'outside.cjs'), 'outside qa/');
		await fs.symlink(path.join(qa, 'outside.cjs'), path.join(qa, 'qa/clamp.qa.test.cjs'));
		output = await captureTeamOutput(cwd, revision, [qaCriterion as Criterion], undefined, qa);
		expect(output.locations?.[1].error).toContain('outside');
		expect(output.files).toEqual([]);
	});
	it('captures every named place, preserves before/after files and uses the compositor utility', async () => {
		const before = await captureTeamOutput(cwd, revision, criteria);
		expect(before.previews).toHaveLength(2);
		expect(before.locations?.every((item) => item.preview && item.file && !item.error)).toBe(true);
		await fs.writeFile(path.join(cwd, 'result.html'), '<h1>after</h1>');
		const after = await captureTeamOutput(cwd, 'b'.repeat(40), criteria, 'before-capture');
		expect(after.beforeOutputId).toBe('before-capture');
		expect(await fs.readFile(before.files[0], 'utf8')).toBe('<h1>before</h1>');
		expect(await fs.readFile(after.files[0], 'utf8')).toBe('<h1>after</h1>');
		expect(captureWebContentsPage).toHaveBeenCalledTimes(4);
		expect(
			vi.mocked(BrowserWindow).mock.results.every((r) => r.value.destroy.mock.calls.length === 1)
		).toBe(true);
	});
	it('bounds a stalled compositor and closes its preview window without inventing evidence', async () => {
		vi.useFakeTimers();
		try {
			vi.mocked(captureWebContentsPage).mockImplementationOnce(() => new Promise(() => {}));
			const pending = captureTeamOutput(cwd, revision, [
				{ ...criteria[0], locations: [criteria[0].locations![0]] },
			]);
			await vi.waitFor(() => expect(captureWebContentsPage).toHaveBeenCalledOnce());
			await vi.advanceTimersByTimeAsync(10_000);
			const output = await pending;
			expect(output.previews).toEqual([]);
			expect(output.locations![0].error).toContain('timed out');
			expect(vi.mocked(BrowserWindow).mock.results[0].value.destroy).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});
	it('records missing viewers and refuses output symlinks outside the workspace', async () => {
		await fs.writeFile(path.join(root, 'outside.txt'), 'outside');
		await fs.symlink(path.join(root, 'outside.txt'), path.join(cwd, 'link.txt'));
		const captured = await captureTeamOutput(cwd, revision, [
			{
				id: 'E1',
				text: 'Views',
				proof: 'pm',
				locations: [
					{ label: 'External', target: 'https://example.invalid/output', kind: 'screenshot' },
					{ label: 'Escaping', target: 'link.txt', kind: 'file' },
				],
			},
		]);
		expect(captured.locations?.map((item) => item.error)).toEqual([
			expect.stringContaining('Open this named viewer'),
			expect.stringContaining('outside'),
		]);
		expect(captured.files).toEqual([]);
		expect(captured.previews).toEqual([]);
	});
});
