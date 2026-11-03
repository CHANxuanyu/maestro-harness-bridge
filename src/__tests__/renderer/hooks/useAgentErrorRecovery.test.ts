import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentErrorRecovery } from '../../../renderer/hooks';
import type { AgentError } from '../../../shared/types';

const baseError: AgentError = {
	type: 'auth_expired',
	message: 'Authentication required',
	recoverable: true,
	agentId: 'claude-code',
	timestamp: 1700000000000,
};

describe('useAgentErrorRecovery', () => {
	it('offers only a manual resume for an occupied session, never a blank replacement', () => {
		const onRetry = vi.fn();
		const { result } = renderHook(() =>
			useAgentErrorRecovery({
				error: { ...baseError, type: 'session_busy', agentId: 'codex' },
				agentId: 'codex',
				sessionId: 's1',
				onRetry,
				onRestartAgent: vi.fn(),
				onNewSession: vi.fn(),
			})
		);
		expect(result.current.recoveryActions.map((action) => action.id)).toEqual(['retry']);
		expect(result.current.recoveryActions[0].description).toContain('releases this session');
		act(() => result.current.recoveryActions[0].onClick());
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it('creates claude-code auth actions naming the login command, plus new session', () => {
		const onAuthenticate = vi.fn();
		const onNewSession = vi.fn();

		const { result } = renderHook(() =>
			useAgentErrorRecovery({
				error: baseError,
				agentId: 'claude-code',
				sessionId: 's1',
				onAuthenticate,
				onNewSession,
			})
		);

		const [authAction, newSessionAction] = result.current.recoveryActions;

		expect(authAction.id).toBe('authenticate');
		expect(authAction.label).toBe('Re-authenticate');
		// The login runs inside Maestro now, so the description names the command
		// rather than telling the user to go find a terminal.
		expect(authAction.description).toBe('Run "claude /login" here');
		expect(authAction.primary).toBe(true);
		expect(newSessionAction.id).toBe('new-session');

		act(() => {
			authAction.onClick();
			newSessionAction.onClick();
		});

		expect(onAuthenticate).toHaveBeenCalledTimes(1);
		expect(onNewSession).toHaveBeenCalledTimes(1);
	});

	it('offers restart + new session for agent crashes', () => {
		const onRestartAgent = vi.fn();
		const onNewSession = vi.fn();

		const { result } = renderHook(() =>
			useAgentErrorRecovery({
				error: { ...baseError, type: 'agent_crashed' },
				agentId: 'claude-code',
				sessionId: 's1',
				onRestartAgent,
				onNewSession,
			})
		);

		const [restartAction, newSessionAction] = result.current.recoveryActions;

		expect(restartAction.id).toBe('restart-agent');
		expect(restartAction.primary).toBe(true);
		expect(newSessionAction.id).toBe('new-session');

		act(() => {
			restartAction.onClick();
			newSessionAction.onClick();
		});

		expect(onRestartAgent).toHaveBeenCalledTimes(1);
		expect(onNewSession).toHaveBeenCalledTimes(1);
	});

	it('returns retry action for rate limits', () => {
		const onRetry = vi.fn();

		const { result } = renderHook(() =>
			useAgentErrorRecovery({
				error: { ...baseError, type: 'rate_limited' },
				agentId: 'claude-code',
				sessionId: 's1',
				onRetry,
			})
		);

		expect(result.current.recoveryActions).toHaveLength(1);
		expect(result.current.recoveryActions[0].id).toBe('retry');

		act(() => {
			result.current.recoveryActions[0].onClick();
		});

		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it('offers to continue with another AI after a limit or a lost login, and only then', () => {
		const onHandoff = vi.fn();
		const actions = (type: AgentError['type']) =>
			renderHook(() =>
				useAgentErrorRecovery({
					error: { ...baseError, type },
					agentId: 'claude-code',
					sessionId: 's1',
					onRetry: vi.fn(),
					onAuthenticate: vi.fn(),
					onNewSession: vi.fn(),
					onRestartAgent: vi.fn(),
					onHandoff,
				})
			).result.current.recoveryActions;

		// Never the primary action: the original remedy stays first.
		const limited = actions('rate_limited');
		expect(limited.map((action) => action.id)).toEqual(['retry', 'handoff']);
		expect(limited[1]).toMatchObject({ label: 'Continue with another AI' });
		expect(limited[1].primary).toBeFalsy();
		expect(actions('auth_expired').map((action) => action.id)).toEqual([
			'authenticate',
			'new-session',
			'handoff',
		]);
		for (const type of ['network_error', 'token_exhaustion', 'agent_crashed'] as const)
			expect(actions(type).map((action) => action.id)).not.toContain('handoff');

		act(() => limited[1].onClick());
		expect(onHandoff).toHaveBeenCalledTimes(1);
	});

	it('leaves the handoff out when the caller cannot hand this tab off', () => {
		const { result } = renderHook(() =>
			useAgentErrorRecovery({
				error: { ...baseError, type: 'rate_limited' },
				agentId: 'claude-code',
				sessionId: 's1',
				onRetry: vi.fn(),
			})
		);
		expect(result.current.recoveryActions.map((action) => action.id)).toEqual(['retry']);
	});
});
