import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openUrl } from '../../../renderer/utils/openUrl';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';

describe('local development links', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSettingsStore.setState({ newShell: true, useSystemBrowser: false });
		useSessionStore.setState({
			activeSessionId: 'owner',
			sessions: [
				createMockSession({
					id: 'owner',
					activeTabId: 'conversation',
					browserTabs: [],
					aiTabs: [createMockAITab({ id: 'conversation' }), createMockAITab({ id: 'other' })],
				}),
			],
		});
	});
	it.each(['http://localhost:5173/', 'http://127.0.0.1:8000/a', 'http://[::1]:3000/'])(
		'opens %s on the conversation panel',
		(url) => {
			openUrl(url);
			const session = useSessionStore.getState().sessions[0];
			expect(session.aiTabs[0].newShellPanel).toEqual({ tab: 'web', open: true, webUrl: url });
			expect(session.aiTabs[1].newShellPanel).toBeUndefined();
			expect(session.browserTabs).toEqual([]);
		}
	);
	it('keeps classic local links in the central browser', () => {
		useSettingsStore.setState({ newShell: false });
		openUrl('http://localhost:5173/');
		expect(useSessionStore.getState().sessions[0].browserTabs).toHaveLength(1);
		expect(useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel).toBeUndefined();
	});
	it.each(['https://example.com/', 'http://localhost.example.com/'])(
		'keeps external link behavior for %s',
		(url) => {
			openUrl(url);
			expect(useSessionStore.getState().sessions[0].browserTabs).toHaveLength(1);
		}
	);
});
