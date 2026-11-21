import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
	createConversationAutomation,
	type ConversationAutomationDependencies,
} from '../../main/conversation-automation';
import { createConversationTurns } from '../../main/conversation-turns';
import { createFollowUpStore } from '../../main/follow-ups';
import type { AutomationAction, ConversationTarget } from '../../shared/conversationAutomation';
import type { CheckRun } from '../../shared/checkRun';

vi.mock('../../main/utils/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../../main/utils/cliDetection', () => ({ resolveGhPath: async () => 'gh' }));

describe('conversation checks, fix loop and shared limits', () => {
	let root: string;
	let service: ReturnType<typeof createConversationAutomation>;
	let followUps: ReturnType<typeof createFollowUpStore>;
	let deps: ConversationAutomationDependencies;
	let time: number;
	let fingerprint: string;
	let failure: string;
	let outcome: CheckRun['outcome'];
	const target: ConversationTarget = { kind: 'conversation', sessionId: 'agent', tabId: 'tab' };
	const call = (action: AutomationAction, selected = target) =>
		service.execute({ ...action, target: selected });
	const status = () => call({ action: 'status' });
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-automation-'));
		time = 1_000_000;
		fingerprint = 'diff-a';
		failure = 'TS2304';
		outcome = 'fail';
		followUps = createFollowUpStore({
			userData: root,
			now: () => time,
			gh: async () => ({ status: 'queued', conclusion: null }),
		});
		deps = {
			userData: root,
			now: () => time,
			resolve: async () => ({ cwd: root, project: root, host: { kind: 'local' } }),
			snapshot: async () => ({ revision: 'revision', fingerprint }),
			checks: {
				run: vi.fn(async ({ command }) => ({
					id: `check-${time}`,
					command,
					cwd: root,
					host: { kind: 'local' },
					startedAt: time,
					endedAt: time,
					exitCode: command === 'true' || outcome === 'pass' ? 0 : 1,
					outcome: command === 'true' ? 'pass' : outcome,
					outputTail: command === 'true' ? 'application evidence' : failure,
					truncated: false,
				})),
			},
			followUps,
			turns: createConversationTurns({
				userData: root,
				windows: {
					getWindowForSession: () => null,
					getPrimary: () => undefined,
					get: () => undefined,
				},
				exists: () => true,
			}),
			changed: vi.fn(),
			onError: vi.fn(),
			cancelAutomatic: vi.fn(),
		};
		service = createConversationAutomation(deps);
	});
	afterEach(async () => {
		service.dispose();
		await fs.rm(root, { recursive: true, force: true });
	});
	const initialFailure = async () => {
		await call({ action: 'checks-set', commands: ['true', 'false'] });
		await call({ action: 'authorize', choice: 'project' });
		await call({ action: 'fix', mode: 'auto' });
	};
	const finishAttempt = async () => {
		const before = await status();
		time += 1000;
		await service.afterTurn(target, `turn-${time}`, true, before.pendingTurn?.id);
		return status();
	};

	it('asks once per project, shares authorization with another conversation and requests outside scope', async () => {
		let state = await call({ action: 'checks-set', commands: ['true'] });
		expect(state.projectAuthorized).toBe(false);
		await call({ action: 'checks-run' });
		expect(deps.checks.run).not.toHaveBeenCalled();
		state = await call({ action: 'authorize', choice: 'project' });
		expect(state.batches[0].checks[0].outcome).toBe('pass');
		const second = { ...target, tabId: 'second' };
		state = await call({ action: 'checks-set', commands: ['false'] }, second);
		expect(state.projectAuthorized).toBe(true);
		expect(state.batches[0].checks[0].outcome).toBe('fail');
		state = await call({ action: 'checks-set', commands: ['cat ../private', 'git push'] });
		expect(state.checks.map((check) => check.boundary)).toEqual(['outside-project', 'network']);
		const calls = vi.mocked(deps.checks.run).mock.calls.length;
		await call({ action: 'checks-run' });
		expect(deps.checks.run).toHaveBeenCalledTimes(calls);
		await call({ action: 'authorize', choice: 'reject', checkId: state.checks[1].id });
		await call({ action: 'authorize', choice: 'once', checkId: state.checks[0].id });
		expect(deps.checks.run).toHaveBeenCalledTimes(calls + 1);
		await call({ action: 'checks-run' });
		expect(deps.checks.run).toHaveBeenCalledTimes(calls + 1);
	});
	it('keeps app evidence with its revision and turn, and treats timeout as not run in the loop', async () => {
		await initialFailure();
		let state = await finishAttempt();
		expect(state.batches.at(-1)).toMatchObject({
			turnId: `turn-${time}`,
			revision: 'revision',
			checks: [
				{ outcome: 'pass', outputTail: 'application evidence' },
				{ outcome: 'fail', outputTail: 'TS2304' },
			],
		});
		outcome = 'timeout';
		const attempts = state.attempts.length;
		state = await finishAttempt();
		expect(state.batches.at(-1)?.checks[1].outcome).toBe('timeout');
		expect(state.attempts).toHaveLength(attempts);
		expect(state.pendingTurn).toBeUndefined();
	});
	it('remembers auto-fix when a later file-changing turn introduces a new failure after passing', async () => {
		await initialFailure();
		outcome = 'pass';
		expect((await finishAttempt()).decision?.kind).toBe('done');
		outcome = 'fail';
		failure = 'new problem';
		await service.afterTurn(target, 'later-user-turn', true);
		const state = await status();
		expect(state.progress.failures).toHaveLength(1);
		expect(state.pendingTurn).toBeDefined();
		expect(state.fix).toBe('auto');
	});
	it('continues on changed failures, diagnoses after three including a repeat, and never selects a tried candidate', async () => {
		await initialFailure();
		let state = await finishAttempt();
		expect(state.progress.streak).toBe(1);
		const first = state.attempts[0].fingerprint;
		await call({
			action: 'plan',
			proposal: {
				basis: 'same wording',
				difference: 'renamed',
				expectation: 'pass',
				candidates: [{ plan: 'Repeat old patch', basis: 'renamed', fingerprint: first }],
			},
		});
		state = await finishAttempt();
		expect(state.progress.attempts.at(-1)?.verdict).toBe('dup');
		expect(state.decision?.kind).toBe('gather');
		fingerprint = 'diff-b';
		state = await finishAttempt();
		expect(state.decision?.kind).toBe('diagnose');
		expect(state.pendingTurn?.diagnosis).toBe(true);
		expect(state.deliveries.at(-1)?.prompt).toContain('Diagnose');
		failure = 'Different failure';
		fingerprint = 'diagnosed-patch';
		state = await finishAttempt();
		expect(state.progress.streak).toBe(0);
		expect(state.progress.attempts.some((attempt) => attempt.verdict === 'changed')).toBe(true);
		expect(state.decision?.kind).not.toBe('escalate');
	});
	it('escalates only a required boundary, with concrete costs, and pauses budget until the owner chooses', async () => {
		await initialFailure();
		await call({
			action: 'plan',
			proposal: {
				basis: 'Registry returned 401',
				difference: 'Dependency fix',
				expectation: 'Build completes',
				candidates: [
					{
						plan: 'Owner logs in to the registry',
						basis: 'Registry returned 401',
						boundary: 'login',
						cost: 'Owner: 2 minutes',
						recommended: true,
					},
					{ plan: 'Stronger model might help', boundary: 'model', advice: true },
				],
			},
		});
		let state = await finishAttempt();
		expect(state.decision).toMatchObject({
			kind: 'escalate',
			boundaries: ['login'],
			options: [{ cost: 'Owner: 2 minutes' }],
		});
		const deadline = state.deadline!;
		time += 5000;
		state = await call({ action: 'answer', option: 0 });
		expect(state.deadline).toBe(deadline + 5000);
		expect(state.decision?.kind).toBe('continue');
	});
	it('enforces the PRD owner-only checks, cancellation and approvals, and rejects another caller target', async () => {
		await expect(
			service.execute({
				action: 'authorize',
				choice: 'project',
				target,
				caller: { agentId: 'agent', tabId: 'tab' },
			})
		).rejects.toThrow('owner');
		const state = await call({
			action: 'follow-add',
			reason: 'Own wait',
			condition: { kind: 'time', at: time + 1000 },
		});
		await expect(
			service.execute({
				action: 'follow-cancel',
				id: state.followUps[0].id,
				target,
				caller: { agentId: 'agent', tabId: 'tab' },
			})
		).rejects.toThrow('owner');
		expect((await status()).followUps[0].state).toBe('pending');
		await call({ action: 'checks-set', commands: ['true'] });
		await call({ action: 'authorize', choice: 'project' });
		await expect(
			service.execute({
				action: 'checks-run',
				target,
				caller: { agentId: 'agent', tabId: 'tab' },
			})
		).rejects.toThrow('owner');
		await expect(
			service.execute({ action: 'status', target, caller: { agentId: 'other', tabId: 'tab' } })
		).rejects.toThrow('own exact');
	});
	it('finishes an interrupted expiry report after restarting without losing the last observation', async () => {
		await call({
			action: 'follow-add',
			reason: 'Final CI observation',
			condition: { kind: 'ci', runId: '42', cwd: root },
			totalMs: 1000,
		});
		const observe = vi.spyOn(followUps, 'observe').mockRejectedValue(new Error('Interrupted'));
		time += 1001;
		await service.start();
		await vi.waitFor(() => expect(deps.onError).toHaveBeenCalled());
		expect((await status()).expiryPending).toHaveLength(1);
		service.dispose();
		observe.mockRestore();
		service = createConversationAutomation(deps);
		await service.start();
		await vi.waitFor(async () => expect((await status()).expired).toBe(true));
		expect((await status()).expiryReport?.observations).toEqual([
			expect.objectContaining({
				reason: 'Final CI observation',
				status: expect.objectContaining({ status: 'queued' }),
			}),
		]);
		expect((await status()).expiryPending).toBeUndefined();
	});
	it('persists project grants and the shared absolute budget across restart', async () => {
		await initialFailure();
		const state = await call({
			action: 'follow-add',
			reason: 'check later',
			condition: { kind: 'time', at: time + 20_000 },
		});
		expect(state.followUps[0].deadline).toBe(state.deadline);
		expect(
			(await followUps.list()).filter(
				(entry) => entry.id.startsWith('budget:') && entry.state === 'pending'
			)
		).toHaveLength(1);
		service.dispose();
		service = createConversationAutomation(deps);
		time += 30_000;
		const restored = await status();
		expect(restored.projectAuthorized).toBe(true);
		expect(restored.deadline).toBe(state.deadline);
	});
	it('a single wait and three unchanged CI polls never count as failed attempts; total expiry stops and reports', async () => {
		await call({
			action: 'follow-add',
			reason: 'Wait for CI',
			condition: { kind: 'ci', runId: '42', cwd: root },
			waitLimitMs: 1000,
			totalMs: 3_000_000,
		});
		for (let index = 0; index < 4; index++) {
			time += index ? 600_000 : 1000;
			await service.start();
			await vi.waitFor(async () =>
				expect((await status()).followUps.some((follow) => follow.state === 'pending')).toBe(true)
			);
			await vi.waitFor(async () =>
				expect(
					(await status()).deliveries.filter((entry) => entry.id.startsWith('follow:')).length
				).toBe(index + 1)
			);
			expect((await status()).attempts).toHaveLength(0);
			service.dispose();
		}
		time = (await status()).deadline! + 1;
		await service.start();
		await vi.waitFor(async () => expect((await status()).expired).toBe(true));
		const state = await status();
		expect(state.stopped).toBe(true);
		expect(state.report).toContain('stopped-incomplete');
		expect(state.report).toContain('Extend one hour');
		expect(state.followUps.some((follow) => follow.state === 'pending')).toBe(false);
		expect(state.deliveries.at(-1)?.prompt).toContain('Stop; do not change files');
		expect(deps.cancelAutomatic).toHaveBeenCalled();
	});
});
