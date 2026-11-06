import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createConversationArchive } from '../../../main/storage/conversation-archive';

const roots: string[] = [];
afterEach(() =>
	roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
);
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
	roots.push(root);
	const file = path.join(root, 'maestro-archives.json');
	fs.writeFileSync(file, '[]');
	const lifecycle = vi.fn().mockResolvedValue({ permissionMode: 'readonly' });
	const deps = {
		read: () => JSON.parse(fs.readFileSync(file, 'utf8')),
		write: (records: unknown) => fs.writeFileSync(file, JSON.stringify(records)),
		owners: () => [{ id: 'owner', toolType: 'codex', cwd: '/repo', projectRoot: '/repo' }],
		accountDir: () => path.join(root, 'account'),
		realpath: async (value: string) => value,
		lifecycle,
		deleteNative: vi.fn().mockResolvedValue({ success: true }),
	};
	return { deps, lifecycle, service: createConversationArchive(deps) };
}
it('persists archives across service recreation, retains permission and can unarchive', async () => {
	const { deps, service } = fixture();
	await service.change({ ownerId: 'owner', nativeSessionId: 'native' }, 'archive');
	const restarted = createConversationArchive(deps);
	expect(await restarted.list()).toEqual([
		expect.objectContaining({
			nativeSessionId: 'native',
			permissionMode: 'readonly',
			ownerIds: ['owner'],
		}),
	]);
	await restarted.change({ ownerId: 'owner', nativeSessionId: 'native' }, 'unarchive');
	expect(await service.list()).toEqual([]);
	expect(deps.deleteNative).not.toHaveBeenCalled();
});
it('rejects running conversations without persisting or deleting anything', async () => {
	const { service, lifecycle, deps } = fixture();
	lifecycle.mockRejectedValue(new Error('conversation-running'));
	await expect(
		service.change({ ownerId: 'owner', nativeSessionId: 'native' }, 'archive')
	).rejects.toThrow('conversation-running');
	expect(await service.list()).toEqual([]);
	expect(deps.deleteNative).not.toHaveBeenCalled();
});
it('separates accounts and hosts and never resolves a remote path locally', async () => {
	const { deps } = fixture();
	const realpath = vi.fn(async (value: string) => value);
	const service = createConversationArchive({ ...deps, realpath, owners: () => [] });
	for (const accountDir of ['~/one', '~/two'])
		await service.change(
			{
				provider: 'codex',
				nativeSessionId: 'same',
				projectPath: '~/repo',
				accountDir,
				sshRemoteId: 'remote',
			},
			'archive'
		);
	expect((await service.list()).map((row) => row.key)).toHaveLength(2);
	expect(realpath).not.toHaveBeenCalled();
});
it('refuses Claude deletion and delegates Codex deletion to the existing adapter', async () => {
	const { service, deps } = fixture();
	await expect(
		service.change(
			{ provider: 'claude-code', nativeSessionId: 'native', projectPath: '/repo' },
			'delete'
		)
	).rejects.toThrow('delete-unsupported');
	await service.change({ ownerId: 'owner', nativeSessionId: 'native' }, 'delete');
	expect(deps.deleteNative).toHaveBeenCalledOnce();
});

it('keeps a permission tightened between the initial check and closing the tabs', async () => {
	const { service, lifecycle } = fixture();
	lifecycle
		.mockResolvedValueOnce({ permissionMode: 'full' })
		.mockResolvedValueOnce({ permissionMode: 'readonly' });
	await service.change({ ownerId: 'owner', nativeSessionId: 'native' }, 'archive');
	expect((await service.list())[0].permissionMode).toBe('readonly');
});
it('restores archive metadata if a conversation starts running before close', async () => {
	const { service, lifecycle } = fixture();
	lifecycle
		.mockResolvedValueOnce({ permissionMode: 'full' })
		.mockResolvedValueOnce({ error: 'conversation-running' });
	await expect(
		service.change({ ownerId: 'owner', nativeSessionId: 'native' }, 'archive')
	).rejects.toThrow('conversation-running');
	expect(await service.list()).toEqual([]);
});
