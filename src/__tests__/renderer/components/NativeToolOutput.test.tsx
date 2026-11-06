import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
	ToolCallDetails,
	ToolCallFold,
} from '../../../renderer/components/TerminalOutput/components/ToolCallDetails';
import { mockTheme } from '../../helpers/mockTheme';
import { ToolBadge } from '../../../renderer/components/TerminalOutput/components/ToolBadge';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { compactToolOutput } from '../../../shared/toolOutput';
import type { LogEntry } from '../../../renderer/types';
import type { NativeToolOutputResult } from '../../../shared/nativeToolOutput';

const read = vi.fn();
vi.mock('../../../renderer/utils/clipboard', () => ({
	safeClipboardWrite: vi.fn().mockResolvedValue(true),
}));
import { safeClipboardWrite } from '../../../renderer/utils/clipboard';
const target = {
	provider: 'claude-code',
	projectPath: '/synthetic',
	ownerAgentId: 'owner',
	nativeSessionId: 'native',
};
const log: LogEntry = {
	id: 'tool-call-1',
	timestamp: 1,
	source: 'tool',
	text: 'Bash',
	metadata: {
		toolCallId: 'call-1',
		toolState: { status: 'completed', output: compactToolOutput('x'.repeat(9000)).output },
	},
};
it('offers the action on expanded live badges as well as native history folds', () => {
	render(<ToolBadge log={log} theme={mockTheme} nativeToolOutputTarget={target} />);
	expect(screen.getByRole('button', { name: /Show full output/ })).toBeInTheDocument();
	expect(read).not.toHaveBeenCalled();
});
beforeEach(() => {
	vi.clearAllMocks();
	useSettingsStore.setState({ newShell: true });
	window.maestro.agentSessions.toolOutput = read;
});

it('reads only after clicking, shows loading and releases the result when the card folds', async () => {
	let resolve!: (value: NativeToolOutputResult) => void;
	read.mockReturnValue(
		new Promise((r) => {
			resolve = r;
		})
	);
	render(
		<ToolCallFold
			log={log}
			theme={mockTheme}
			nativeToolOutputTarget={target}
			renderHeader={() => 'Bash'}
		/>
	);
	fireEvent.click(screen.getByRole('button', { name: /Show details/ }));
	expect(read).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: /Show full output/ }));
	expect(screen.getByRole('status')).toHaveTextContent(/Loading/);
	expect(read).toHaveBeenCalledWith(target, 'call-1');
	await act(async () =>
		resolve({ status: 'found', text: 'TAIL ERROR', totalBytes: 8000000, omittedBytes: 7999990 })
	);
	expect(screen.getByTestId('native-tool-output')).toHaveTextContent('TAIL ERROR');
	expect(screen.getByText(/7999990/)).toBeInTheDocument();
	await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy output' })));
	expect(safeClipboardWrite).toHaveBeenCalledWith('TAIL ERROR');
	fireEvent.click(screen.getByRole('button', { name: /Hide details/ }));
	expect(screen.queryByTestId('native-tool-output')).toBeNull();
	fireEvent.click(screen.getByRole('button', { name: /Show details/ }));
	expect(screen.queryByText('TAIL ERROR')).toBeNull();
	expect(read).toHaveBeenCalledTimes(1);
});

it.each(['classic', 'running', 'short', 'ssh'])('hides the full-output action for %s', (mode) => {
	if (mode === 'classic') useSettingsStore.setState({ newShell: false });
	const entry = {
		...log,
		metadata: {
			...log.metadata,
			toolState: {
				...log.metadata!.toolState,
				...(mode === 'running' ? { status: 'running' as const } : {}),
				...(mode === 'short' ? { output: 'ok' } : {}),
			},
		},
	};
	render(
		<ToolCallDetails
			log={entry}
			theme={mockTheme}
			nativeToolOutputTarget={{ ...target, ...(mode === 'ssh' ? { sshRemoteId: 'remote' } : {}) }}
		/>
	);
	expect(screen.queryByRole('button', { name: /Show full output/ })).toBeNull();
	expect(read).not.toHaveBeenCalled();
});

it('shows a missing-record message without replacing the cached preview', async () => {
	read.mockResolvedValue({ status: 'not-found' });
	render(<ToolCallDetails log={log} theme={mockTheme} nativeToolOutputTarget={target} />);
	fireEvent.click(screen.getByRole('button', { name: /Show full output/ }));
	expect(
		await screen.findByText('This output could not be found in the original record')
	).toBeInTheDocument();
	expect(log.metadata?.toolState?.output).toEqual(compactToolOutput('x'.repeat(9000)).output);
});
