import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const isolation = vi.hoisted(() => ({ root: '' }));
vi.mock('os', async (original) => {
	const actual = await original<typeof import('os')>();
	return { ...actual, homedir: () => isolation.root };
});
import { isSessionBusyInDesktop } from '../../../cli/services/agent-busy';
import { registerCliActivity } from '../../../shared/cli-activity';
beforeEach(() => {
	isolation.root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-product-paths-'));
	vi.stubEnv('MAESTRO_USER_DATA', isolation.root);
});
afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(isolation.root, { recursive: true, force: true });
});
it('reads desktop busy state from the explicitly selected product data directory', () => {
	fs.writeFileSync(
		path.join(isolation.root, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [{ id: 'agent', state: 'busy' }] })
	);
	expect(isSessionBusyInDesktop('agent').busy).toBe(true);
});
it('writes CLI activity into the same selected product data directory', () => {
	registerCliActivity({
		sessionId: 'agent',
		playbookId: 'fixture',
		playbookName: 'Fixture',
		startedAt: 1,
		pid: process.pid,
	});
	expect(
		JSON.parse(fs.readFileSync(path.join(isolation.root, 'cli-activity.json'), 'utf8'))
			.activities[0].sessionId
	).toBe('agent');
});
