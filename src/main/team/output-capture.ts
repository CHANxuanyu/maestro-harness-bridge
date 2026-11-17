import * as fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { BrowserWindow, webContents } from 'electron';
import MarkdownIt from 'markdown-it';
import { createHash } from 'crypto';
import { DURATION_MS } from '../../shared/duration';
import { isPathAtOrUnderRoot, normalizeWorktreePath } from '../../shared/worktreePaths';
import type { Criterion, OutputCapture, OutputLocation } from '../../shared/team/types';
import { execGitReadOnly } from '../utils/remote-git';
import { captureWebContentsPage } from '../utils/capture-page';

/** Immutable files and compositor previews, kept outside the writable developer tree. */
export async function captureTeamOutput(
	cwd: string,
	revision: string,
	criteria: Criterion[] = [],
	beforeOutputId?: string
): Promise<OutputCapture> {
	if (!/^[a-f0-9]{40,64}$/.test(revision))
		throw new Error('Output capture requires a submitted revision');
	const root = path.join(path.dirname(cwd), 'outputs', revision);
	await fs.mkdir(root, { recursive: true });
	const output: OutputCapture = { files: [], previews: [], locations: [], beforeOutputId };
	const tree = await execGitReadOnly(['ls-tree', '-r', '--name-only', '-z', revision], cwd);
	if (tree.exitCode !== 0) throw new Error(tree.stderr);
	const tracked = tree.stdout.split('\0').filter(Boolean);
	const declared = criteria.flatMap((criterion) =>
		(criterion.locations ?? []).map((location) => ({ criterion: criterion.id, location }))
	);
	// Existing M1 briefs have no location manifest. Keep real files available to PM.
	const targets = declared.length
		? declared
		: tracked.slice(0, 200).map((target) => ({
				criterion: '',
				location: {
					label: target,
					target,
					kind: /\.(html?|md|svg)$/i.test(target) ? 'preview' : 'file',
				} as OutputLocation,
			}));
	for (const target of targets) {
		const receipt: NonNullable<OutputCapture['locations']>[number] = { ...target };
		let previewWindow: BrowserWindow | undefined;
		try {
			let contents: Electron.WebContents | undefined;
			let previewUrl: string | undefined;
			if (/^https?:\/\//i.test(target.location.target)) {
				contents = webContents
					.getAllWebContents()
					.find((item) => !item.isDestroyed() && item.getURL() === target.location.target);
				if (!contents) throw new Error('Open this named viewer in the app before capturing it');
			} else {
				const source = await fs.realpath(path.resolve(cwd, target.location.target));
				if (
					!isPathAtOrUnderRoot(
						normalizeWorktreePath(source),
						normalizeWorktreePath(await fs.realpath(cwd))
					)
				)
					throw new Error('Output path is outside the task workspace');
				if (!(await fs.stat(source)).isFile()) throw new Error('Output target must be a file');
				const relative = path.relative(cwd, source);
				const destination = path.join(root, 'files', relative);
				await fs.mkdir(path.dirname(destination), { recursive: true });
				try {
					await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				}
				receipt.file = destination;
				output.files.push(destination);
				if (target.location.kind !== 'file') {
					previewWindow = new BrowserWindow({
						show: false,
						width: 1280,
						height: 900,
						webPreferences: {
							sandbox: true,
							nodeIntegration: false,
							contextIsolation: true,
							backgroundThrottling: false,
						},
					});
					previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
					contents = previewWindow.webContents;
					if (/\.md$/i.test(source)) {
						const html = new MarkdownIt({ html: false }).render(
							await fs.readFile(destination, 'utf8')
						);
						previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(`<meta charset="utf-8"><style>body{font:18px system-ui;max-width:1100px;margin:36px;line-height:1.6}pre{white-space:pre-wrap}img{max-width:100%}</style>${html}`)}`;
					} else previewUrl = pathToFileURL(source).href;
				}
			}
			if (contents && target.location.kind !== 'file') {
				let timeout: ReturnType<typeof setTimeout> | undefined;
				let dataUrl: string | null;
				try {
					const viewer = contents;
					dataUrl = await Promise.race([
						(async () => {
							if (previewUrl) await viewer.loadURL(previewUrl);
							await viewer.executeJavaScript(
								'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
							);
							return captureWebContentsPage(viewer);
						})(),
						new Promise<never>((_, reject) => {
							timeout = setTimeout(
								() => reject(new Error('Preview loading or capture timed out')),
								10 * DURATION_MS.second
							);
						}),
					]);
				} finally {
					if (timeout) clearTimeout(timeout);
				}
				if (!dataUrl) throw new Error('Viewer produced an empty capture');
				const name = createHash('sha256').update(JSON.stringify(target)).digest('hex');
				const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
				const image = path.join(
					root,
					`${name}-${createHash('sha256').update(bytes).digest('hex')}.png`
				);
				await fs.writeFile(image, bytes);
				receipt.preview = image;
				output.previews.push(image);
			}
		} catch (error) {
			receipt.error = error instanceof Error ? error.message : String(error);
		} finally {
			previewWindow?.destroy();
		}
		output.locations!.push(receipt);
	}
	return output;
}
