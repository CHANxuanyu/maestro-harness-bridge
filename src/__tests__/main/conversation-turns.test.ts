import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createConversationTurns, followUpPrompt } from '../../main/conversation-turns';
import type { FollowUpFire } from '../../shared/followUp';

describe('conversation delivery adapter', () => {
	let root: string;
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-turns-'));
	});
	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});
	const target = { kind: 'conversation' as const, sessionId: 'owner', tabId: 'exact' };
	const entry = { id: 'follow:one', target, prompt: 'Return for the original reason' };

	it('persists before dispatch and targets only the owning window after readiness', async () => {
		const send = vi.fn();
		const windows = {
			getWindowForSession: vi.fn(() => 'owner-window'),
			get: vi.fn(() => ({
				browserWindow: {
					isDestroyed: () => false,
					webContents: { isDestroyed: () => false, send },
				},
			})),
		};
		const turns = createConversationTurns({
			userData: root,
			windows: windows as never,
			exists: () => true,
		});
		await turns.enqueue(entry);
		expect(send).not.toHaveBeenCalled();
		expect(
			JSON.parse(await fs.readFile(path.join(root, 'conversation-turns.json'), 'utf8'))[0]
		).toMatchObject({ ...entry, state: 'queued' });
		await turns.ready('other-window');
		expect(send).not.toHaveBeenCalled();
		await turns.ready('owner-window');
		expect(send).toHaveBeenCalledWith(
			'conversationAutomation:turn',
			expect.objectContaining(entry)
		);
		await turns.acknowledge(entry.id, 'other-window');
		expect((await turns.list())[0].state).toBe('queued');
		await turns.acknowledge(entry.id, 'owner-window');
		expect((await turns.list())[0].state).toBe('accepted');
	});
	it('never falls back when the owner window is unavailable, and survives restart', async () => {
		const windows = {
			getWindowForSession: () => 'closed-owner',
			getPrimary: () => ({ id: 'primary' }) as never,
			get: vi.fn(),
		};
		await createConversationTurns({ userData: root, windows, exists: () => true }).enqueue(entry);
		const restored = createConversationTurns({ userData: root, windows, exists: () => true });
		await restored.ready('primary');
		expect(windows.get).not.toHaveBeenCalled();
		expect((await restored.list())[0]).toMatchObject({ ...entry, state: 'queued' });
		await restored.enqueue(entry);
		expect(await restored.list()).toHaveLength(1);
	});
	it('marks a missing exact conversation undeliverable without addressing another tab', async () => {
		const windows = { getWindowForSession: vi.fn(), getPrimary: vi.fn(), get: vi.fn() };
		const turns = createConversationTurns({ userData: root, windows, exists: () => false });
		await turns.enqueue(entry);
		expect((await turns.list())[0]).toMatchObject({
			state: 'undeliverable',
			error: expect.stringContaining('no longer exists'),
		});
		expect(windows.getWindowForSession).not.toHaveBeenCalled();
	});
	it('can cancel an accepted queued turn and ignores a later acceptance receipt', async () => {
		const windows = { getWindowForSession: () => 'owner', getPrimary: vi.fn(), get: vi.fn() };
		const turns = createConversationTurns({ userData: root, windows, exists: () => true });
		await turns.enqueue(entry);
		await turns.acknowledge(entry.id, 'owner');
		await turns.cancel(target);
		await turns.acknowledge(entry.id, 'owner');
		expect((await turns.list())[0].state).toBe('canceled');
	});
	it('reports a conversation deleted while queued, but preserves a turn already delivered', async () => {
		let exists = true;
		const turns = createConversationTurns({
			userData: root,
			windows: { getWindowForSession: () => 'owner', getPrimary: vi.fn(), get: vi.fn() },
			exists: () => exists,
		});
		await turns.enqueue(entry);
		await turns.acknowledge(entry.id, 'owner');
		await turns.enqueue({ ...entry, id: 'follow:finished' });
		await turns.delivered('follow:finished');
		exists = false;
		await turns.pump();
		expect((await turns.list()).map((item) => item.state)).toEqual(['undeliverable', 'delivered']);
	});
	it.each(['ready', 'wait-timeout', 'expired'] as const)(
		'carries reason and observed result for %s, including lateness',
		(kind) => {
			const prompt = followUpPrompt({
				kind,
				late: true,
				followUp: { id: 'one', reason: 'Wait for lint', condition: { kind: 'command' } },
				externalStatus: {
					state: 'completed',
					exitCode: 1,
					outputTail: 'last error',
					failingJob: 'Windows',
					conclusion: 'failure',
				},
			} as FollowUpFire);
			expect(prompt).toContain('Wait for lint');
			expect(prompt).toContain('Late');
			expect(prompt).toContain('"exitCode":1');
			expect(prompt).toContain('last error');
			expect(prompt).toContain('Windows');
		}
	);
});
