import { createRef } from 'react';
import Convert from 'ansi-to-html';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LogItem } from '../../../renderer/components/TerminalOutput/components/LogItem';
import type { LogItemProps } from '../../../renderer/components/TerminalOutput/types';
import { foldTurnActivity } from '../../../renderer/components/TerminalOutput/utils/foldTurnActivity';
import { getTabDisplayName, markTabRunningQueuedItem } from '../../../renderer/utils/tabHelpers';
import { transcriptMessagesToLogEntries } from '../../../renderer/utils/transcriptMessages';
import { canAppendToLogEntry, isSelfContainedCard } from '../../../renderer/utils/logEntries';
import { conversationDisplayTitle } from '../../../renderer/utils/conversationTitle';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { embedSystemPromptInPrompt } from '../../../shared/embeddedSystemPrompt';
import { readConversationAutomationPrompt } from '../../../shared/conversationAutomationPrompt';
import type { LogEntry } from '../../../renderer/types';
import { createMockAITab, createMockSession } from '../../helpers';
import { mockTheme } from '../../helpers/mockTheme';

const deliveryId = 'follow:da2dab49-b018-43ee-afbc-7d3b3c8acee6';
const prompt = `[delivery:${deliveryId}]
[follow-up:da2dab49-b018-43ee-afbc-7d3b3c8acee6] Inspect the original CI result
Event: ready; condition: command.
Application observation: {"state":"completed","observedAt":7,"exitCode":1,"outputTail":"Build failed: missing import","conclusion":"failure","failingJob":"unit tests","privateId":"hidden"}
Continue this exact conversation using the observed result. Stay within the existing authorization and total time limit.`;

const props: Omit<LogItemProps, 'log'> = {
	index: 0,
	isTerminal: false,
	isAIMode: true,
	theme: mockTheme,
	fontFamily: 'monospace',
	maxOutputLines: 500,
	isExpanded: false,
	onToggleExpanded: vi.fn(),
	localFilterQuery: '',
	filterMode: { mode: 'include', regex: false },
	activeLocalFilter: null,
	onToggleLocalFilter: vi.fn(),
	onSetLocalFilterQuery: vi.fn(),
	onSetFilterMode: vi.fn(),
	onClearLocalFilter: vi.fn(),
	deleteConfirmLogId: null,
	onSetDeleteConfirmLogId: vi.fn(),
	scrollContainerRef: createRef<HTMLDivElement>(),
	setLightboxImage: vi.fn(),
	copyToClipboard: vi.fn(),
	ansiConverter: new Convert(),
	markdownEditMode: false,
	onToggleMarkdownEditMode: vi.fn(),
	bionifyReadingMode: false,
	bionifyIntensity: 1,
	bionifyAlgorithm: 'alternating',
	userMessageAlignment: 'right',
	isClaudeCode: false,
	isAdaptiveMode: false,
	showProviderModePill: false,
	sessionId: 'session',
	feedLayout: true,
};

beforeEach(() => useSettingsStore.setState({ newShell: true, uiLanguage: 'en' }));

describe('app-authored conversation turns', () => {
	it.each(['queue', 'native history', 'cached history'] as const)(
		'renders a self-contained marker from %s without changing the agent prompt',
		(source) => {
			const tab = createMockAITab({ id: 'tab', name: null, logs: [] });
			const session = createMockSession({ aiTabs: [tab], activeTabId: tab.id });
			const log: LogEntry =
				source === 'queue'
					? markTabRunningQueuedItem(
							tab,
							{
								id: 'queue-item',
								timestamp: 1,
								tabId: tab.id,
								type: 'message',
								text: prompt,
								exactTarget: true,
							},
							session
						).logs[0]
					: source === 'native history'
						? transcriptMessagesToLogEntries([
								{
									type: 'user',
									uuid: 'native-user',
									timestamp: '2026-01-01T00:00:00Z',
									content: embedSystemPromptInPrompt('# Context', prompt),
								},
							])[0]
						: { id: 'cached-user', timestamp: 1, source: 'user', text: prompt };
			expect(log.text).toBe(prompt);
			if (source !== 'cached history') expect(log.automationTurn?.kind).toBe('follow-up');
			expect(isSelfContainedCard(log)).toBe(true);
			expect(canAppendToLogEntry(log, 'user')).toBe(false);
			const folded = foldTurnActivity(
				[
					log,
					{ id: 'tool', timestamp: 2, source: 'tool', text: 'Bash' },
					{ id: 'reply', timestamp: 3, source: 'stdout', text: 'Observed failure' },
				],
				{ keepLastTurnOpen: false }
			);
			expect(folded.logs[0]).toBe(log);
			const { container } = render(<LogItem {...props} log={log} />);
			expect(screen.getByTestId('automation-turn-marker')).toHaveTextContent(
				'Follow-up: Inspect the original CI result'
			);
			expect(screen.queryByText('Exit code: 1')).toBeNull();
			fireEvent.click(screen.getByRole('button', { name: 'Observation' }));
			expect(screen.getByText('Exit code: 1')).toBeInTheDocument();
			expect(screen.getByText('CI conclusion: Failed')).toBeInTheDocument();
			expect(screen.getByText('Failing job: unit tests')).toBeInTheDocument();
			expect(screen.getByText('Build failed: missing import')).toBeInTheDocument();
			expect(container.textContent).not.toMatch(
				/delivery:|follow-up:|da2dab49|Application observation|observedAt|privateId|hidden|[{}]/
			);
			expect(screen.getAllByRole('button')).toHaveLength(1);
			fireEvent.click(screen.getByRole('button', { name: 'Observation' }));
			expect(screen.queryByText('Exit code: 1')).toBeNull();
		}
	);

	it('localizes late markers and queued CI observations', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		const text = `[delivery:follow:id]\n[follow-up:id] 检查原始 CI 结果\nEvent: wait-timeout; condition: ci.\nLate follow-up: the scheduled time passed while the app was closed.\nApplication observation: {"state":"waiting","observedAt":7,"status":"queued"}`;
		render(<LogItem {...props} log={{ id: 'late', timestamp: 1, source: 'user', text }} />);
		expect(screen.getByText('跟进到点：检查原始 CI 结果')).toBeInTheDocument();
		expect(screen.getByText('迟到的跟进')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: '查看结果' }));
		expect(screen.getByText('等待中')).toBeInTheDocument();
	});

	it('hides nested budget ids and the internal expiry report', () => {
		const text = `[delivery:expiry:session:tab:7]\n[follow-up:budget:["session","tab"]:7:uuid] Shared budget\nEvent: expired; condition: time.\nApplication observation: {"state":"waiting","observedAt":7}\nApplication report: {"status":"stopped-incomplete","internalId":"private"}`;
		const { container } = render(
			<LogItem {...props} log={{ id: 'expiry', timestamp: 1, source: 'user', text }} />
		);
		expect(screen.getByText('Total time limit reached')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Observation' }));
		expect(screen.getByText('Waiting')).toBeInTheDocument();
		expect(container.textContent).not.toMatch(
			/Shared budget|delivery:|session|uuid|Application report|private|[{}]/
		);
	});

	it.each([
		['[delivery:fix:uuid]\n[fix:uuid] Application checks: 0/1 passed.', 'App requested a repair'],
		[
			'[delivery:fix:uuid]\n[fix:uuid] Application checks: 0/1 passed.\nDiagnose why these attempts made no progress.',
			'App requested a diagnosis',
		],
		['[delivery:follow:uuid]\nApplication observation: {truncated', 'Follow-up'],
	])(
		'renders app markers for repair, diagnosis and truncated native records (%s)',
		(text, label) => {
			const { container } = render(
				<LogItem {...props} log={{ id: 'app', timestamp: 1, source: 'user', text }} />
			);
			expect(container.textContent).toBe(label);
		}
	);

	it('does not treat ordinary discussion of the envelope as an app turn', () => {
		expect(readConversationAutomationPrompt('Explain [delivery:follow:id] to me')).toBeUndefined();
	});

	it('ignores automation turns and native prompt titles, even before the first owner message', () => {
		const tab = createMockAITab({
			name: prompt.slice(0, 45),
			logs: [{ id: 'app', timestamp: 1, source: 'user', text: prompt }],
		});
		expect(conversationDisplayTitle(tab)).toBeNull();
		expect(getTabDisplayName(tab)).not.toMatch(/delivery:|expiry:/);
		tab.logs.push({
			id: 'owner',
			timestamp: 2,
			source: 'user',
			text: 'Repair CI for my project\nPlease inspect it.',
		});
		expect(conversationDisplayTitle(tab)).toBe('Repair CI for my project');
		expect(conversationDisplayTitle({ ...tab, name: 'My chosen title' })).toBe('My chosen title');
	});
});
