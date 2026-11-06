import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AggregatedContributions } from '../../shared/plugins/contributions';
import { useSettingsStore } from '../stores/settingsStore';
import { usePluginContributions } from './usePluginContributions';

const EMPTY: AggregatedContributions = {
	themes: [],
	iconPacks: [],
	prompts: [],
	settings: [],
	commandMacros: [],
	cueTriggers: [],
	commands: [],
	panels: [],
	agents: [],
	tools: [],
	keybindings: [],
	uiItems: [],
	hostViews: [],
	groupings: [],
	errorsByPlugin: {},
};

function Probe() {
	const contributions = usePluginContributions();
	return (
		<>
			{contributions.uiItems.map((item) => (
				<span key={item.id}>{item.label}</span>
			))}
		</>
	);
}

beforeEach(() => {
	useSettingsStore.setState({
		settingsLoaded: true,
		newShell: false,
		encoreFeatures: { ...useSettingsStore.getState().encoreFeatures, plugins: true },
	});
});

afterEach(() => {
	window.maestro.plugins = undefined as unknown as typeof window.maestro.plugins;
});

describe('usePluginContributions', () => {
	it('ignores an older active response after a changed event returns an empty snapshot', async () => {
		let resolveInitial!: (value: AggregatedContributions) => void;
		const initial = new Promise<AggregatedContributions>((resolve) => {
			resolveInitial = resolve;
		});
		let notifyChanged!: () => void;
		const plugins = {
			contributions: vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(EMPTY),
			onChanged: vi.fn((listener: () => void) => {
				notifyChanged = listener;
				return () => {};
			}),
		};
		window.maestro.plugins = plugins as unknown as typeof window.maestro.plugins;

		render(<Probe />);
		await waitFor(() => expect(plugins.contributions).toHaveBeenCalledTimes(1));

		act(() => notifyChanged());
		await waitFor(() => expect(plugins.contributions).toHaveBeenCalledTimes(2));
		await act(async () => {
			await Promise.resolve();
		});

		await act(async () => {
			resolveInitial({
				...EMPTY,
				uiItems: [
					{
						id: 'p/open',
						localId: 'open',
						pluginId: 'p',
						surface: 'emptyState',
						label: 'Revoked action',
						command: 'run',
					},
				],
			});
			await Promise.resolve();
		});

		await waitFor(() => expect(screen.queryByText('Revoked action')).not.toBeInTheDocument());
	});
});

it.each([
	{ settingsLoaded: false, newShell: false, enabled: true },
	{ settingsLoaded: true, newShell: false, enabled: false },
	{ settingsLoaded: true, newShell: true, enabled: true },
])(
	'does not request or subscribe before gates allow plugins: %j',
	async ({ settingsLoaded, newShell, enabled }) => {
		useSettingsStore.setState({
			settingsLoaded,
			newShell,
			encoreFeatures: { ...useSettingsStore.getState().encoreFeatures, plugins: enabled },
		});
		const unsubscribe = vi.fn();
		const plugins = {
			contributions: vi.fn().mockResolvedValue(EMPTY),
			onChanged: vi.fn(() => unsubscribe),
		};
		window.maestro.plugins = plugins as unknown as typeof window.maestro.plugins;
		const { unmount } = render(<Probe />);
		expect(plugins.contributions).not.toHaveBeenCalled();
		expect(plugins.onChanged).not.toHaveBeenCalled();
		await act(async () => {
			useSettingsStore.setState({
				settingsLoaded: true,
				newShell: false,
				encoreFeatures: { ...useSettingsStore.getState().encoreFeatures, plugins: true },
			});
		});
		expect(plugins.contributions).toHaveBeenCalledOnce();
		expect(plugins.onChanged).toHaveBeenCalledOnce();
		act(() =>
			useSettingsStore.setState({
				encoreFeatures: { ...useSettingsStore.getState().encoreFeatures, plugins: false },
			})
		);
		expect(unsubscribe).toHaveBeenCalledOnce();
		unmount();
	}
);

it('clears loaded contributions and ignores in-flight responses when disabled, then reloads', async () => {
	const active = {
		...EMPTY,
		uiItems: [
			{
				id: 'p/open',
				localId: 'open',
				pluginId: 'p',
				surface: 'emptyState' as const,
				label: 'Plugin action',
				command: 'run',
			},
		],
	};
	let resolvePending!: (value: AggregatedContributions) => void;
	let changed!: () => void;
	const unsubscribe = vi.fn();
	const plugins = {
		contributions: vi
			.fn()
			.mockResolvedValueOnce(active)
			.mockImplementationOnce(
				() =>
					new Promise<AggregatedContributions>((resolve) => {
						resolvePending = resolve;
					})
			)
			.mockResolvedValue(active),
		onChanged: vi.fn((listener: () => void) => {
			changed = listener;
			return unsubscribe;
		}),
	};
	window.maestro.plugins = plugins as unknown as typeof window.maestro.plugins;
	render(<Probe />);
	expect(await screen.findByText('Plugin action')).toBeInTheDocument();
	act(() => changed());
	act(() =>
		useSettingsStore.setState({
			encoreFeatures: { ...useSettingsStore.getState().encoreFeatures, plugins: false },
		})
	);
	expect(screen.queryByText('Plugin action')).not.toBeInTheDocument();
	expect(unsubscribe).toHaveBeenCalledOnce();
	await act(async () => resolvePending(active));
	expect(screen.queryByText('Plugin action')).not.toBeInTheDocument();
	await act(async () =>
		useSettingsStore.setState({
			encoreFeatures: { ...useSettingsStore.getState().encoreFeatures, plugins: true },
		})
	);
	expect(await screen.findByText('Plugin action')).toBeInTheDocument();
	expect(plugins.contributions).toHaveBeenCalledTimes(3);
});
