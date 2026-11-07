import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { NotificationSendControls } from '../../../renderer/components/InputArea/components/NotificationSendControls';
import { inputAreaTheme } from './InputArea/_fixtures';

describe('Codex app-server controls', () => {
	beforeEach(() => {
		useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
	});

	it('keeps queue and stop separate from steering and prevents duplicate in-flight sends', async () => {
		let settle!: () => void;
		const steer = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					settle = resolve;
				})
		);
		const queue = vi.fn();
		act(() => useSettingsStore.setState({ newShell: true }));
		render(
			<NotificationSendControls
				theme={inputAreaTheme}
				isTerminalMode={false}
				processInput={queue}
				onStop={vi.fn()}
				hasDraft
				onSteer={steer}
			/>
		);
		const button = screen.getByRole('button', { name: 'Add to this turn' });
		fireEvent.click(button);
		fireEvent.click(button);
		expect(steer).toHaveBeenCalledTimes(1);
		expect(queue).not.toHaveBeenCalled();
		expect(button).toBeDisabled();
		expect(screen.getByTitle('Queue message')).toBeInTheDocument();
		await act(async () => settle());
		expect(button).not.toBeDisabled();
	});
});
