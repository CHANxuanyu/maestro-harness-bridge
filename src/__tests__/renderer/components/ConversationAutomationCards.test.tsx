import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConversationAutomationCards } from '../../../renderer/components/ConversationAutomationCards';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { judgeAttempts } from '../../../shared/progressRules';
import type { ConversationAutomationState } from '../../../shared/conversationAutomation';
import { ConversationCheckDelivery } from '../../../renderer/components/ConversationCheckDelivery';
import { useConversationAutomationStore } from '../../../renderer/stores/conversationAutomationStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { FollowUpsPanel } from '../../../renderer/components/FollowUpsPanel';
import { ChecksPanel } from '../../../renderer/components/ChecksPanel';
import { createMockAITab, createMockSession } from '../../helpers';

describe('conversation automation cards', () => {
	let state: ConversationAutomationState;
	beforeEach(() => {
		useSettingsStore.setState({ uiLanguage: 'en' });
		useConversationAutomationStore.getState().replace([]);
		useSessionStore.setState({ sessions: [] });
		state = {
			target: { kind: 'conversation', sessionId: 's', tabId: 't' },
			project: '/project',
			cwd: '/project',
			host: { kind: 'local' },
			projectAuthorized: false,
			checks: [{ id: 'c', command: 'true' }],
			batches: [],
			fix: 'ask',
			attempts: [],
			initialFailures: [],
			progress: judgeAttempts([], []),
			followUps: [],
			deliveries: [],
			notes: [],
		};
	});
	it.each(['en', 'zh-CN'] as const)(
		'has one expiry decision, readable limits and a panel link in %s',
		(locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			state.checks = [];
			state.startedAt = 0;
			state.deadline = 6000;
			state.expired = true;
			state.stopped = true;
			state.expiryReport = { passed: 0, total: 0, recommendation: 'extend', observations: [] };
			state.followUps = [
				{
					id: 'follow',
					target: state.target,
					createdAt: 0,
					reason: 'Inspect CI',
					condition: { kind: 'ci', runId: '1', cwd: state.cwd },
					waitLimitMs: 1000,
					deadline: 6000,
					state: 'fired',
					externalStatus: { state: 'waiting', observedAt: 6000 },
					fire: { kind: 'expired', at: 6000, late: false },
				},
			];
			useConversationAutomationStore.getState().replace([state]);
			useSessionStore.setState({
				sessions: [
					createMockSession({
						id: 's',
						aiTabs: [
							createMockAITab({
								id: 't',
								logs: [
									{
										id: 'expiry-turn',
										source: 'user',
										timestamp: 6000,
										text: '[delivery:expiry:s:t:6000]',
									},
								],
							}),
						],
					}),
				],
			});
			render(
				<>
					<ConversationCheckDelivery sessionId="s" tabId="t" turnId="older-turn" />
					<ConversationCheckDelivery sessionId="s" tabId="t" turnId="expiry-turn" />
					<FollowUpsPanel target={state.target} cwd={state.cwd} />
					<ChecksPanel target={state.target} />
				</>
			);
			const card = screen.getByTestId('follow-up-expiry');
			expect(screen.getAllByTestId('follow-up-expiry')).toHaveLength(1);
			expect(card).toHaveTextContent(
				locale === 'en' ? 'Used 6 s; total 6 s' : '已用 6 秒，总时限 6 秒'
			);
			const panel = within(screen.getByTestId('follow-ups-panel'));
			expect(
				panel.getByRole('option', { name: locale === 'en' ? '6 s' : '6 秒' })
			).toBeInTheDocument();
			expect(
				panel.getByRole('option', { name: locale === 'en' ? '2 hours' : '2 小时' })
			).toBeInTheDocument();
			expect(screen.getByTestId('follow-up-card')).toHaveTextContent(
				locale === 'en' ? '1 s.' : '1 秒'
			);
			expect(panel.getByText(locale === 'en' ? 'Expired' : '已到期')).toBeInTheDocument();
			expect(
				panel.queryByRole('button', { name: locale === 'en' ? 'Extend 1 hour' : '延长 1 小时' })
			).toBeNull();
			expect(
				screen.getAllByRole('button', { name: locale === 'en' ? 'Extend 1 hour' : '延长 1 小时' })
			).toHaveLength(1);
			expect(document.body.textContent).not.toMatch(/0\.001|0\/0|No check list|Assistant claims/);
			expect(document.querySelector('[data-check-status]')).toBeNull();
			card.scrollIntoView = vi.fn();
			fireEvent.click(
				panel.getByRole('button', {
					name: locale === 'en' ? 'View expiry decision in conversation' : '在对话中查看到期处理',
				})
			);
			expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
			expect(document.activeElement).toBe(card);
		}
	);
	it('shows no result without a check list, and never treats not-run as app-passed', () => {
		state.checks = [];
		useConversationAutomationStore.getState().replace([state]);
		const { container, rerender } = render(
			<ConversationCheckDelivery sessionId="s" tabId="t" turnId="turn" />
		);
		expect(container.textContent).toBe('');
		state.checks = [{ id: 'check', command: 'missing-command' }];
		state.projectAuthorized = true;
		state.batches = [
			{
				id: 'batch',
				turnId: 'turn',
				revision: 'head',
				fingerprint: 'diff',
				createdAt: 1,
				checks: [
					{
						id: 'check',
						command: 'missing-command',
						cwd: state.cwd,
						host: state.host,
						startedAt: 1,
						endedAt: 2,
						outcome: 'not-run',
						exitCode: null,
						outputTail: '',
						error: 'Could not start',
						truncated: false,
					},
				],
			},
		];
		useConversationAutomationStore.getState().replace([state]);
		rerender(<ConversationCheckDelivery sessionId="s" tabId="t" turnId="turn" />);
		expect(screen.getByRole('button', { name: 'Not run' })).toHaveAttribute(
			'data-check-status',
			'unverified'
		);
		expect(container.textContent).not.toContain('passed');
	});
	it('shows the app failure and not-run evidence even beside an assistant success claim', () => {
		state.batches = [
			{
				id: 'batch',
				turnId: 'turn',
				revision: 'head',
				fingerprint: 'diff',
				createdAt: 1,
				checks: (['pass', 'fail', 'not-run'] as const).map((outcome, index) => ({
					id: `check-${index}`,
					command: `check ${index}`,
					cwd: state.cwd,
					host: state.host,
					startedAt: 1,
					endedAt: 2,
					outcome,
					exitCode: outcome === 'pass' ? 0 : outcome === 'fail' ? 1 : null,
					outputTail: outcome === 'fail' ? 'APP_ERROR_TAIL' : '',
					error: outcome === 'not-run' ? 'Could not start' : undefined,
					truncated: false,
				})),
			},
		];
		useConversationAutomationStore.getState().replace([state]);
		render(
			<>
				<p>Assistant: all checks passed</p>
				<ConversationCheckDelivery sessionId="s" tabId="t" turnId="turn" />
			</>
		);
		expect(
			screen.getByRole('button', { name: /1\/3 passed/ }).getAttribute('data-check-status')
		).toBe('failed');
		expect(screen.getByTestId('conversation-check-delivery').textContent).toContain(
			'APP_ERROR_TAIL'
		);
		expect(screen.getByTestId('conversation-check-delivery').textContent).toContain('Not run');
	});
	it('offers the project grant once, and outside commands get a specific one-use choice', () => {
		const act = vi.fn(async () => {});
		const { rerender } = render(<ConversationAutomationCards state={state} act={act} />);
		fireEvent.click(screen.getByRole('button', { name: 'Allow for this project' }));
		expect(act).toHaveBeenCalledWith({ action: 'authorize', choice: 'project' });
		rerender(
			<ConversationAutomationCards
				state={{
					...state,
					projectAuthorized: true,
					checks: [{ id: 'outside', command: 'cat ../private', boundary: 'outside-project' }],
				}}
				act={act}
			/>
		);
		expect(screen.queryByTestId('checks-project-permission')).toBeNull();
		expect(screen.getByTestId('checks-scope-request').textContent).toContain('cat ../private');
		expect(screen.getByRole('button', { name: 'Only this once' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Do not add' })).toBeTruthy();
	});
	it('shows the prototype ledger columns, basis, difference, result and repeat judgement', () => {
		const attempts = [
			{
				id: 'a',
				fingerprint: 'patch',
				failures: ['fail'],
				basis: 'Observed error',
				difference: 'Changed import',
				expectation: 'Compiler passes',
			},
			{
				id: 'b',
				fingerprint: 'patch',
				failures: ['fail'],
				basis: 'Renamed proposal',
				difference: 'Same import',
				expectation: 'Compiler passes',
			},
		];
		render(
			<ConversationAutomationCards
				state={{
					...state,
					projectAuthorized: true,
					attempts,
					progress: judgeAttempts(['fail'], attempts),
				}}
				act={vi.fn()}
			/>
		);
		for (const label of ['Attempt', 'What changed', 'Result', 'Progress'])
			expect(screen.getByRole('columnheader', { name: label })).toBeTruthy();
		expect(screen.getByText('Repeat; no progress')).toBeTruthy();
		expect(screen.getByText('Basis: Observed error')).toBeTruthy();
		expect(screen.queryByTestId('checks-boundary-card')).toBeNull();
	});
	it.each(['en', 'zh-CN'] as const)(
		'uses localized shared durations in the ledger in %s',
		(locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			const attempts = [
				{
					id: 'attempt',
					fingerprint: 'patch',
					failures: ['error'],
					basis: 'Observed error',
					difference: 'Changed import',
					expectation: 'Compiler passes',
				},
			];
			render(
				<ConversationAutomationCards
					state={{
						...state,
						projectAuthorized: true,
						startedAt: 0,
						pausedAt: 6000,
						deadline: 7200000,
						attempts,
						progress: judgeAttempts(['error'], attempts),
					}}
					act={vi.fn()}
				/>
			);
			expect(
				screen.getByText(locale === 'en' ? 'Used 6 s; total 2 hours' : '已用 6 秒，总时限 2 小时')
			).toBeInTheDocument();
		}
	);
	it('renders expiry in Chinese with a report and specific extend/stop choices', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		render(
			<ConversationAutomationCards
				state={{
					...state,
					projectAuthorized: true,
					expired: true,
					stopped: true,
					expiryReport: { passed: 1, total: 2, observations: [], recommendation: 'review' },
				}}
				act={vi.fn()}
			/>
		);
		expect(screen.getByText('已停止：未完成')).toBeTruthy();
		expect(screen.getByRole('button', { name: '延长 1 小时' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '不再跟进' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '继续' })).toBeNull();
	});
});
