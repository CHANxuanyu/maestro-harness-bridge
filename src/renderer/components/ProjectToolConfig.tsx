import { useEffect, useState } from 'react';
import type { AgentConfig, Session, Theme } from '../types';
import type { SshRemoteConfig } from '../../shared/types';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { sessionProviderId } from '../../shared/agentPresets';
import { withBlankEnvVarRow } from '../../shared/envVarCatalog';
import { AgentConfigPanel } from './shared/AgentConfigPanel';
import { SshRemoteSelector } from './shared/SshRemoteSelector';
import { useT } from '../i18n';

/** A draft of one existing owner, independent of defaults for future conversations. */
export function ProjectToolConfig({
	theme,
	session,
	patch,
	onChange,
}: {
	theme: Theme;
	session: Session;
	patch: Partial<Session>;
	onChange: (update: (previous: Partial<Session>) => Partial<Session>) => void;
}) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const [agent, setAgent] = useState<AgentConfig>();
	const [remotes, setRemotes] = useState<SshRemoteConfig[]>([]);
	const [loadFailed, setLoadFailed] = useState(false);
	const [detectedMaestroPPath, setDetectedMaestroPPath] = useState<string>();
	const draft = { ...session, ...patch };
	const ssh = draft.sessionSshRemoteConfig;
	useEffect(() => {
		if (!expanded) return;
		let stale = false;
		void Promise.all([
			window.maestro.agents.detect(),
			window.maestro.sshRemote.getConfigs(),
			window.maestro.agents.getMaestroPDetectedPath().catch(() => null),
		])
			.then(([agents, result, detectedPath]) => {
				if (stale) return;
				const definition = agents.find((entry) => entry.id === session.toolType);
				// These are owner launch settings. Model and other global provider options
				// belong to their existing editors, not this project's defaults.
				setAgent(definition ? { ...definition, configOptions: [] } : undefined);
				setRemotes(result.configs ?? []);
				setDetectedMaestroPPath(detectedPath ?? undefined);
				setLoadFailed(!definition || !result.success);
			})
			.catch(() => {
				if (!stale) setLoadFailed(true);
			});
		return () => {
			stale = true;
		};
	}, [expanded, session.toolType]);
	const change = (fields: Partial<Session>) => onChange((previous) => ({ ...previous, ...fields }));
	const updateEnv = (update: (vars: Record<string, string>) => Record<string, string>) =>
		onChange((previous) => ({
			...previous,
			customEnvVars: update(previous.customEnvVars ?? session.customEnvVars ?? {}),
		}));
	return (
		<div
			className="rounded border p-3 space-y-3"
			style={{ borderColor: theme.colors.border }}
			data-testid={`project-tool-${session.id}`}
		>
			<button
				type="button"
				className="w-full text-left text-sm"
				aria-expanded={expanded}
				onClick={() => setExpanded(!expanded)}
			>
				<span className="font-medium">{session.name}</span>
				<span className="ml-2" style={{ color: theme.colors.textDim }}>
					{getAgentDisplayName(sessionProviderId(session))}
				</span>
				<span className="block text-xs" style={{ color: theme.colors.textDim }}>
					{session.id}
				</span>
			</button>
			<p className="text-xs" style={{ color: theme.colors.textDim }}>
				{t('workflows.projectSettings.toolScope')}
			</p>
			{expanded && (
				<>
					<p className="text-xs" style={{ color: theme.colors.textDim }}>
						{t('workflows.projectSettings.toolAccountHelp')}
					</p>
					{loadFailed ? (
						<p role="alert">{t('workflows.projectSettings.toolLoadFailed')}</p>
					) : !agent ? (
						<p role="status">{t('workflows.projectSettings.loading')}</p>
					) : (
						<>
							<AgentConfigPanel
								theme={theme}
								agent={agent}
								projectConfiguration
								customPath={draft.customPath ?? ''}
								onCustomPathChange={(customPath) => change({ customPath })}
								onCustomPathBlur={() => {}}
								customArgs={draft.customArgs ?? ''}
								onCustomArgsChange={(customArgs) => change({ customArgs })}
								onCustomArgsBlur={() => {}}
								customEnvVars={draft.customEnvVars ?? {}}
								onEnvVarKeyChange={(oldKey, newKey, value) =>
									updateEnv((vars) => {
										const next = { ...vars };
										delete next[oldKey];
										next[newKey] = value;
										return next;
									})
								}
								onEnvVarValueChange={(key, value) =>
									updateEnv((vars) => ({ ...vars, [key]: value }))
								}
								onEnvVarRemove={(key) =>
									updateEnv((vars) => {
										const next = { ...vars };
										delete next[key];
										return next;
									})
								}
								onEnvVarAdd={() => updateEnv(withBlankEnvVarRow)}
								onEnvVarsBlur={() => {}}
								agentConfig={{}}
								onConfigChange={() => {}}
								onConfigBlur={() => {}}
								isSshEnabled={!!ssh?.enabled}
								sshRemoteId={ssh?.remoteId ?? undefined}
								enableMaestroP={draft.enableMaestroP}
								onEnableMaestroPChange={(enableMaestroP) => change({ enableMaestroP })}
								maestroPMode={draft.maestroPMode}
								onMaestroPModeChange={(maestroPMode) => change({ maestroPMode })}
								detectedMaestroPPath={detectedMaestroPPath}
								maestroPPath={draft.maestroPPath ?? ''}
								onMaestroPPathChange={(maestroPPath) => change({ maestroPPath })}
								onMaestroPPathBlur={() => {}}
							/>
							<SshRemoteSelector
								theme={theme}
								sshRemotes={remotes}
								sshRemoteConfig={ssh}
								onSshRemoteConfigChange={(sessionSshRemoteConfig) =>
									change({ sessionSshRemoteConfig })
								}
								projectConfiguration
							/>
						</>
					)}
				</>
			)}
		</div>
	);
}
