import { beforeEach, expect, it, vi } from 'vitest';
import { usePermissionRequestStore } from '../../../renderer/stores/permissionRequestStore';

beforeEach(() => {
	usePermissionRequestStore.setState({ queue: [] });
	window.maestro.process.respondPermission = vi.fn().mockResolvedValue(true);
});

it('dismisses only a resolved request without sending a second decision', () => {
	const store = usePermissionRequestStore.getState();
	for (const requestId of ['first', 'second'])
		store.enqueue({
			requestId,
			sessionId: 'owner-ai-tab',
			tabId: 'tab',
			toolName: 'Bash',
			input: { command: 'pwd' },
			createdAt: 1,
		});
	store.resolve('first');
	store.resolve('first');
	expect(usePermissionRequestStore.getState().queue.map((request) => request.requestId)).toEqual([
		'second',
	]);
	expect(window.maestro.process.respondPermission).not.toHaveBeenCalled();
});
