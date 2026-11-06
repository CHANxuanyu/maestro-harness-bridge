import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProjectOpener } from '../../main/open-project';
let root: string;
beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'open-project-')));
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});
it('reuses an existing local agent through a symlink alias without detecting or creating', async () => {
	const alias = path.join(root, 'alias');
	const project = path.join(root, 'project');
	await fs.mkdir(project);
	await fs.symlink(project, alias, 'junction');
	const detect = vi.fn();
	const open = vi.fn(async () => ({ success: true as const, sessionId: 'existing' }));
	const openProject = createProjectOpener({
		sessions: () => [{ id: 'existing', name: 'Project', cwd: alias, toolType: 'codex' }],
		detect,
		open,
	});
	expect(await openProject(project)).toEqual({ success: true, sessionId: 'existing' });
	expect(open).toHaveBeenCalledWith(
		expect.objectContaining({ sessionId: 'existing', path: project })
	);
	expect(detect).not.toHaveBeenCalled();
});
it('opens a directory without git using the preferred available tool and canonical name', async () => {
	const open = vi.fn(async () => ({ success: true as const, sessionId: 'new' }));
	const openProject = createProjectOpener({
		sessions: () => [],
		detect: async () => [
			{ id: 'codex', available: true },
			{ id: 'claude-code', available: true },
		],
		open,
	});
	await openProject(root);
	expect(open).toHaveBeenCalledWith({
		path: await fs.realpath(root),
		name: path.basename(root),
		toolType: 'claude-code',
	});
});
it('does not create when no tools are installed', async () => {
	const open = vi.fn();
	const result = await createProjectOpener({ sessions: () => [], detect: async () => [], open })(
		root
	);
	expect(result).toMatchObject({ success: false, code: 'no-tools' });
	expect(open).not.toHaveBeenCalled();
});
it('does not reuse an SSH agent with the same directory', async () => {
	const open = vi.fn(async () => ({ success: true as const, sessionId: 'new' }));
	await createProjectOpener({
		sessions: () => [
			{
				id: 'remote',
				name: path.basename(root),
				cwd: root,
				toolType: 'codex',
				sessionSshRemoteConfig: { enabled: true },
			},
		],
		detect: async () => [{ id: 'codex', available: true }],
		open,
	})(root);
	expect(open).toHaveBeenCalledWith(
		expect.objectContaining({ name: `${path.basename(root)} 2`, toolType: 'codex' })
	);
});
