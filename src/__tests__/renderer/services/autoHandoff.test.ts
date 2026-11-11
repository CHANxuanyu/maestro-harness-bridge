import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	automaticHandoffCandidate,
	maybeAutoHandoff,
} from '../../../renderer/services/autoHandoff';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { projectSettingsKey } from '../../../shared/projectSettings';
import { createMockSession, createMockAITab } from '../../helpers';

const quota = {
	type: 'rate_limited' as const,
	message: 'quota',
	timestamp: 2,
	agentId: 'claude-code',
	recoverable: true,
};
const key = projectSettingsKey({ projectPath: '/tmp/project' });
const handoff = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	useSettingsStore.setState({
		newShell: true,
		projectSettings: { [key]: { autoHandoffTarget: 'target' } },
	});
	useSessionStore.setState({
		sessions: [
			createMockSession({
				id: 'source',
				cwd: '/tmp/project',
				projectRoot: '/tmp/project',
				aiTabs: [
					createMockAITab({
						id: 'tab',
						agentError: quota,
						logs: [{ id: 'turn', source: 'user', timestamp: 1, text: 'Failed request' }],
					}),
				],
			}),
			createMockSession({
				id: 'target',
				toolType: 'codex',
				cwd: '/tmp/project',
				projectRoot: '/tmp/project',
			}),
		],
	});
	window.maestro.context.handoff = handoff;
	handoff.mockResolvedValue({
		success: true,
		state: 'queued',
		agentId: 'target',
		tabId: 'recipient',
		targetAccount: '/tmp/account',
	});
	vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(true);
});

describe('automatic handoff policy', () => {
	it.each(['rate_limited', 'unknown'] as const)(
		'uses the existing limit classification for %s',
		async (type) => {
			useSessionStore.getState().updateSession('source', {
				aiTabs: [
					createMockAITab({
						id: 'tab',
						agentError: { ...quota, type, message: 'Your workspace is out of credits.' },
						logs: [{ id: 'turn', source: 'user', timestamp: 1, text: 'Failed request' }],
					}),
				],
			});
			await maybeAutoHandoff('source', 'tab');
			expect(handoff).toHaveBeenCalledTimes(1);
		}
	);

	it.each(['auth_expired', 'agent_crashed', 'network_error', 'token_exhaustion'] as const)(
		'does not hand off %s',
		async (type) => {
			expect(automaticHandoffCandidate('source', 'tab', { ...quota, type })).toBeNull();
		}
	);

	it.each(['off', 'classic', 'self', 'missing', 'host', 'project', 'recipient'] as const)(
		'does not hand off when %s',
		async (reason) => {
			if (reason === 'off') useSettingsStore.setState({ projectSettings: {} });
			if (reason === 'classic') useSettingsStore.setState({ newShell: false });
			if (reason === 'self' || reason === 'missing')
				useSettingsStore.setState({
					projectSettings: { [key]: { autoHandoffTarget: reason === 'self' ? 'source' : 'gone' } },
				});
			if (reason === 'host')
				useSessionStore.getState().updateSession('target', {
					sessionSshRemoteConfig: { enabled: true, remoteId: 'other' },
				});
			if (reason === 'project')
				useSessionStore.getState().updateSession('target', { projectRoot: '/tmp/other' });
			if (reason === 'recipient')
				useSessionStore.getState().updateSession('source', {
					aiTabs: [
						{
							...useSessionStore.getState().sessions[0].aiTabs[0],
							origin: {
								kind: 'handoff',
								automatic: true,
								sourceSessionId: 'original',
								sourceTabId: 'original-tab',
								sourceProvider: 'codex',
								createdAt: 0,
							},
						},
					],
				});
			await maybeAutoHandoff('source', 'tab');
			expect(handoff).not.toHaveBeenCalled();
		}
	);

	it('claims before awaiting persistence, survives rehydration and never duplicates a queued request', async () => {
		await Promise.all([maybeAutoHandoff('source', 'tab'), maybeAutoHandoff('source', 'tab')]);
		useSessionStore.setState({ sessions: structuredClone(useSessionStore.getState().sessions) });
		await maybeAutoHandoff('source', 'tab');
		expect(handoff).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(window.maestro.sessions.setMany).mock.calls[0][0][0].aiTabs[0]
				.autoHandoffAttemptedTurnId
		).toBe('turn');
	});

	it('keeps unavailable targets stopped and never retries a failed handoff', async () => {
		handoff.mockResolvedValue({ success: false, code: 'unavailable' });
		await maybeAutoHandoff('source', 'tab');
		await maybeAutoHandoff('source', 'tab');
		expect(handoff).toHaveBeenCalledTimes(1);
		expect(
			useSessionStore.getState().sessions[0].aiTabs[0].logs.some((log) => log.autoHandoff)
		).toBe(false);
	});

	it('does not send if the one-time marker cannot be saved', async () => {
		vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(false);
		await maybeAutoHandoff('source', 'tab');
		expect(handoff).not.toHaveBeenCalled();
	});
});
