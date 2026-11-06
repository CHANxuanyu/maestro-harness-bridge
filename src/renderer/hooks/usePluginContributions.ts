import { shellFeatureVisible } from '../../shared/newShellFeatures';
import { useSettingsStore } from '../stores/settingsStore';
/**
 * usePluginContributions - the renderer's read seam for active plugin
 * contributions (themes, prompts, command macros, settings, ...).
 *
 * Fetches contributions and subscribes to registry changes only after settings
 * load and the current shell allows enabled plugins. Disabled consumers get
 * empty buckets without sending requests that main would reject.
 */

import { useState, useEffect } from 'react';
import type { AggregatedContributions } from '../../shared/plugins/contributions';

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

export function usePluginContributions(): AggregatedContributions {
	const settingsLoaded = useSettingsStore((s) => s.settingsLoaded);
	const pluginsEnabled = useSettingsStore((s) => s.encoreFeatures.plugins === true);
	const newShell = useSettingsStore((s) => s.newShell);
	const enabled = settingsLoaded && pluginsEnabled && shellFeatureVisible('plugins', newShell);
	const [contributions, setContributions] = useState<AggregatedContributions>(EMPTY);

	useEffect(() => {
		// The plugins API is absent in the web build (and before the preload bridge
		// is ready); treat that exactly like feature-off and stay on empty buckets.
		const plugins = window.maestro?.plugins;
		if (!enabled || !plugins) {
			setContributions(EMPTY);
			return;
		}

		let cancelled = false;
		let requestGeneration = 0;

		const load = async (): Promise<void> => {
			const generation = ++requestGeneration;
			try {
				const next = await plugins.contributions();
				if (!cancelled && generation === requestGeneration) setContributions(next);
			} catch {
				// 'PluginsDisabled' or any read failure -> behave as feature-off.
				if (!cancelled && generation === requestGeneration) setContributions(EMPTY);
			}
		};

		void load();
		const unsubscribe = plugins.onChanged(() => {
			void load();
		});

		return () => {
			cancelled = true;
			requestGeneration++;
			unsubscribe();
		};
	}, [enabled]);

	return enabled ? contributions : EMPTY;
}
