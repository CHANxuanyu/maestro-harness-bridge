// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerSession } from '../../../main/process-manager/CodexAppServerSession';

const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};

function fixture(overrides: Record<string, unknown> = {}) {
	const sent: any[] = [];
	const events: any[] = [];
	const done = vi.fn();
	const deltas = vi.fn();
	const resolved = vi.fn();
	const session = new CodexAppServerSession({
		cwd: '/tmp/project',
		prompt: 'Synthetic prompt',
		imagePaths: [],
		settings: {
			approvalPolicy: 'on-request',
			sandbox: 'workspace-write',
			onPermissionResolved: resolved,
			...overrides,
		},
		send: (line: string) => sent.push(JSON.parse(line)),
		onEvent: (event: unknown) => events.push(event),
		onDone: done,
		onTextDelta: deltas,
	});
	const reply = (method: string, result: unknown) => {
		const request = sent.findLast((message) => message.method === method);
		expect(request, `request ${method}`).toBeDefined();
		session.handleData(JSON.stringify({ id: request.id, result }) + '\n');
	};
	const notify = (method: string, params: unknown, id?: number) =>
		session.handleData(JSON.stringify({ method, params, ...(id == null ? {} : { id }) }) + '\n');
	const start = async () => {
		void session.start();
		reply('initialize', { userAgent: 'synthetic-fixture' });
		await settle();
		reply(overrides.threadId ? 'thread/resume' : 'thread/start', {
			thread: { id: 'thread-1', status: { type: 'idle' } },
			model: 'fixture-model',
		});
		await settle();
		reply('turn/start', { turn: { id: 'turn-1', status: 'inProgress' } });
		await settle();
	};
	return { session, sent, events, done, deltas, resolved, reply, notify, start };
}

afterEach(() => vi.useRealTimers());

describe('Codex app-server synthetic stdio protocol', () => {
	it('initializes, starts one thread and one turn, and keeps approval policy explicit', async () => {
		const f = fixture({ model: 'fixture-model', effort: 'high', writableRoots: ['/tmp/extra'] });
		await f.start();
		expect(f.sent.map((message) => message.method)).toEqual([
			'initialize',
			'initialized',
			'thread/start',
			'turn/start',
		]);
		expect(f.sent[2].params).toMatchObject({
			cwd: '/tmp/project',
			approvalPolicy: 'on-request',
			sandbox: 'workspace-write',
		});
		expect(f.sent[3].params).toMatchObject({
			threadId: 'thread-1',
			input: [{ type: 'text', text: 'Synthetic prompt' }],
			model: 'fixture-model',
			effort: 'high',
			approvalPolicy: 'on-request',
			sandboxPolicy: {
				type: 'workspaceWrite',
				writableRoots: ['/tmp/extra'],
				networkAccess: false,
			},
		});
		f.session.dispose();
	});

	it('resumes exactly the requested thread and refuses a non-idle thread', async () => {
		const f = fixture({ threadId: 'thread-1' });
		void f.session.start();
		f.reply('initialize', {});
		await settle();
		f.reply('thread/resume', { thread: { id: 'thread-1', status: { type: 'active' } } });
		await settle();
		expect(f.sent.some((message) => message.method === 'turn/start')).toBe(false);
		expect(f.done).toHaveBeenCalledWith(1);
		expect(f.events).toContainEqual(expect.objectContaining({ type: 'error' }));
	});

	it('maps tools, output deltas, commentary and one final answer to existing Codex events', async () => {
		const f = fixture();
		await f.start();
		const scope = { threadId: 'thread-1', turnId: 'turn-1' };
		f.notify('item/started', {
			...scope,
			item: { id: 'cmd-1', type: 'commandExecution', command: 'pwd', status: 'inProgress' },
		});
		f.notify('item/commandExecution/outputDelta', {
			...scope,
			itemId: 'cmd-1',
			delta: '/tmp/project\n',
		});
		f.notify('item/completed', {
			...scope,
			item: {
				id: 'cmd-1',
				type: 'commandExecution',
				command: 'pwd',
				aggregatedOutput: '/tmp/project\n',
				exitCode: 0,
				status: 'completed',
			},
		});
		f.notify('item/completed', {
			...scope,
			item: { id: 'note-1', type: 'agentMessage', text: 'Checking', phase: 'commentary' },
		});
		f.notify('item/agentMessage/delta', { ...scope, itemId: 'answer-1', delta: 'Done' });
		f.notify('item/completed', {
			...scope,
			item: { id: 'answer-1', type: 'agentMessage', text: 'Done', phase: 'final_answer' },
		});
		f.notify('thread/tokenUsage/updated', {
			threadId: 'thread-1',
			tokenUsage: {
				last: { inputTokens: 5, cachedInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 1 },
			},
		});
		f.notify('turn/completed', { ...scope, turn: { id: 'turn-1', status: 'completed' } });
		expect(f.events).toContainEqual(
			expect.objectContaining({
				type: 'item.updated',
				item: expect.objectContaining({ aggregated_output: '/tmp/project\n' }),
			})
		);
		expect(f.events.filter((event) => event.payload?.phase === 'final_answer')).toHaveLength(1);
		expect(f.events).toContainEqual({
			type: 'turn.completed',
			usage: {
				input_tokens: 5,
				cached_input_tokens: 2,
				output_tokens: 3,
				reasoning_output_tokens: 1,
			},
		});
		expect(f.done).toHaveBeenCalledExactlyOnceWith(0);
	});

	it('routes a scoped approval once and replies only after the permission decision', async () => {
		let decide!: (value: 'accept') => void;
		const request = vi.fn(
			() =>
				new Promise<'accept'>((resolve) => {
					decide = resolve;
				})
		);
		const f = fixture({ onPermissionRequest: request });
		await f.start();
		const params = {
			threadId: 'thread-1',
			turnId: 'turn-1',
			itemId: 'cmd-1',
			command: 'pwd',
			cwd: '/tmp/project',
		};
		f.notify('item/commandExecution/requestApproval', params, 87);
		f.notify('item/commandExecution/requestApproval', params, 87);
		expect(request).toHaveBeenCalledTimes(1);
		expect(f.sent.filter((message) => message.id === 87)).toHaveLength(0);
		decide('accept');
		await settle();
		expect(f.sent.filter((message) => message.id === 87)).toEqual([
			{ id: 87, result: { decision: 'accept' } },
		]);
		f.session.dispose();
	});

	it('declines missing handlers and unknown or foreign approval requests', async () => {
		const f = fixture();
		await f.start();
		f.notify(
			'item/fileChange/requestApproval',
			{ threadId: 'thread-1', turnId: 'turn-1', itemId: 'file-1' },
			11
		);
		f.notify(
			'item/commandExecution/requestApproval',
			{ threadId: 'other', turnId: 'turn-1', itemId: 'cmd-1' },
			12
		);
		f.notify(
			'item/tool/requestUserInput',
			{ threadId: 'thread-1', turnId: 'turn-1', itemId: 'question' },
			13
		);
		await settle();
		expect(f.sent).toContainEqual({ id: 11, result: { decision: 'decline' } });
		expect(f.sent).toContainEqual(expect.objectContaining({ id: 12, error: expect.any(Object) }));
		expect(f.sent).toContainEqual(expect.objectContaining({ id: 13, error: expect.any(Object) }));
		f.session.dispose();
	});

	it('discards late approval after server resolution or disposal', async () => {
		let decide!: (value: 'accept') => void;
		const request = vi.fn(
			() =>
				new Promise<'accept'>((resolve) => {
					decide = resolve;
				})
		);
		const f = fixture({ onPermissionRequest: request });
		await f.start();
		f.notify(
			'item/commandExecution/requestApproval',
			{ threadId: 'thread-1', turnId: 'turn-1', itemId: 'cmd-1', command: 'pwd' },
			87
		);
		f.notify('serverRequest/resolved', { threadId: 'thread-1', requestId: 87 });
		decide('accept');
		await settle();
		expect(f.sent.filter((message) => message.id === 87)).toHaveLength(0);
		expect(f.resolved).toHaveBeenCalledWith(request.mock.calls[0][0].requestId);
		f.session.dispose();
	});

	it('steers the acknowledged turn and propagates rejection without resending', async () => {
		const f = fixture();
		await f.start();
		const accepted = f.session.steer('Additional instruction');
		expect(f.sent.at(-1).params).toEqual({
			threadId: 'thread-1',
			expectedTurnId: 'turn-1',
			input: [{ type: 'text', text: 'Additional instruction', text_elements: [] }],
		});
		f.reply('turn/steer', { turnId: 'turn-1' });
		await expect(accepted).resolves.toEqual({ turnId: 'turn-1' });
		const rejected = f.session.steer('Too late');
		const pending = f.sent.at(-1);
		f.session.handleData(
			JSON.stringify({ id: pending.id, error: { code: -32000, message: 'Turn changed' } }) + '\n'
		);
		await expect(rejected).rejects.toThrow('Turn changed');
		expect(f.sent.filter((message) => message.method === 'turn/steer')).toHaveLength(2);
		f.session.dispose();
	});

	it('buffers early events until the turn/start acknowledgement and rejects foreign turns', async () => {
		const f = fixture();
		void f.session.start();
		f.reply('initialize', {});
		await settle();
		f.reply('thread/start', { thread: { id: 'thread-1', status: { type: 'idle' } } });
		await settle();
		f.notify('item/completed', {
			threadId: 'thread-1',
			turnId: 'turn-1',
			item: { id: 'answer', type: 'agentMessage', text: 'early', phase: 'final_answer' },
		});
		f.notify('item/completed', {
			threadId: 'thread-1',
			turnId: 'other',
			item: { id: 'other-answer', type: 'agentMessage', text: 'foreign', phase: 'final_answer' },
		});
		expect(f.events.some((event) => event.payload?.message)).toBe(false);
		f.reply('turn/start', { turn: { id: 'turn-1' } });
		await settle();
		expect(
			f.events.filter((event) => event.payload?.message).map((event) => event.payload.message)
		).toEqual(['early']);
		f.session.dispose();
	});

	it('interrupts the exact turn, clears approvals and waits for completion', async () => {
		const cleanup = vi.fn();
		const f = fixture({ onDispose: cleanup });
		await f.start();
		f.session.interrupt();
		expect(f.sent.at(-1)).toMatchObject({
			method: 'turn/interrupt',
			params: { threadId: 'thread-1', turnId: 'turn-1' },
		});
		f.reply('turn/interrupt', {});
		await settle();
		expect(f.done).not.toHaveBeenCalled();
		expect(cleanup).toHaveBeenCalledTimes(1);
		await expect(f.session.steer('Too late')).rejects.toThrow();
		f.notify('turn/completed', {
			threadId: 'thread-1',
			turn: { id: 'turn-1', status: 'interrupted' },
		});
		expect(f.done).toHaveBeenCalledExactlyOnceWith(130);
	});

	it('never starts a turn when interrupted during initialization', async () => {
		const f = fixture();
		void f.session.start();
		f.session.interrupt();
		f.reply('initialize', {});
		await settle();
		expect(f.sent.some((message) => message.method === 'turn/start')).toBe(false);
		expect(f.done).toHaveBeenCalledExactlyOnceWith(130);
	});

	it('bounds RPC waits, rejects partial framing failures and never starts a fallback writer', async () => {
		vi.useFakeTimers();
		const f = fixture();
		void f.session.start();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(f.done).toHaveBeenCalledExactlyOnceWith(1);
		expect(f.sent.map((message) => message.method)).toEqual(['initialize']);
		const g = fixture();
		void g.session.start();
		g.session.handleData('not-json\n');
		await settle();
		expect(g.done).toHaveBeenCalledExactlyOnceWith(1);
	});
});

it('invalidates pending approval when its item completes without a resolved notification', async () => {
	let decide!: (decision: 'accept') => void;
	const f = fixture({
		onPermissionRequest: () =>
			new Promise<'accept'>((resolve) => {
				decide = resolve;
			}),
	});
	await f.start();
	const scope = { threadId: 'thread-1', turnId: 'turn-1' };
	f.notify('item/commandExecution/requestApproval', { ...scope, itemId: 'cmd', command: 'pwd' }, 9);
	f.notify('item/completed', {
		...scope,
		item: { id: 'cmd', type: 'commandExecution', status: 'declined' },
	});
	decide('accept');
	await settle();
	expect(f.sent.filter((message) => message.id === 9)).toEqual([]);
	expect(f.resolved).toHaveBeenCalledWith('number:9');
	f.session.dispose();
});

it('does not call an unknown completion status successful', async () => {
	const f = fixture();
	await f.start();
	f.notify('turn/completed', {
		threadId: 'thread-1',
		turn: { id: 'turn-1', status: 'unexpected' },
	});
	expect(f.done).toHaveBeenCalledExactlyOnceWith(1);
});

it('streams preview chunks separately and emits complete commentary once', async () => {
	const f = fixture();
	await f.start();
	const scope = { threadId: 'thread-1', turnId: 'turn-1' };
	f.notify('item/agentMessage/delta', { ...scope, itemId: 'note', delta: 'Checking ' });
	f.notify('item/agentMessage/delta', { ...scope, itemId: 'note', delta: 'files.' });
	expect(f.deltas.mock.calls).toEqual([['Checking '], ['files.']]);
	expect(f.events.filter((event) => event.payload?.phase === 'commentary')).toEqual([]);
	f.notify('item/completed', {
		...scope,
		item: { id: 'note', type: 'agentMessage', phase: 'commentary', text: 'Checking files.' },
	});
	expect(f.events.filter((event) => event.payload?.phase === 'commentary')).toEqual([
		{
			type: 'event_msg',
			payload: { type: 'agent_message', phase: 'commentary', message: 'Checking files.' },
		},
	]);
	f.session.dispose();
});

it('maps scoped plan notifications into the existing task list event', async () => {
	const f = fixture();
	await f.start();
	try {
		const plan = [
			{ step: 'Inspect fixtures', status: 'completed' },
			{ step: 'Verify plan panel', status: 'inProgress' },
			{ step: 'Record results', status: 'pending' },
		];
		f.notify('turn/plan/updated', { threadId: 'other', turnId: 'turn-1', plan });
		f.notify('turn/plan/updated', { threadId: 'thread-1', turnId: 'old-turn', plan });
		f.notify('turn/plan/updated', { threadId: 'thread-1', plan });
		expect(f.events.filter((event) => event.type === 'response_item')).toEqual([]);
		f.notify('turn/plan/updated', {
			threadId: 'thread-1',
			turnId: 'turn-1',
			explanation: 'Synthetic plan',
			plan,
		});
		const input = {
			explanation: 'Synthetic plan',
			plan: plan.map((step) => ({
				...step,
				status: step.status === 'inProgress' ? 'in_progress' : step.status,
			})),
		};
		expect(f.events.filter((event) => event.type === 'response_item')).toEqual([
			{
				type: 'response_item',
				payload: {
					type: 'function_call',
					call_id: 'plan-turn-1',
					name: 'update_plan',
					arguments: JSON.stringify(input),
				},
			},
			{
				type: 'response_item',
				payload: {
					type: 'function_call_output',
					call_id: 'plan-turn-1',
					output: JSON.stringify({ status: 'completed', success: true }),
					status: 'completed',
					is_error: false,
				},
			},
		]);
		const count = f.events.length;
		f.notify('turn/plan/updated', {
			threadId: 'thread-1',
			turnId: 'turn-1',
			plan: [{ step: 'Broken', status: 'unknown' }],
		});
		expect(f.events).toHaveLength(count);
		f.notify('turn/plan/updated', {
			threadId: 'thread-1',
			turnId: 'turn-1',
			explanation: null,
			plan: [],
		});
		expect(f.events.at(-2).payload.call_id).toBe('plan-turn-1');
		expect(JSON.parse(f.events.at(-2).payload.arguments)).toEqual({ explanation: null, plan: [] });
	} finally {
		f.session.dispose();
	}
});
