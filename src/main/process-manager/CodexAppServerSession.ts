import { compactToolOutput } from '../../shared/toolOutput';

// Keep the shared connector's item conversion as the single event mapping.
const { translateItem } = require('../../../scripts/codex-shared/shared-exec.cjs') as {
	translateItem: (item: Record<string, any>, complete: boolean) => Record<string, any>[];
};

export interface CodexAppServerApproval {
	requestId: string;
	method: string;
	threadId: string;
	turnId: string;
	itemId: string;
	command?: string;
	cwd?: string;
	reason?: string;
	changes?: unknown;
}

export interface CodexAppServerSettings {
	threadId?: string;
	model?: string;
	effort?: string;
	approvalPolicy: 'on-request' | 'never';
	sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
	writableRoots?: string[];
	onPermissionRequest?: (request: CodexAppServerApproval) => Promise<'accept' | 'decline'>;
	onPermissionResolved?: (requestId: string) => void;
	onDispose?: () => void;
}

interface Options {
	cwd: string;
	prompt: string;
	imagePaths: string[];
	settings: CodexAppServerSettings;
	send: (line: string) => void;
	onEvent: (event: unknown) => void;
	onTextDelta?: (text: string) => void;
	onDone: (code: number) => void;
}

interface WireMessage {
	id?: string | number;
	method?: string;
	params?: Record<string, any>;
	result?: any;
	error?: { message: string; code?: number };
}

/** One local stdio connection, one native turn, no reconnect or replay. */
export class CodexAppServerSession {
	private buffer = '';
	private nextId = 0;
	private closed = false;
	private stopping = false;
	private permissionsClosed = false;
	private startingTurn = false;
	private threadId?: string;
	private turnId?: string;
	private stopTimer?: ReturnType<typeof setTimeout>;
	private pending = new Map<
		string | number,
		{
			resolve: (result: any) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private early: WireMessage[] = [];
	private approvals = new Map<string, { id: string | number; itemId: string }>();
	private seenRequests = new Set<string>();
	private items = new Map<string, Record<string, any>>();
	private completed = new Set<string>();
	private lastUsage?: Record<string, number>;

	constructor(private options: Options) {}

	async start(): Promise<void> {
		try {
			await this.request('initialize', {
				clientInfo: { name: 'maestro_app_server_prototype', title: 'Maestro', version: '0.1' },
				capabilities: { experimentalApi: false },
			});
			if (this.closed || this.stopping) return;
			this.send({ method: 'initialized' });
			const { settings, cwd, prompt, imagePaths } = this.options;
			const result = await this.request(settings.threadId ? 'thread/resume' : 'thread/start', {
				...(settings.threadId ? { threadId: settings.threadId, excludeTurns: true } : {}),
				cwd,
				model: settings.model,
				approvalPolicy: settings.approvalPolicy,
				sandbox: settings.sandbox,
			});
			if (this.closed || this.stopping) return;
			if (
				!result?.thread?.id ||
				result.thread.status?.type !== 'idle' ||
				(settings.threadId && result.thread.id !== settings.threadId)
			) {
				throw new Error('Codex did not return the requested idle thread');
			}
			this.threadId = result.thread.id;
			this.options.onEvent({ type: 'thread.started', thread_id: this.threadId });
			this.options.onEvent({
				type: 'turn_context',
				payload: { model: result.model || settings.model },
			});
			const sandboxPolicy =
				settings.sandbox === 'read-only'
					? { type: 'readOnly', networkAccess: false }
					: settings.sandbox === 'danger-full-access'
						? { type: 'dangerFullAccess' }
						: {
								type: 'workspaceWrite',
								writableRoots: settings.writableRoots || [],
								networkAccess: false,
								excludeTmpdirEnvVar: false,
								excludeSlashTmp: false,
							};
			this.startingTurn = true;
			const started = await this.request('turn/start', {
				threadId: this.threadId,
				cwd,
				input: [
					{ type: 'text', text: prompt, text_elements: [] },
					...imagePaths.map((path) => ({ type: 'localImage', path })),
				],
				model: settings.model,
				effort: settings.effort,
				approvalPolicy: settings.approvalPolicy,
				sandboxPolicy,
			});
			if (this.closed) return;
			if (!started?.turn?.id) throw new Error('Codex did not acknowledge a turn');
			this.turnId = started.turn.id;
			this.startingTurn = false;
			for (const event of this.early.splice(0)) this.handleMessage(event);
			if (this.stopping && !this.closed) this.sendInterrupt();
		} catch (error) {
			this.fail(error);
		}
	}

	handleData(data: string): void {
		if (this.closed) return;
		this.buffer += data;
		try {
			let end: number;
			while (!this.closed && (end = this.buffer.indexOf('\n')) >= 0) {
				if (end > 16 * 1024 * 1024) throw new Error('Codex RPC frame is too large');
				const line = this.buffer.slice(0, end).trim();
				this.buffer = this.buffer.slice(end + 1);
				if (line) this.handleMessage(JSON.parse(line));
			}
			if (this.buffer.length > 16 * 1024 * 1024) throw new Error('Codex RPC frame is too large');
		} catch (error) {
			this.fail(error);
		}
	}

	async steer(text: string): Promise<{ turnId: string }> {
		if (this.closed || this.stopping || !this.turnId || !text.trim()) {
			throw new Error('No active Codex app-server turn');
		}
		const expectedTurnId = this.turnId;
		const result = await this.request('turn/steer', {
			threadId: this.threadId,
			expectedTurnId,
			input: [{ type: 'text', text, text_elements: [] }],
		});
		if (result?.turnId !== expectedTurnId) throw new Error('Codex acknowledged a different turn');
		return { turnId: result.turnId };
	}

	interrupt(): void {
		if (this.closed || this.stopping) return;
		this.stopping = true;
		this.closePermissions();
		if (this.turnId) this.sendInterrupt();
		else if (!this.startingTurn) this.finish(130);
		// A turn/start in flight may already be executing. Await its exact ID.
	}

	private sendInterrupt(): void {
		this.stopTimer = setTimeout(() => this.finish(130), 5000);
		this.stopTimer.unref?.();
		void this.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }).catch(
			(error) => this.fail(error)
		);
	}

	dispose(): void {
		if (this.closed) return;
		this.closed = true;
		clearTimeout(this.stopTimer);
		this.closePermissions();
		for (const entry of this.pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(new Error('Codex app-server connection closed'));
		}
		this.pending.clear();
		this.items.clear();
		this.early = [];
		this.buffer = '';
	}

	private send(message: WireMessage): void {
		if (!this.closed) this.options.send(JSON.stringify(message) + '\n');
	}

	private request(method: string, params: Record<string, unknown>): Promise<any> {
		if (this.closed) return Promise.reject(new Error('Codex app-server connection closed'));
		return new Promise((resolve, reject) => {
			const id = `maestro:${++this.nextId}`;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out; outcome is unknown`));
			}, 20_000);
			timer.unref?.();
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.send({ id, method, params });
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(error);
			}
		});
	}

	private handleMessage(message: WireMessage): void {
		if (!message || typeof message !== 'object') throw new Error('Invalid Codex RPC message');
		if (message.id != null && !message.method) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.pending.delete(message.id);
			if (message.error) pending.reject(new Error(message.error.message));
			else pending.resolve(message.result);
			return;
		}
		const p = message.params || {};
		if (!this.turnId && this.startingTurn && p.threadId === this.threadId) {
			if (this.early.length >= 1024) throw new Error('Too many early Codex events');
			this.early.push(message);
			return;
		}
		if (message.id != null) {
			this.approve(message);
			return;
		}
		if (p.threadId !== this.threadId || !this.turnId) return;
		const eventTurn = p.turnId || p.turn?.id;
		if (eventTurn && eventTurn !== this.turnId) return;
		if (message.method === 'serverRequest/resolved') {
			const key = `${typeof p.requestId}:${p.requestId}`;
			this.approvals.delete(key);
			this.options.settings.onPermissionResolved?.(key);
		} else if (message.method === 'item/started' || message.method === 'item/completed') {
			if (eventTurn !== this.turnId || !p.item?.id || this.completed.has(p.item.id)) return;
			const complete = message.method === 'item/completed';
			this.items.set(p.item.id, p.item);
			if (complete) {
				this.completed.add(p.item.id);
				for (const [key, approval] of this.approvals) {
					if (approval.itemId !== p.item.id) continue;
					this.approvals.delete(key);
					this.options.settings.onPermissionResolved?.(key);
				}
			}
			for (const event of translateItem(p.item, complete)) this.options.onEvent(event);
		} else if (message.method === 'item/agentMessage/delta') {
			if (eventTurn !== this.turnId || !p.itemId || !p.delta || this.completed.has(p.itemId))
				return;
			// Existing preview chunks are transient; commentary is a complete message.
			this.options.onTextDelta?.(p.delta);
		} else if (message.method === 'item/commandExecution/outputDelta') {
			if (eventTurn !== this.turnId || this.completed.has(p.itemId)) return;
			const item = this.items.get(p.itemId);
			if (!item || typeof p.delta !== 'string') return;
			item.aggregatedOutput = compactToolOutput((item.aggregatedOutput || '') + p.delta).output;
			for (const event of translateItem(item, false))
				this.options.onEvent({ ...event, type: 'item.updated' });
		} else if (message.method === 'thread/tokenUsage/updated') {
			this.lastUsage = p.tokenUsage?.last;
		} else if (message.method === 'error' && !p.willRetry) {
			this.options.onEvent({ type: 'error', message: p.error?.message || 'Codex turn failed' });
		} else if (message.method === 'turn/completed' && eventTurn === this.turnId) {
			const usage = this.lastUsage;
			if (!['completed', 'interrupted', 'failed'].includes(p.turn.status)) {
				this.fail(new Error('Unknown Codex turn completion status'));
				return;
			}
			if (p.turn.status === 'failed') {
				this.options.onEvent({ type: 'turn.failed', error: p.turn.error });
				this.finish(1);
			} else {
				this.options.onEvent({
					type: 'turn.completed',
					usage: usage
						? {
								input_tokens: usage.inputTokens,
								cached_input_tokens: usage.cachedInputTokens,
								output_tokens: usage.outputTokens,
								reasoning_output_tokens: usage.reasoningOutputTokens,
							}
						: undefined,
				});
				this.finish(p.turn.status === 'interrupted' || this.stopping ? 130 : 0);
			}
		}
	}

	private approve(message: WireMessage): void {
		const { id, method, params: p = {} } = message;
		const key = `${typeof id}:${id}`;
		if (this.seenRequests.has(key)) return;
		if (this.seenRequests.size >= 4096) throw new Error('Too many Codex server requests');
		this.seenRequests.add(key);
		if (
			!this.turnId ||
			p.threadId !== this.threadId ||
			p.turnId !== this.turnId ||
			!p.itemId ||
			!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(
				method!
			)
		) {
			this.send({
				id,
				error: { message: 'Unsupported or out-of-scope Codex request', code: -32601 },
			} as WireMessage);
			return;
		}
		const changes = this.items.get(p.itemId)?.changes;
		const unsupported =
			p.networkApprovalContext ||
			p.additionalPermissions ||
			p.grantRoot ||
			(p.kind && p.kind !== 'command') ||
			(p.availableDecisions && !p.availableDecisions.includes('accept')) ||
			(method === 'item/commandExecution/requestApproval' && !p.command) ||
			(method === 'item/fileChange/requestApproval' && !changes);
		if (this.stopping || unsupported || !this.options.settings.onPermissionRequest) {
			this.send({ id, result: { decision: 'decline' } });
			return;
		}
		this.approvals.set(key, { id: id!, itemId: p.itemId });
		const request: CodexAppServerApproval = {
			requestId: key,
			method: method!,
			threadId: p.threadId,
			turnId: p.turnId,
			itemId: p.itemId,
			command: p.command,
			cwd: p.cwd,
			reason: p.reason,
			changes,
		};
		let decision: Promise<'accept' | 'decline'>;
		try {
			decision = this.options.settings.onPermissionRequest(request);
		} catch {
			decision = Promise.resolve('decline');
		}
		void decision
			.then(
				(decision) => {
					if (!this.approvals.delete(key) || this.closed) return;
					this.send({ id, result: { decision: decision === 'accept' ? 'accept' : 'decline' } });
				},
				() => {
					if (this.approvals.delete(key) && !this.closed)
						this.send({ id, result: { decision: 'decline' } });
				}
			)
			.catch((error) => this.fail(error));
	}

	private closePermissions(): void {
		if (this.permissionsClosed) return;
		this.permissionsClosed = true;
		for (const [key, { id }] of this.approvals) {
			this.options.settings.onPermissionResolved?.(key);
			this.send({ id, result: { decision: 'decline' } });
		}
		this.approvals.clear();
		this.options.settings.onDispose?.();
	}

	private fail(error: unknown): void {
		if (this.closed) return;
		this.options.onEvent({
			type: 'error',
			message: error instanceof Error ? error.message : String(error),
		});
		this.finish(this.stopping ? 130 : 1);
	}

	private finish(code: number): void {
		if (this.closed) return;
		this.dispose();
		this.options.onDone(code);
	}
}
