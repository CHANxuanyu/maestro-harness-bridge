import React, { createRef, memo } from 'react';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { LogEntry } from '../../../../renderer/types';
import type { TerminalOutputProps } from '../../../../renderer/components/TerminalOutput/types';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { mockTheme } from '../../../helpers/mockTheme';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { formatElapsedTickerCompact } from '../../../../shared/duration';
import { getClaudeTokenMode } from '../../../../shared/claudeTokenMode';

vi.mock('../../../../shared/duration', async (original) => {
	const actual = await original<typeof import('../../../../shared/duration')>();
	return { ...actual, formatElapsedTickerCompact: vi.fn(actual.formatElapsedTickerCompact) };
});
vi.mock('../../../../shared/claudeTokenMode', async (original) => {
	const actual = await original<typeof import('../../../../shared/claudeTokenMode')>();
	return { ...actual, getClaudeTokenMode: vi.fn(actual.getClaudeTokenMode) };
});
vi.mock('../../../../renderer/components/TerminalOutput/components/LogItem', () => ({
	LogItem: memo(({ log, index }: { log: LogEntry; index: number }) => (
		<div data-log-id={log.id} data-log-index={index}>
			{log.text}
		</div>
	)),
}));
vi.mock('../../../../renderer/contexts/LayerStackContext', () => ({
	useLayerStack: () => ({
		registerLayer: vi.fn(),
		unregisterLayer: vi.fn(),
		updateLayerHandler: vi.fn(),
	}),
}));
vi.mock('../../../../renderer/hooks/agent/useTranscriptBackfill', () => ({
	useTranscriptBackfill: () => ({
		isLoading: false,
		reachedStart: true,
		error: null,
		loadEarlier: vi.fn(),
	}),
}));

import { TerminalOutput } from '../../../../renderer/components/TerminalOutput';

let idle: Map<number, () => void>;
let nextIdle: number;
beforeEach(() => {
	idle = new Map();
	nextIdle = 0;
	vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
		idle.set(++nextIdle, cb);
		return nextIdle;
	});
	vi.stubGlobal('cancelIdleCallback', (id: number) => idle.delete(id));
	useSettingsStore.setState({ newShell: true, sidebarNavigationMode: 'conversations' });
	vi.mocked(getClaudeTokenMode).mockClear();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function outputProps(session: TerminalOutputProps['session']): TerminalOutputProps {
	return {
		session,
		theme: mockTheme,
		fontFamily: 'monospace',
		activeFocus: 'main',
		outputSearchOpen: false,
		outputSearchQuery: '',
		outputSearchRegex: false,
		setOutputSearchOpen: vi.fn(),
		setOutputSearchQuery: vi.fn(),
		setOutputSearchRegex: vi.fn(),
		setActiveFocus: vi.fn(),
		setLightboxImage: vi.fn(),
		inputRef: createRef<HTMLTextAreaElement>(),
		logsEndRef: createRef<HTMLDivElement>(),
		maxOutputLines: 1000,
		markdownEditMode: false,
		setMarkdownEditMode: vi.fn(),
	};
}

it('builds row elements once while hydrating every history entry in order', () => {
	const count = Number(process.env.PERF_ROW_COUNT ?? 1000);
	const logs: LogEntry[] = Array.from({ length: count }, (_, i) => ({
		id: `message-${i}`,
		source: i % 2 ? 'stdout' : 'user',
		text: `Message ${i}`,
		timestamp: i * 1000,
	}));
	const session = createMockSession({
		id: 'perf-session',
		activeTabId: 'perf-tab',
		aiTabs: [createMockAITab({ id: 'perf-tab', logs })],
	});
	const props = outputProps(session);
	const started = performance.now();
	const view = render(<TerminalOutput {...props} />);
	expect(view.container.querySelectorAll('[data-log-id]')).toHaveLength(25);
	expect(vi.mocked(getClaudeTokenMode).mock.calls.length).toBeLessThanOrEqual(25);
	let ticks = 0;
	while (idle.size && ticks++ < count) {
		const [id, callback] = idle.entries().next().value!;
		idle.delete(id);
		act(callback);
	}
	const ids = Array.from(view.container.querySelectorAll('[data-log-id]'), (el) =>
		el.getAttribute('data-log-id')
	);
	expect(ids).toEqual(logs.map((log) => log.id));
	const constructions = vi.mocked(getClaudeTokenMode).mock.calls.length;
	console.info(JSON.stringify({ count, ticks, constructions, ms: performance.now() - started }));
	// One call per row element, independent of how many idle chunks have committed.
	expect(constructions).toBeLessThanOrEqual(count * 2);
	const nextLogs = logs.map((log, i) =>
		i === 0 ? { ...log, text: 'Corrected earliest message' } : log
	);
	view.rerender(
		<TerminalOutput
			{...props}
			session={{ ...session, aiTabs: [{ ...session.aiTabs[0], logs: nextLogs }] }}
		/>
	);
	expect(view.container.querySelector('[data-log-id="message-0"]')).toHaveTextContent(
		'Corrected earliest message'
	);
	vi.mocked(getClaudeTokenMode).mockClear();
	view.rerender(<TerminalOutput {...props} session={{ ...session, id: 'next-session' }} />);
	expect(view.container.querySelectorAll('[data-log-id]')).toHaveLength(25);
	expect(vi.mocked(getClaudeTokenMode).mock.calls.length).toBeLessThanOrEqual(25);
}, 60_000);

it.each([
	{ newShell: true, interim: false },
	{ newShell: true, interim: true },
	{ newShell: false, interim: true },
])(
	'bounds activity redraws with newShell=$newShell, interim=$interim',
	({ newShell, interim }) => {
		useSettingsStore.setState({ newShell });
		const logs: LogEntry[] = Array.from({ length: 1000 }, (_, turn) => [
			{
				id: `user-${turn}`,
				source: 'user' as const,
				text: `Question ${turn}`,
				timestamp: turn * 4000,
			},
			...(interim
				? [
						{
							id: `interim-${turn}`,
							source: 'stdout' as const,
							text: 'Before the tool',
							timestamp: turn * 4000 + 500,
						},
					]
				: []),
			{ id: `tool-${turn}`, source: 'tool' as const, text: 'Read', timestamp: turn * 4000 + 1000 },
			{
				id: `reply-${turn}`,
				source: 'stdout' as const,
				text: `Reply ${turn}`,
				timestamp: turn * 4000 + 2000,
			},
		]).flat();
		const session = createMockSession({
			id: 'stream-session',
			activeTabId: 'stream-tab',
			aiTabs: [createMockAITab({ id: 'stream-tab', logs })],
		});
		const props = outputProps(session);
		const view = render(<TerminalOutput {...props} />);
		let ticks = 0;
		while (idle.size && ticks++ < logs.length) {
			const [id, callback] = idle.entries().next().value!;
			idle.delete(id);
			act(callback);
		}
		expect(view.container.querySelectorAll('[data-feed-row="turn-activity"]')).toHaveLength(1000);
		vi.mocked(formatElapsedTickerCompact).mockClear();
		for (let batch = 0; batch < 15; batch++) {
			const nextLogs = [...logs.slice(0, -1), { ...logs.at(-1)!, text: `stream-${batch}` }];
			view.rerender(
				<TerminalOutput
					{...props}
					session={{ ...session, aiTabs: [{ ...session.aiTabs[0], logs: nextLogs }] }}
				/>
			);
		}
		expect(view.container.querySelector('[data-log-id="reply-999"]')).toHaveTextContent(
			'stream-14'
		);
		expect(vi.mocked(formatElapsedTickerCompact).mock.calls.length).toBe(newShell ? 0 : 15_000);
		const corrected = logs.map((log) =>
			log.id === 'tool-0'
				? { ...log, text: 'Corrected tool', metadata: { toolState: { status: 'error' as const } } }
				: log
		);
		view.rerender(
			<TerminalOutput
				{...props}
				session={{ ...session, aiTabs: [{ ...session.aiTabs[0], logs: corrected }] }}
			/>
		);
		const fold = view.container.querySelector(
			`[data-feed-row="turn-activity"][data-log-id="${interim ? 'interim-0' : 'tool-0'}"]`
		)!;
		expect(fold.querySelector('[data-tool-status="error"]')).not.toBeNull();
		fireEvent.click(fold.querySelector('button')!);
		expect(fold).toHaveTextContent('Corrected tool');
		const changedAgain = corrected.map((log) =>
			log.id === 'tool-0' ? { ...log, text: 'Updated while open' } : log
		);
		view.rerender(
			<TerminalOutput
				{...props}
				session={{ ...session, aiTabs: [{ ...session.aiTabs[0], logs: changedAgain }] }}
			/>
		);
		expect(fold).toHaveTextContent('Updated while open');
		fireEvent.click(fold.querySelector('button')!);
		expect(fold.querySelector('[data-turn-activity-steps]')).toBeNull();
	},
	60_000
);
