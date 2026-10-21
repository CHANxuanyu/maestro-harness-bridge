import { useT } from '../../../i18n';
/**
 * EnvironmentTab - Global environment variables settings tab
 *
 * Provides a dedicated panel for managing global environment variables
 * that cascade to all agents and terminal sessions. Per-agent env vars
 * (configured in agent settings) override these globals.
 */

import { Globe } from 'lucide-react';
import { useSettings } from '../../../hooks';
import { useKnownAuthDirs } from '../../../hooks/agent/useKnownAuthDirs';
import type { Theme } from '../../../types';
import { EnvVarsEditor } from '../EnvVarsEditor';
import { useKnownEnvVarKeys } from '../../../hooks/agent/useKnownEnvVarKeys';

export interface EnvironmentTabProps {
	theme: Theme;
}

export function EnvironmentTab({ theme }: EnvironmentTabProps) {
	const t = useT();
	const { shellEnvVars, setShellEnvVars, shellEnvVarsDisabled, setShellEnvVarsDisabled } =
		useSettings();
	const knownAuthDirs = useKnownAuthDirs();
	const knownEnvVarKeys = useKnownEnvVarKeys();

	return (
		<div className="space-y-5">
			{/* Global Environment Variables */}
			<div data-setting-id="environment-global-vars">
				<div className="flex items-center gap-2 mb-1">
					<Globe className="w-3 h-3" style={{ color: theme.colors.textDim }} />
					<span className="text-xs font-bold opacity-70 uppercase">
						{t('settings.finish.environment.heading')}
					</span>
				</div>
				<p className="text-xs opacity-70 mb-2">{t('settings.finish.environment.description')}</p>
				<EnvVarsEditor
					envVars={shellEnvVars}
					setEnvVars={setShellEnvVars}
					disabledEnvVars={shellEnvVarsDisabled}
					setDisabledEnvVars={setShellEnvVarsDisabled}
					knownEnvVarKeys={knownEnvVarKeys}
					theme={theme}
					label={null}
					description={null}
					knownAuthDirs={knownAuthDirs}
				/>
			</div>
		</div>
	);
}
