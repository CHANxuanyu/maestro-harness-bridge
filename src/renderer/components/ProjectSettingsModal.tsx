import { useAgentCapabilities } from '../hooks/agent/useAgentCapabilities';
import { projectSettingsScopeForSession } from '../utils/projectConversationDefaults';
import { permissionModes } from '../utils/tabHelpers/focusFields';
import { useEffect, useId, useMemo, useState } from 'react';
import type { Session, Theme } from '../types';
import type { ProjectSettings, ProjectSettingsScope } from '../../shared/projectSettings';
import { projectSettingsKey } from '../../shared/projectSettings';
import { HANDOFF_PROVIDERS } from '../../shared/aiHandoff';
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

/** Edits Maestro defaults. Existing conversations and provider files are untouched. */
export function ProjectSettingsModal({
	theme,
	name,
	scopes,
	sessions,
	onClose,
}: ProjectSettingsModalProps) {
	const t = useT();
	const id = useId();
	const [scopeIndex, setScopeIndex] = useState(0);
	const scope = scopes[scopeIndex];
	const scopeKey = scope ? projectSettingsKey(scope) : '';
	const [loadedScope, setLoadedScope] = useState('');
	const [draft, setDraft] = useState<ProjectSettings>({});
	const [acknowledged, setAcknowledged] = useState(false);
	const [saving, setSaving] = useState(false);
	const [validEnvironment, setValidEnvironment] = useState(true);
	const [error, setError] = useState(false);
	const scopedSessions = sessions.filter(
		(session) => projectSettingsKey(projectSettingsScopeForSession(session)) === scopeKey
	);
	const provider =
		draft.defaultProvider || sessionProviderId(scopedSessions[0] ?? { toolType: 'claude-code' });
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
		setError(false);
		setAcknowledged(false);
		void window.maestro.settings
			.projectSettings({ action: 'show', scope })
			.then((result) => {
				if (stale) return;
				if (!result.success) {
					setError(true);
					return;
				}
				setDraft(result.settings);
				setLoadedScope(scopeKey);
			})
			.catch(() => {
				if (!stale) setError(true);
			});
		return () => {
			stale = true;
		};
	}, [scopeKey]);

	const save = async () => {
		if (!ready || saving || !validEnvironment || (needsAcknowledgement && !acknowledged)) return;
		setSaving(true);
		setError(false);
		try {
			const result = await window.maestro.settings.projectSettings({
				action: 'set',
				scope,
				patch: {
					defaultProvider: draft.defaultProvider || null,
					defaultModel: draft.defaultModel?.trim() || null,
					defaultReasoningEffort: draft.defaultReasoningEffort || null,
					defaultPermissionMode: draft.defaultPermissionMode || null,
					envVars: draft.envVars ?? {},
				},
				acknowledgeFullAccess: needsAcknowledgement && acknowledged,
			});
			if (!result.success) {
				setError(true);
				return;
			}
			useSettingsStore.setState((state) => ({
				projectSettings: { ...state.projectSettings, [scopeKey]: result.settings },
			}));
			onClose();
		} catch {
			setError(true);
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
				<p className="text-sm" style={{ color: theme.colors.textDim }}>
					{t('workflows.projectSettings.description')}
				</p>
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
				{error && (
					<p role="alert" className="text-sm" style={{ color: theme.colors.error }}>
						{t('workflows.projectSettings.failed')}
					</p>
				)}
				{!ready && !error && <p role="status">{t('workflows.projectSettings.loading')}</p>}
				{ready && (
					<fieldset disabled={saving} className="space-y-4">
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
								{permissionModes(!!capabilities.supportsStandardPermissionMode)
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
					</fieldset>
				)}
			</div>
		</Modal>
	);
}
