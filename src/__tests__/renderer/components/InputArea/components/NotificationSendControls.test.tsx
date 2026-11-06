import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../../../../renderer/stores/settingsStore';
import { NotificationSendControls } from '../../../../../renderer/components/InputArea/components/NotificationSendControls';
import { inputAreaTheme } from '../_fixtures';

vi.mock('../../../../../renderer/components/NotificationPopover', () => ({
	NotificationPopover: vi.fn(({ onClose }) => (
		<div data-testid="notification-popover">
			<button onClick={onClose}>Close</button>
		</div>
	)),
}));

describe('NotificationSendControls', () => {
	beforeEach(() => useSettingsStore.setState({ newShell: false }));
	it.each([false, true])('gates the composer bell while keeping Send, new shell %s', (newShell) => {
		useSettingsStore.setState({ newShell });
		render(
			<NotificationSendControls
				theme={inputAreaTheme}
				isTerminalMode={false}
				processInput={vi.fn()}
			/>
		);
		expect(!!screen.queryByTitle('Notification Settings')).toBe(!newShell);
		expect(screen.getByTitle('Send message')).toBeInTheDocument();
	});

	it('toggles notification popover', () => {
		render(
			<NotificationSendControls
				theme={inputAreaTheme}
				isTerminalMode={false}
				processInput={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByTitle('Notification Settings'));
		expect(screen.getByTestId('notification-popover')).toBeInTheDocument();

		fireEvent.click(screen.getByTitle('Notification Settings'));
		expect(screen.queryByTestId('notification-popover')).not.toBeInTheDocument();
	});

	it('sends input and uses terminal title in terminal mode', () => {
		const processInput = vi.fn();
		render(
			<NotificationSendControls theme={inputAreaTheme} isTerminalMode processInput={processInput} />
		);

		fireEvent.click(screen.getByTitle('Run command (Enter)'));

		expect(processInput).toHaveBeenCalled();
	});

	describe('while the conversation on screen runs', () => {
		it('turns the send key into Stop', () => {
			const onStop = vi.fn();
			const processInput = vi.fn();
			render(
				<NotificationSendControls
					theme={inputAreaTheme}
					isTerminalMode={false}
					processInput={processInput}
					onStop={onStop}
				/>
			);

			expect(screen.queryByTitle('Send message')).not.toBeInTheDocument();
			const stop = screen.getByTestId('stop-turn-button');
			// Names the key that does the same thing; Ctrl+C only reaches a terminal tab.
			expect(stop).toHaveAccessibleName(/^Stop this turn \((Esc|⎋)\)$/);
			fireEvent.click(stop);
			expect(onStop).toHaveBeenCalledTimes(1);
			expect(processInput).not.toHaveBeenCalled();
		});

		it('keeps the corner for queueing a draft, with Stop beside it', () => {
			const onStop = vi.fn();
			const processInput = vi.fn();
			render(
				<NotificationSendControls
					theme={inputAreaTheme}
					isTerminalMode={false}
					processInput={processInput}
					onStop={onStop}
					hasDraft
				/>
			);

			const queue = screen.getByTitle('Queue message');
			const stop = screen.getByTestId('stop-turn-button');
			// The corner (last control) is the draft's key; Stop sits just before it.
			expect(stop.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
			fireEvent.click(queue);
			expect(processInput).toHaveBeenCalledTimes(1);
			expect(onStop).not.toHaveBeenCalled();
		});
	});
});
