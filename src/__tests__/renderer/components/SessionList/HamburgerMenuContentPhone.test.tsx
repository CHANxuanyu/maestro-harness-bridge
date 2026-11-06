/**
 * Tests for the hamburger menu's phone layout.
 *
 * A phone has no keyboard and no room for a guided tour's anchored callouts,
 * so the two entries that exist only for those are not offered there, and
 * every chord badge beside the remaining rows carries `data-shortcut-hint` so
 * the phone stylesheet can retire them together.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HamburgerMenuContent } from '../../../../renderer/components/SessionList/HamburgerMenuContent';
import { usePhoneLayout } from '../../../../renderer/hooks/ui/useViewportBreakpoint';
import { useNotificationStore } from '../../../../renderer/stores/notificationStore';
import { mockTheme } from '../../../helpers/mockTheme';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { chooseProject } from '../../../../renderer/services/openProject';
vi.mock('../../../../renderer/services/openProject', () => ({ chooseProject: vi.fn() }));

vi.mock('../../../../renderer/hooks/ui/useViewportBreakpoint', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../../renderer/hooks/ui/useViewportBreakpoint')>()),
	usePhoneLayout: vi.fn(() => false),
}));
const mockedUsePhoneLayout = vi.mocked(usePhoneLayout);

function renderMenu(setMenuOpen = vi.fn()) {
	return render(
		<HamburgerMenuContent
			theme={mockTheme}
			onNewAgentSession={vi.fn()}
			openWizard={vi.fn()}
			startTour={vi.fn()}
			setMenuOpen={setMenuOpen}
		/>
	);
}

afterEach(() => {
	mockedUsePhoneLayout.mockReturnValue(false);
	useSettingsStore.setState({ newShell: false });
	vi.mocked(chooseProject).mockClear();
});

describe('HamburgerMenuContent on a phone', () => {
	it('uses a matching icon and description row for Open project and hides New Agent in the new shell', () => {
		useSettingsStore.setState({ newShell: true });
		renderMenu();
		expect(screen.queryByText('New Agent')).not.toBeInTheDocument();
		const open = screen.getByRole('button', { name: /Open project/ });
		expect(open.querySelector('svg')).toBeInTheDocument();
		expect(open).toHaveTextContent('Choose a folder to start or continue work');
		expect(open.className).toBe(screen.getByRole('button', { name: /Command Palette/ }).className);
	});
	it.each([false, true])(
		'hides upstream entries without rewriting flags, new shell %s',
		(newShell) => {
			const encoreFeatures = {
				...useSettingsStore.getState().encoreFeatures,
				usageStats: true,
				directorNotes: true,
				symphony: true,
				maestroCue: true,
			};
			useSettingsStore.setState({ newShell, encoreFeatures });
			renderMenu();
			for (const name of [
				'Usage Dashboard',
				'Maestro Symphony',
				'Maestro Cue',
				'New Agent Wizard',
				'Introductory Tour',
			]) {
				// Menu copy remains the classic labels whenever that shell is selected.
				expect(!!screen.queryByText(name)).toBe(!newShell);
			}
			expect(useSettingsStore.getState().encoreFeatures).toEqual(encoreFeatures);
		}
	);

	it.each([false, true])('offers Open Project only in newShell=%s', (newShell) => {
		useSettingsStore.setState({ newShell });
		const close = vi.fn();
		renderMenu(close);
		const button = screen.queryByRole('button', { name: /Open project/ });
		expect(!!button).toBe(newShell);
		if (newShell) {
			fireEvent.click(button!);
			expect(chooseProject).toHaveBeenCalledOnce();
			expect(close).toHaveBeenCalledWith(false);
		}
	});
	it.each([false, true])('opens notification history without a header on phone=%s', (phone) => {
		mockedUsePhoneLayout.mockReturnValue(phone);
		useNotificationStore.getState().setNotificationCenterOpen(false);
		const closeMenu = vi.fn();
		renderMenu(closeMenu);
		fireEvent.click(screen.getByRole('button', { name: /Notification Center/ }));
		expect(useNotificationStore.getState().notificationCenterOpen).toBe(true);
		expect(closeMenu).toHaveBeenCalledWith(false);
		useNotificationStore.getState().setNotificationCenterOpen(false);
	});

	it('offers the keyboard-only entries on desktop', () => {
		mockedUsePhoneLayout.mockReturnValue(false);
		renderMenu();
		expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
		expect(screen.getByText('Introductory Tour')).toBeInTheDocument();
	});

	it('drops Keyboard Shortcuts and the tour on a phone, keeping everything else', () => {
		mockedUsePhoneLayout.mockReturnValue(true);
		renderMenu();
		expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
		expect(screen.queryByText('Introductory Tour')).not.toBeInTheDocument();
		expect(screen.getByText('New Agent')).toBeInTheDocument();
		expect(screen.getByText('Command Palette')).toBeInTheDocument();
		expect(screen.getByText('Settings')).toBeInTheDocument();
		expect(screen.getByText('Usage Dashboard')).toBeInTheDocument();
	});

	it('tags every chord badge so the phone stylesheet can hide them', () => {
		mockedUsePhoneLayout.mockReturnValue(false);
		const { container } = renderMenu();
		const badges = container.querySelectorAll('span.font-mono');
		expect(badges.length).toBeGreaterThan(0);
		for (const badge of badges) {
			expect(badge).toHaveAttribute('data-shortcut-hint');
		}
	});
});
