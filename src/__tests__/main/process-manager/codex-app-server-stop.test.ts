// @vitest-environment node
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ProcessManager } from '../../../main/process-manager/ProcessManager';
import {
	prepareCodexAppServerPermissions,
	listCodexAppServerPermissions,
} from '../../../main/permission-relay/codex-app-server';
import { relayRegistryStats } from '../../../main/permission-relay/registry';
import { CodexAppServerSession } from '../../../main/process-manager/CodexAppServerSession';

const { createNativeTempDir } = require('../../../../e2e/fixtures/native/temp-root.cjs');

vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('../../../main/coworking/coworking-socket-path', () => ({
	getBridgeSocketPath: () => '',
}));
vi.mock('../../../main/process-manager/utils/envBuilder', () => ({
	buildChildProcessEnv: (customEnvVars: Record<string, string>) => customEnvVars,
	collectMaestroEnvVars: () => ({}),
}));
vi.mock('../../../main/process-manager/utils/commandKill', () => ({
	// The synthetic peer has no descendants. Avoid the sandbox's unavailable ps.
	killProcessTreeNow: (pid: number) => process.kill(pid, 'SIGKILL'),
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));

it.each(['U5_HOLD for stop', 'file approval for stop'])(
	'settles %s through the shared interrupt, permission cleanup and process exit',
	async (prompt) => {
		const root = createNativeTempDir('maestro-u4-stop-');
		// What the session wrote to the peer. A pending approval is declined before the
		// interrupt, the synthetic peer can end the turn on that decline, and the process
		// may then exit before it reads the interrupt line, so the peer's own receipt log
		// cannot prove what Stop sent.
		const sent = vi.spyOn(
			CodexAppServerSession.prototype as unknown as {
				send: (message: { method?: string }) => void;
			},
			'send'
		);
		const manager = new ProcessManager();
		const send = vi.fn();
		const window = {
			isDestroyed: () => false,
			webContents: { id: 11, isDestroyed: () => false, send },
		};
		const permissions = prepareCodexAppServerPermissions({
			sessionId: 'owner-ai-tab',
			tabId: 'tab',
			getMainWindow: () => window as any,
		});
		vi.stubEnv('CODEX_HOME', root);
		const result = manager.spawn({
			sessionId: 'owner-ai-tab',
			tabId: 'tab',
			toolType: 'codex',
			cwd: root,
			command: process.execPath,
			args: [path.resolve('e2e/fixtures/native/codex-app-server'), 'app-server'],
			prompt,
			customEnvVars: { HOME: root, CODEX_HOME: root, MAESTRO_APP_SERVER_FIXTURE_ROOT: root },
			codexAppServer: { approvalPolicy: 'on-request', sandbox: 'workspace-write', ...permissions },
		});
		const managed = manager.get('owner-ai-tab')!;
		const child = managed.childProcess!;
		const closed = once(child, 'close');
		try {
			expect(result.success).toBe(true);
			await new Promise<void>((resolve) => {
				child.stdout!.on('data', (chunk) => {
					if (
						chunk
							.toString()
							.includes(prompt.startsWith('U5_HOLD') ? 'inProgress' : 'requestApproval')
					)
						resolve();
				});
			});
			const pending = listCodexAppServerPermissions({ webContentsId: 11 });
			expect(pending).toHaveLength(prompt.startsWith('U5_HOLD') ? 0 : 1);
			const exited = once(manager, 'exit', { signal: AbortSignal.timeout(3000) });
			expect(manager.interrupt('owner-ai-tab')).toBe(true);
			expect(await exited).toEqual(['owner-ai-tab', 130, undefined, true]);
			expect(manager.getAll()).toEqual([]);
			expect(listCodexAppServerPermissions({ webContentsId: 11 })).toEqual([]);
			expect(relayRegistryStats()).toEqual({ bindings: 0, pending: 0 });
			for (const request of pending) {
				expect(
					send.mock.calls.filter(
						([channel, id]) => channel === 'process:permission-resolved' && id === request.requestId
					)
				).toHaveLength(1);
			}
			expect(fs.existsSync(path.join(root, 'approved.txt'))).toBe(false);
			expect(
				sent.mock.calls.filter(([message]) => message.method === 'turn/interrupt')
			).toHaveLength(1);
		} finally {
			sent.mockRestore();
			managed.codexAppServerController!.dispose();
			child.kill('SIGKILL');
			await closed;
			permissions.onDispose();
			vi.unstubAllEnvs();
			fs.rmSync(root, { recursive: true, force: true });
		}
	}
);
