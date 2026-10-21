/**
 * The stream clear point in the REAL `useBatchedSessionUpdates` flush: when the
 * agent's answer starts streaming, what stays on screen.
 *
 * Conversation layout: the turn's tool calls (with their results) and its
 * progress rows stay; scratch reasoning may clear; the answer lands in its own
 * entry, never appended to a progress row. Agent layout: the original contract,
 * tool calls and reasoning are cleared as scratch state (progress still stays,
 * it is not scratch in either layout).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBatchedSessionUpdates } from '../../../renderer/hooks/session/useBatchedSessionUpdates';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { isProgressNoteEntry } from '../../../renderer/utils/transcriptMessages';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import type { LogEntry } from '../../../renderer/types';

const SESSION_ID = 'session-1';
const TAB_ID = 'tab-1';

function turnSoFar(): LogEntry[] {
	const now = Date.now();
	return [
		{ id: 'q', timestamp: now - 5000, source: 'user', text: 'Find the docs' },
		{ id: 'r', timestamp: now - 4000, source: 'thinking', text: 'Where would docs live?' },
		{
			id: 'p',
			timestamp: now - 3000,
			source: 'stdout',
			text: 'Checking the docs folder.',
			purpose: 'commentary',
		},
		{
			id: 'tool-call_1',
			timestamp: now - 2000,
			source: 'tool',
			text: 'exec_command',
			metadata: { toolState: { status: 'completed', input: { cmd: 'ls docs' }, output: 'a.md' } },
		},
		// Newest entry is the progress row again, inside the 500ms grouping window:
		// the answer must still not be appended to it.
		{
			id: 'p2',
			timestamp: now,
			source: 'stdout',
			text: 'Reading a.md.',
			purpose: 'commentary',
		},
	];
}

function seed(logs: LogEntry[]): void {
	useSessionStore.setState({
		sessions: [
			createMockSession({
				id: SESSION_ID,
				state: 'busy',
				activeTabId: TAB_ID,
				aiTabs: [createMockAITab({ id: TAB_ID, showThinking: 'on', logs })],
			}),
		],
		activeSessionId: SESSION_ID,
	});
}

function tabLogs(): LogEntry[] {
	return useSessionStore.getState().sessions[0].aiTabs[0].logs;
}

function streamAnswer() {
	const { result } = renderHook(() => useBatchedSessionUpdates());
	act(() => {
		result.current.appendLog(SESSION_ID, TAB_ID, true, 'Zen plan ');
		result.current.appendLog(SESSION_ID, TAB_ID, true, 'supports it.');
		result.current.flushNow();
	});
}

describe('useBatchedSessionUpdates stream clear point', () => {
	beforeEach(() => seed(turnSoFar()));

	it('keeps tool results and progress in the conversation layout; the answer is its own entry', () => {
		useSettingsStore.setState({ sidebarNavigationMode: 'conversations' });
		streamAnswer();

		const logs = tabLogs();
		expect(logs.map((l) => l.id)).not.toContain('r');
		const tool = logs.find((l) => l.id === 'tool-call_1')!;
		expect(tool.metadata?.toolState).toMatchObject({ status: 'completed', output: 'a.md' });
		expect(logs.filter(isProgressNoteEntry).map((l) => l.text)).toEqual([
			'Checking the docs folder.',
			'Reading a.md.',
		]);
		const answer = logs[logs.length - 1];
		expect(answer.text).toBe('Zen plan supports it.');
		expect(isProgressNoteEntry(answer)).toBe(false);
	});

	it('keeps clearing tool calls as scratch state in the agent layout', () => {
		useSettingsStore.setState({ sidebarNavigationMode: 'agents' });
		streamAnswer();

		const logs = tabLogs();
		expect(logs.some((l) => l.source === 'tool' || l.source === 'thinking')).toBe(false);
		expect(logs.filter(isProgressNoteEntry)).toHaveLength(2);
		expect(logs[logs.length - 1].text).toBe('Zen plan supports it.');
	});
});
