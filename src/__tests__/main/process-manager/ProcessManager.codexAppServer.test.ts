// @vitest-environment node
import { expect, it, vi } from 'vitest';
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('../../../main/process-manager/utils/commandKill', () => ({
	killPty: vi.fn(),
	killProcessTreeNow: vi.fn(),
}));
import { ProcessManager } from '../../../main/process-manager/ProcessManager';
import { killProcessTreeNow } from '../../../main/process-manager/utils/commandKill';

it('keeps the prototype writer registered until close after a force kill', () => {
	const manager = new ProcessManager();
	const controller = { dispose: vi.fn(), interrupt: vi.fn(), steer: vi.fn() };
	const child = { pid: 123, kill: vi.fn(), stdin: { write: vi.fn() } };
	const managed = {
		sessionId: 'fixture-ai-tab',
		toolType: 'codex',
		pid: 123,
		childProcess: child,
		codexAppServerController: controller,
	};
	(manager as any).processes.set(managed.sessionId, managed);
	expect(manager.write(managed.sessionId, 'unframed input')).toBe(false);
	expect(child.stdin.write).not.toHaveBeenCalled();
	expect(manager.interrupt(managed.sessionId)).toBe(true);
	expect(controller.interrupt).toHaveBeenCalledTimes(1);
	expect(child.kill).not.toHaveBeenCalled();
	expect(manager.kill(managed.sessionId)).toBe(true);
	expect(controller.dispose).toHaveBeenCalledTimes(1);
	expect(killProcessTreeNow).toHaveBeenCalledWith(
		123,
		expect.objectContaining({ sessionId: managed.sessionId })
	);
	expect(manager.get(managed.sessionId)).toBe(managed);
});
