/**
 * permissionRequestStore - Zustand store for Claude Code standard-mode
 * permission prompts.
 *
 * When Claude Code runs in `standard` permission mode (API/print path), the
 * main-process relay forwards each tool-permission request here via
 * `window.maestro.process.onPermissionRequest`. The PermissionPrompt modal
 * renders the head of the queue; the user's decision is sent back through
 * `window.maestro.process.respondPermission`.
 *
 * Requests are queued (one prompt shown at a time) and answered FIFO.
 */

import { create } from 'zustand';

/** One selectable option within an AskUserQuestion question. */
export interface QuestionOptionUI {
	label: string;
	description?: string;
}

/** A single parsed AskUserQuestion question (mirrors the main-process shape). */
export interface ParsedQuestionUI {
	question: string;
	header?: string;
	options: QuestionOptionUI[];
	multiSelect: boolean;
}

export interface PermissionRequestUI {
	requestId: string;
	sessionId: string;
	tabId?: string;
	cwd?: string;
	toolName: string;
	input: Record<string, unknown>;
	createdAt: number;
	/** 'question' for AskUserQuestion; absent for ordinary allow/deny requests. */
	kind?: 'question';
	/** Parsed questions; present only when `kind === 'question'`. */
	questions?: ParsedQuestionUI[];
}

export type PermissionDecision =
	| { behavior: 'allow'; updatedInput?: Record<string, unknown> }
	| { behavior: 'deny'; message: string };

interface PermissionRequestState {
	queue: PermissionRequestUI[];
	responding: string[];
	failed: string[];
	/** Add a request to the queue (from the IPC listener). */
	enqueue: (request: PermissionRequestUI) => void;
	/** Answer a request: send the decision to main, then dequeue it. */
	respond: (requestId: string, decision: PermissionDecision) => Promise<void>;
	/** Remove a request settled by main, including timeout or another window. */
	resolve: (requestId: string) => void;
	/** Drop all requests for a session (e.g. when its process exits). */
	clearSession: (sessionId: string) => void;
}

/**
 * Send a decision to the main-process relay. Errors are swallowed (logged) so
 * an IPC rejection doesn't surface as an unhandled promise rejection - the
 * relay's ~300s auto-deny timeout is the backstop if a decision never lands.
 */
function sendDecision(requestId: string, decision: PermissionDecision): void {
	void window.maestro?.process?.respondPermission?.(requestId, decision)?.catch((err: unknown) => {
		console.error('[permissionRequestStore] respondPermission failed', requestId, err);
	});
}

export const usePermissionRequestStore = create<PermissionRequestState>((set, get) => ({
	queue: [],
	responding: [],
	failed: [],
	enqueue: (request) =>
		set((state) => {
			// Ignore duplicates (defensive against double-delivery).
			if (state.queue.some((r) => r.requestId === request.requestId)) {
				return state;
			}
			return { queue: [...state.queue, request] };
		}),
	respond: async (requestId, decision) => {
		if (get().responding.includes(requestId) || !get().queue.some((r) => r.requestId === requestId))
			return;
		set((state) => ({
			responding: [...state.responding, requestId],
			failed: state.failed.filter((id) => id !== requestId),
		}));
		try {
			if (!window.maestro?.process?.respondPermission)
				throw new Error('Permission bridge unavailable');
			// A false acknowledgement means main already settled the request.
			await window.maestro.process.respondPermission(requestId, decision);
			get().resolve(requestId);
		} catch (error) {
			console.error('[permissionRequestStore] respondPermission failed', requestId, error);
			set((state) => ({
				responding: state.responding.filter((id) => id !== requestId),
				failed: state.queue.some((r) => r.requestId === requestId)
					? [...state.failed, requestId]
					: state.failed,
			}));
		}
	},
	resolve: (requestId) =>
		set((state) => ({
			queue: state.queue.filter((r) => r.requestId !== requestId),
			responding: state.responding.filter((id) => id !== requestId),
			failed: state.failed.filter((id) => id !== requestId),
		})),
	clearSession: (sessionId) =>
		set((state) => {
			// Explicitly deny any queued requests for the exiting session so the
			// awaiting bridge call unblocks immediately, rather than waiting on the
			// main-side exit cleanup or the ~300s registry timeout. Denying an
			// already-resolved request is a harmless no-op in the registry.
			for (const r of state.queue) {
				if (r.sessionId === sessionId) {
					sendDecision(r.requestId, { behavior: 'deny', message: 'Agent exited.' });
				}
			}
			const removed = state.queue.filter((r) => r.sessionId === sessionId).map((r) => r.requestId);
			return {
				queue: state.queue.filter((r) => r.sessionId !== sessionId),
				responding: state.responding.filter((id) => !removed.includes(id)),
				failed: state.failed.filter((id) => !removed.includes(id)),
			};
		}),
}));

/** Selector: the request currently shown (head of the queue), or undefined. */
export function selectActivePermissionRequest(
	state: PermissionRequestState
): PermissionRequestUI | undefined {
	return state.queue[0];
}
