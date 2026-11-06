import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentErrorModal } from '../../../renderer/components/AgentErrorModal';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { mockTheme } from '../../helpers/mockTheme';

beforeEach(() => useSettingsStore.setState({ newShell: false, uiLanguage: 'en' }));

describe('AgentErrorModal conversation wording', () => {
	it.each([false, true])(
		'names the destination and preserves navigation, new shell %s',
		(newShell) => {
			useSettingsStore.setState({ newShell });
			const jump = vi.fn();
			render(
				<LayerStackProvider>
					<AgentErrorModal
						theme={mockTheme}
						error={{
							type: 'network_error',
							message: 'Offline',
							recoverable: true,
							agentId: 'codex',
							timestamp: 1,
						}}
						recoveryActions={[]}
						onDismiss={vi.fn()}
						onJumpToAgent={jump}
					/>
				</LayerStackProvider>
			);
			const button = screen.getByRole('button', {
				name: newShell ? 'Jump to failing conversation' : 'Jump to failing tab',
			});
			fireEvent.click(button);
			expect(jump).toHaveBeenCalledOnce();
		}
	);
});
