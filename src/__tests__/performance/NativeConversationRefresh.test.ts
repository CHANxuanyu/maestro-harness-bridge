import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { afterEach, expect, it, vi } from 'vitest';
import { createSession, appendTurn } from '../../../scripts/native-performance-fixtures.cjs';

const isolation = vi.hoisted(() => ({ home: '', userData: '' }));
const timing = vi.hoisted(() => ({
	enabled: false,
	convert: 0,
	reconcile: 0,
	bind: 0,
	merge: 0,
}));
vi.mock('os', async (original) => {
	const actual = await original<typeof import('os')>();
	return { ...actual, default: { ...actual, homedir: () => isolation.home } };
});
vi.mock('electron', () => ({ app: { getPath: () => isolation.userData } }));
vi.mock('electron-store', () => ({
	default: class {
		get = (_key: string, fallback: unknown) => fallback;
		set = () => {};
	},
}));
vi.mock('../../main/utils/logger', () => ({
	logger: { info() {}, warn() {}, error() {}, debug() {} },
}));
vi.mock('../../main/utils/sentry', () => ({ captureException() {} }));
vi.mock('../../main/agents/provider-account-dirs', () => ({
	getProviderAccountDirs: async () => [],
}));
vi.mock('../../main/utils/statsCache', () => ({
	encodeClaudeProjectPath: (project: string) => project.replace(/[^a-zA-Z0-9]/g, '-'),
}));
vi.mock('../../renderer/utils/transcriptMessages', async (original) => {
	const actual = await original<typeof import('../../renderer/utils/transcriptMessages')>();
	function measure<T>(name: 'convert' | 'reconcile' | 'bind' | 'merge', operation: () => T): T {
		if (!timing.enabled) return operation();
		const start = performance.now();
		try {
			return operation();
		} finally {
			timing[name] += performance.now() - start;
		}
	}
	return {
		...actual,
		transcriptMessagesToLogEntries: (
			...args: Parameters<typeof actual.transcriptMessagesToLogEntries>
		) => measure('convert', () => actual.transcriptMessagesToLogEntries(...args)),
		reconcileTranscriptEntries: (...args: Parameters<typeof actual.reconcileTranscriptEntries>) =>
			measure('reconcile', () => actual.reconcileTranscriptEntries(...args)),
		bindDelayedOwnSends: (...args: Parameters<typeof actual.bindDelayedOwnSends>) =>
			measure('bind', () => actual.bindDelayedOwnSends(...args)),
		mergeNewerEntries: (...args: Parameters<typeof actual.mergeNewerEntries>) =>
			measure('merge', () => actual.mergeNewerEntries(...args)),
	};
});

import { ClaudeSessionStorage } from '../../main/storage/claude-session-storage';
import { CodexSessionStorage } from '../../main/storage/codex-session-storage';
import { setSessionInfoCacheForTest } from '../../main/storage/session-info-cache';
import {
	refreshNativeConversation,
	resetNativeConversationRefreshes,
} from '../../renderer/services/refreshNativeConversation';
import { transcriptMessagesToLogEntries } from '../../renderer/utils/transcriptMessages';
import { useSessionStore } from '../../renderer/stores/sessionStore';
import { useRetryStore } from '../../renderer/stores/retryStore';
import { createMockSession } from '../helpers/mockSession';
import { createMockAITab } from '../helpers/mockTab';
import type { SessionMessagesResult } from '../../main/agents/session-storage';

// Existing continuous-follow and payload budgets, frozen before this baseline.
// Three planned samples, no retries. Actual storage, conversion, merging and
// Zustand update run here. Structured cloning models payload transfer; this
// does not measure Electron framing, renderer layout or paint.
const budgets = { refreshMs: 150, bytes: 1024 * 1024 };
let root: string;
afterEach(async () => {
	timing.enabled = false;
	resetNativeConversationRefreshes();
	useSessionStore.setState({ sessions: [] });
	useRetryStore.setState({ retries: {} });
	setSessionInfoCacheForTest('claude-code', null);
	if (root) await fs.rm(root, { recursive: true, force: true });
});

it.each(['codex', 'claude'] as const)(
	'%s refresh of a loaded 50k-message history',
	async (provider) => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-refresh-performance-'));
		isolation.home = path.join(root, 'home');
		isolation.userData = path.join(root, 'maestro');
		await fs.mkdir(isolation.userData, { recursive: true });
		const project = path.join(root, 'project');
		// The shared generator uses the pinned native Codex and Claude encoders,
		// with two tool calls per four visible messages. No native fields invented.
		const fixture = createSession(provider, path.join(root, 'account'), project, 50000);
		for (let sample = 0; sample < 3; sample++) {
			const storage = provider === 'codex' ? new CodexSessionStorage() : new ClaudeSessionStorage();
			const options = { configDir: fixture.configDir, readOnly: true };
			const initial = await storage.readSessionMessages(project, fixture.id, {
				...options,
				limit: 100000,
			});
			const logs = transcriptMessagesToLogEntries(initial.messages);
			expect(logs).toHaveLength(50000 + sample * 4);
			const tab = createMockAITab({
				id: 'perf-tab',
				agentSessionId: fixture.id,
				logs,
				inputValue: 'keep this draft',
			});
			useSessionStore.setState({
				sessions: [
					createMockSession({
						id: 'perf-owner',
						toolType: provider === 'codex' ? 'codex' : 'claude-code',
						cwd: project,
						projectRoot: project,
						aiTabs: [tab],
						activeTabId: tab.id,
					}),
				],
				activeSessionId: 'perf-owner',
			});
			useRetryStore.setState({ retries: {} });
			appendTurn(fixture, 50000 + sample);
			const before = await fs.stat(fixture.file);
			const payloads: SessionMessagesResult[] = [];
			const limits: number[] = [];
			let readMs = 0;
			window.maestro.agentSessions.read = vi.fn(async (_agent, _project, _id, requested) => {
				limits.push(requested!.limit!);
				const start = performance.now();
				const payload = await storage.readSessionMessages(project, fixture.id, {
					...requested,
					...options,
				});
				readMs += performance.now() - start;
				payloads.push(payload);
				return structuredClone(payload);
			});
			Object.assign(timing, { enabled: true, convert: 0, reconcile: 0, bind: 0, merge: 0 });
			const start = performance.now();
			const outcome = await refreshNativeConversation({ sessionId: 'perf-owner', tabId: tab.id });
			const totalMs = performance.now() - start;
			timing.enabled = false;
			const after = useSessionStore.getState().sessions[0].aiTabs[0];
			expect(outcome).toEqual({ status: 'updated', added: 4 });
			expect(after.logs).toHaveLength(logs.length + 4);
			expect(after.logs.slice(0, logs.length).every((entry, index) => entry === logs[index])).toBe(
				true
			);
			expect(after.inputValue).toBe(tab.inputValue);
			expect(after.agentSessionId).toBe(fixture.id);
			expect(after.logs.at(-1)?.text).toContain(`answer ${50000 + sample} `);
			const afterReads = await fs.stat(fixture.file);
			expect([afterReads.size, afterReads.mtimeMs, afterReads.ctimeMs]).toEqual([
				before.size,
				before.mtimeMs,
				before.ctimeMs,
			]);
			const jsonBytes = payloads.reduce(
				(sum, payload) => sum + Buffer.byteLength(JSON.stringify(payload)),
				0
			);
			const v8Bytes = payloads.reduce((sum, payload) => sum + serialize(payload).length, 0);
			const round = (value: number) => Math.round(value * 100) / 100;
			console.info(
				JSON.stringify({
					provider,
					sample,
					limits,
					jsonBytes,
					v8Bytes,
					readMs: round(readMs),
					convertMs: round(timing.convert),
					reconcileMs: round(timing.reconcile),
					bindMs: round(timing.bind),
					mergeMs: round(timing.merge),
					totalMs: round(totalMs),
				})
			);
			expect
				.soft(totalMs, `${provider}/${sample} complete refresh`)
				.toBeLessThanOrEqual(budgets.refreshMs);
			expect.soft(jsonBytes, `${provider}/${sample} JSON payload`).toBeLessThan(budgets.bytes);
			expect.soft(v8Bytes, `${provider}/${sample} V8 payload`).toBeLessThan(budgets.bytes);
		}
	},
	600000
);
