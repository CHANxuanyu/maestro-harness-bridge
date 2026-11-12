import { ProjectToolConfig } from './ProjectToolConfig';
import { prepareSessionToolConfig, applyProjectToolPatches } from '../services/sessionToolConfig';
import { effectiveStandardPermissionCapability } from '../../shared/codexAppServer';
import { useAgentCapabilities } from '../hooks/agent/useAgentCapabilities';
import { projectSettingsScopeForSession } from '../utils/projectConversationDefaults';
import { permissionModes } from '../utils/tabHelpers/focusFields';
import { useEffect, useId, useMemo, useState } from 'react';
import type { Session, Theme } from '../types';
import type { ProjectSettings, ProjectSettingsScope } from '../../shared/projectSettings';
import { projectSettingsKey } from '../../shared/projectSettings';
import { HANDOFF_PROVIDERS, type HandoffTargetsResult } from '../../shared/aiHandoff';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { DEEPSEEK_PRESET, sessionProviderId } from '../../shared/agentPresets';
import { Modal, ModalFooter } from './ui/Modal';
import { EnvVarsEditor } from './Settings/EnvVarsEditor';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { useAgentModelEffortOptions } from '../hooks/agent/useAgentModelEffortOptions';
import { useT } from '../i18n';
import { effortDisplayLabel } from '../utils/workflowLabels';
import { useSettingsStore } from '../stores/settingsStore';

export interface ProjectSettingsModalProps {
	theme: Theme;
	name: string;
	scopes: ProjectSettingsScope[];
	sessions: Session[];
	onClose: () => void;
}

/** Separates future conversation defaults from existing tool launch configuration. */
export function ProjectSettingsModal({
	theme,
	name,
	scopes,
	sessions,
	onClose,
}: ProjectSettingsModalProps) {
	const t = useT();
	const newShell = useSettingsStore((state) => state.newShell);
	const codexAppServer = useSettingsStore((state) => state.codexAppServer);
	const id = useId();
	const [scopeIndex, setScopeIndex] = useState(0);
	const scope = scopes[scopeIndex];
	const scopeKey = scope ? projectSettingsKey(scope) : '';
	const [loadedScope, setLoadedScope] = useState('');
	const [handoffTargets, setHandoffTargets] = useState<
		NonNullable<HandoffTargetsResult['targets']>
	>([]);
	const [draft, setDraft] = useState<ProjectSettings>({});
	const [toolPatches, setToolPatches] = useState<Record<string, Partial<Session>>>({});
	const [acknowledged, setAcknowledged] = useState(false);
	const [saving, setSaving] = useState(false);
	const [environmentRedacted, setEnvironmentRedacted] = useState(false);
	const [validEnvironment, setValidEnvironment] = useState(true);
	const [error, setError] = useState<string>();
	const [toolSaveError, setToolSaveError] = useState(false);
	const scopedSessions = sessions.filter(
		(session) => projectSettingsKey(projectSettingsScopeForSession(session)) === scopeKey
	);
	const provider =
		draft.defaultProvider ||
		draft.modelProvider ||
		sessionProviderId(scopedSessions[0] ?? { toolType: 'claude-code' });
	const owner = scopedSessions.find((session) => sessionProviderId(session) === provider);
	const { capabilities } = useAgentCapabilities(provider === 'deepseek' ? 'claude-code' : provider);
	const { models, efforts, loaded } = useAgentModelEffortOptions(
		provider === 'deepseek' ? 'claude-code' : provider,
		provider === 'deepseek'
			? { ...owner?.customEnvVars, ANTHROPIC_BASE_URL: DEEPSEEK_PRESET.baseUrl }
			: owner?.customEnvVars
	);
	const providers = useMemo(
		() => [
			...new Set([
				...HANDOFF_PROVIDERS,
				...sessions.map(sessionProviderId),
				...(draft.defaultProvider ? [draft.defaultProvider] : []),
			]),
		],
		[sessions, draft.defaultProvider]
	);
	const needsAcknowledgement =
		draft.defaultPermissionMode === 'full' && !draft.fullAccessAcknowledged;
	const ready = loadedScope === scopeKey && !!scope;

	useEffect(() => {
		if (!scope) return;
		let stale = false;
		setLoadedScope('');
		setError(undefined);
		setToolSaveError(false);
		setAcknowledged(false);
		setToolPatches({});
		void window.maestro.settings
			.projectSettings({ action: 'show', scope })
			.then((result) => {
				if (stale) return;
				if (!result.success) {
					setError(
						result.errorCode
							? t(`workflows.projectSettings.errors.${result.errorCode}`, result.params)
							: t('workflows.projectSettings.failed')
					);
					return;
				}
				setDraft(result.settings);
				setEnvironmentRedacted(!!result.environmentRedacted);
				setLoadedScope(scopeKey);
			})
			.catch(() => {
				if (!stale) setError(t('workflows.projectSettings.failed'));
			});
		return () => {
			stale = true;
		};
	}, [scopeKey]);

	useEffect(() => {
		setHandoffTargets([]);
		const source = scopedSessions[0];
		if (!newShell || !source) return;
		let stale = false;
		void window.maestro.context
			.conversation({ action: 'targets', sourceAgentId: source.id, configurations: true })
			.then((result) => {
				if (!stale && result.success && 'targets' in result)
					setHandoffTargets(result.targets ?? []);
			})
			.catch(() => {
				if (!stale) setError(t('workflows.projectSettings.failed'));
			});
		return () => {
			stale = true;
		};
	}, [scopeKey, newShell, sessions]);

	const save = async () => {
		if (!ready || saving || !validEnvironment || (needsAcknowledgement && !acknowledged)) return;
		setSaving(true);
		setError(undefined);
		setToolSaveError(false);
		try {
			const preparedTools: Record<string, Record<string, unknown>> = {};
			if (newShell) {
				for (const [sessionId, { sessionSshRemoteConfig, ...patch }] of Object.entries(
					toolPatches
				)) {
					const fields: Record<string, unknown> = { ...patch };
					for (const key of ['customPath', 'customArgs', 'maestroPPath']) {
						if (typeof fields[key] === 'string')
							fields[key] = (fields[key] as string).trim() || null;
					}
					if (patch.customEnvVars)
						fields.customEnvVars = Object.fromEntries(
							Object.entries(patch.customEnvVars).filter(([key]) => key.trim())
						);
					try {
						preparedTools[sessionId] = await prepareSessionToolConfig(
							sessionId,
							fields,
							sessionSshRemoteConfig
						);
					} catch (error) {
						setToolSaveError(true);
						setError(
							error instanceof Error ? error.message : t('workflows.projectSettings.toolSaveFailed')
						);
						return;
					}
				}
			}
			const result = await window.maestro.settings.projectSettings({
				action: 'set',
				...(newShell ? { toolPatches: preparedTools } : {}),
				scope,
				patch: {
					...(newShell ? { autoHandoffTarget: draft.autoHandoffTarget || null } : {}),
					defaultProvider: draft.defaultProvider || null,
					modelProvider:
						draft.defaultModel?.trim() || draft.defaultReasoningEffort ? provider : null,
					defaultModel: draft.defaultModel?.trim() || null,
					defaultReasoningEffort: draft.defaultReasoningEffort || null,
					defaultPermissionMode: draft.defaultPermissionMode || null,
					...(environmentRedacted ? {} : { envVars: draft.envVars ?? {} }),
				},
				acknowledgeFullAccess: needsAcknowledgement && acknowledged,
			});
			if (!result.success) {
				setError(
					result.errorCode
						? t(`workflows.projectSettings.errors.${result.errorCode}`, result.params)
						: t('workflows.projectSettings.failed')
				);
				return;
			}
			useSettingsStore.setState((state) => ({
				projectSettings: { ...state.projectSettings, [scopeKey]: result.settings },
			}));
			if (newShell) applyProjectToolPatches(preparedTools);
			onClose();
		} catch {
			setError(t('workflows.projectSettings.failed'));
		} finally {
			setSaving(false);
		}
	};
	const inputStyle = {
		color: theme.colors.textMain,
		backgroundColor: theme.colors.bgMain,
		borderColor: theme.colors.border,
	};
	const fieldClass = 'w-full mt-1 p-2 rounded border text-sm outline-none focus:ring-1';

	return (
		<Modal
			theme={theme}
			title={t('workflows.projectSettings.title')}
			subtitle={name}
			priority={MODAL_PRIORITIES.SETTINGS}
			onClose={saving ? () => {} : onClose}
			width={560}
			resizeKey="project-settings"
			// Six fields and the environment list should fit without scrolling.
			defaultSize={{ width: 560, height: 700 }}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={saving ? () => {} : onClose}
					onConfirm={() => void save()}
					confirmLabel={t('common.save')}
					confirmDisabled={
						!ready || saving || !validEnvironment || (needsAcknowledgement && !acknowledged)
					}
				/>
			}
		>
			<div className="space-y-4" style={{ color: theme.colors.textMain }}>
				{newShell && (
					<h3 className="text-sm font-medium">{t('workflows.projectSettings.defaultsHeading')}</h3>
				)}
				<p className="text-sm" style={{ color: theme.colors.textDim }}>
					{t('workflows.projectSettings.description')}
				</p>
				{scopes.length > 1 ? (
					<label className="block text-xs" htmlFor={`${id}-scope`}>
						{t('workflows.projectSettings.location')}
						<select
							id={`${id}-scope`}
							className={fieldClass}
							style={inputStyle}
							value={scopeIndex}
							disabled={saving}
							onChange={(event) => setScopeIndex(Number(event.target.value))}
						>
							{scopes.map((entry, index) => (
								<option key={projectSettingsKey(entry)} value={index}>
									{entry.projectPath} ({entry.sshRemoteId || t('workflows.projectSettings.local')})
								</option>
							))}
						</select>
					</label>
				) : (
					<p
						className="text-xs truncate"
						style={{ color: theme.colors.textDim }}
						title={scopes[0]?.projectPath}
						data-testid="project-settings-location"
					>
						{scopes[0]?.projectPath} (
						{scopes[0]?.sshRemoteId || t('workflows.projectSettings.local')})
					</p>
				)}
				{error && (
					<p role="alert" className="text-sm" style={{ color: theme.colors.error }}>
						{error}
					</p>
				)}
				{toolSaveError && (
					<p className="text-xs" style={{ color: theme.colors.error }}>
						{t('workflows.projectSettings.toolSaveFailed')}
					</p>
				)}
				{!ready && !error && <p role="status">{t('workflows.projectSettings.loading')}</p>}
				{ready && (
					<fieldset disabled={saving} className="space-y-4">
						{newShell && (
							<label className="block text-xs" htmlFor={`${id}-auto-handoff`}>
								{t('workflows.autoHandoff.setting')}
								<select
									id={`${id}-auto-handoff`}
									className={fieldClass}
									style={inputStyle}
									value={draft.autoHandoffTarget ?? ''}
									onChange={(event) =>
										setDraft((current) => ({
											...current,
											autoHandoffTarget: event.target.value || undefined,
										}))
									}
								>
									<option value="">{t('workflows.autoHandoff.off')}</option>
									{draft.autoHandoffTarget &&
										!handoffTargets.some(
											(target) => target.runnerId === draft.autoHandoffTarget
										) && (
											<option value={draft.autoHandoffTarget}>
												{t('workflows.autoHandoff.unavailable', { id: draft.autoHandoffTarget })}
											</option>
										)}
									{handoffTargets.map((target) => (
										<option key={target.runnerId} value={target.runnerId}>
											{t('workflows.autoHandoff.target', {
												tool: getAgentDisplayName(target.provider),
												account: target.account || t('workflows.autoHandoff.defaultAccount'),
												name: target.name || target.runnerId || '',
											})}
										</option>
									))}
								</select>
							</label>
						)}
						<label className="block text-xs" htmlFor={`${id}-provider`}>
							{t('workflows.projectSettings.provider')}
							<select
								id={`${id}-provider`}
								className={fieldClass}
								style={inputStyle}
								value={draft.defaultProvider ?? ''}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										defaultProvider: event.target.value || undefined,
										modelProvider: undefined,
										defaultModel: undefined,
										defaultReasoningEffort: undefined,
									}))
								}
							>
								<option value="">{t('workflows.projectSettings.inherit')}</option>
								{providers.map((value) => (
									<option key={value} value={value}>
										{value === 'deepseek' ? 'DeepSeek' : getAgentDisplayName(value)}
									</option>
								))}
							</select>
						</label>
						{capabilities.supportsModelSelection && (
							<label className="block text-xs" htmlFor={`${id}-model`}>
								{t('workflows.projectSettings.model')}
								<input
									id={`${id}-model`}
									list={`${id}-models`}
									className={fieldClass}
									style={inputStyle}
									value={draft.defaultModel ?? ''}
									placeholder={t('workflows.projectSettings.inherit')}
									onChange={(event) =>
										setDraft((current) => ({ ...current, defaultModel: event.target.value }))
									}
								/>
								<datalist id={`${id}-models`}>
									{models.map((model) => (
										<option key={model} value={model} />
									))}
								</datalist>
							</label>
						)}
						{(efforts.length > 0 || draft.defaultReasoningEffort) && (
							<label className="block text-xs" htmlFor={`${id}-effort`}>
								{t('workflows.projectSettings.effort')}
								<select
									id={`${id}-effort`}
									className={fieldClass}
									style={inputStyle}
									value={draft.defaultReasoningEffort ?? ''}
									disabled={!loaded}
									onChange={(event) =>
										setDraft((current) => ({
											...current,
											defaultReasoningEffort: event.target.value || undefined,
										}))
									}
								>
									<option value="">{t('workflows.projectSettings.inherit')}</option>
									{[
										...new Set(
											[...efforts, draft.defaultReasoningEffort].filter(
												(value): value is string => !!value
											)
										),
									].map((effort) => (
										<option key={effort} value={effort}>
											{effortDisplayLabel(t, effort)}
										</option>
									))}
								</select>
							</label>
						)}
						<label className="block text-xs" htmlFor={`${id}-permission`}>
							{t('workflows.projectSettings.permission')}
							<select
								id={`${id}-permission`}
								className={fieldClass}
								style={inputStyle}
								value={draft.defaultPermissionMode ?? ''}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										defaultPermissionMode: (event.target.value ||
											undefined) as ProjectSettings['defaultPermissionMode'],
									}))
								}
							>
								<option value="">{t('workflows.projectSettings.inherit')}</option>
								{permissionModes(
									effectiveStandardPermissionCapability(
										capabilities,
										{ newShell, codexAppServer },
										!!scope?.sshRemoteId,
										owner
									)
								)
									.filter((mode) => mode !== 'readonly' || capabilities.supportsReadOnlyMode)
									.map((mode) => (
										<option key={mode} value={mode}>
											{t(`workflows.permission.${mode}`)}
										</option>
									))}
							</select>
						</label>
						{needsAcknowledgement && (
							<label className="flex gap-2 text-sm">
								<input
									type="checkbox"
									checked={acknowledged}
									onChange={(event) => setAcknowledged(event.target.checked)}
								/>
								<span>{t('workflows.projectSettings.fullAccess')}</span>
							</label>
						)}
						{environmentRedacted ? (
							<p>{t('workflows.projectSettings.environmentDesktopOnly')}</p>
						) : (
							<EnvVarsEditor
								key={scopeKey}
								theme={theme}
								envVars={draft.envVars ?? {}}
								setEnvVars={(envVars) => setDraft((current) => ({ ...current, envVars }))}
								label={t('workflows.projectSettings.environment')}
								description={t('workflows.projectSettings.environmentHelp')}
								maskSecrets
								onValidityChange={setValidEnvironment}
							/>
						)}
						{newShell && !environmentRedacted && (
							<section
								className="space-y-3 border-t pt-4"
								style={{ borderColor: theme.colors.border }}
							>
								<h3 className="text-sm font-medium">
									{t('workflows.projectSettings.toolsHeading')}
								</h3>
								{scopedSessions.map((session) => (
									<ProjectToolConfig
										key={session.id}
										theme={theme}
										session={session}
										patch={toolPatches[session.id] ?? {}}
										onChange={(update) =>
											setToolPatches((previous) => ({
												...previous,
												[session.id]: update(previous[session.id] ?? {}),
											}))
										}
									/>
								))}
							</section>
						)}
					</fieldset>
				)}
			</div>
		</Modal>
	);
}
