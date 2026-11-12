import { getTranslator } from '../../renderer/i18n/translate';
import { resolveAppLocale } from '../../shared/i18n';
import { readSettingValue } from '../services/storage';
import { isSecretEnvKey, maskEnvValue } from '../../shared/agentEnvironment';
import type {
	ProjectSettingsCommand,
	ProjectSettingsPatch,
	ProjectSettingsResult,
} from '../../shared/projectSettings';
import { failCommand, reportResult, sendSimpleCommand } from '../services/session-command';
import { isInheritValue, resolveCliPath } from '../utils/parse';

interface ProjectSettingsOptions {
	autoHandoff?: string;
	toolConfig?: string;
	path?: string;
	sshRemote?: string;
	provider?: string;
	model?: string;
	modelProvider?: string;
	effort?: string;
	permission?: string;
	env?: readonly string[];
	clearEnv?: boolean;
	acknowledgeFullAccess?: boolean;
	showSecrets?: boolean;
	json?: boolean;
}

export function projectSettingsTranslator() {
	return getTranslator(
		resolveAppLocale(readSettingValue('uiLanguage'), Intl.DateTimeFormat().resolvedOptions().locale)
	);
}

/** The CLI and project dialog call the same validation and Maestro store write. */
export async function projectSettings(
	action: string,
	options: ProjectSettingsOptions
): Promise<void> {
	const t = projectSettingsTranslator();
	try {
		if (!['show', 'set'].includes(action) || !options.path?.trim())
			throw new Error(t('workflows.projectSettings.cli.usage'));
		const patch: ProjectSettingsPatch = {};
		let toolPatches: Record<string, Record<string, unknown>> | undefined;
		if (options.toolConfig !== undefined) {
			try {
				const parsed = JSON.parse(options.toolConfig);
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
				toolPatches = parsed;
			} catch {
				throw new Error(t('workflows.projectSettings.cli.invalidToolConfig'));
			}
		}
		for (const [field, value] of [
			['defaultProvider', options.provider],
			['defaultModel', options.model],
			['modelProvider', options.modelProvider],
			['defaultReasoningEffort', options.effort],
			['defaultPermissionMode', options.permission],
		] as const) {
			if (value !== undefined)
				Object.assign(patch, { [field]: isInheritValue(value) ? null : value });
		}
		if (options.autoHandoff !== undefined)
			patch.autoHandoffTarget = options.autoHandoff === 'off' ? null : options.autoHandoff;
		if (options.clearEnv && options.env?.length)
			throw new Error(t('workflows.projectSettings.cli.conflictingEnv'));
		if (options.clearEnv) patch.envVars = null;
		if (options.env?.length) {
			patch.envVars = Object.fromEntries(
				options.env.map((entry) => {
					const separator = entry.indexOf('=');
					if (separator <= 0) throw new Error(t('workflows.projectSettings.cli.envFormat'));
					return [entry.slice(0, separator), entry.slice(separator + 1)];
				})
			);
		}
		if (
			action === 'show' &&
			(Object.keys(patch).length || toolPatches !== undefined || options.acknowledgeFullAccess)
		)
			throw new Error(t('workflows.projectSettings.cli.setOnly'));
		if (action === 'set' && !Object.keys(patch).length && !Object.keys(toolPatches ?? {}).length)
			throw new Error(t('workflows.projectSettings.cli.emptyPatch'));
		const scope = {
			projectPath: options.sshRemote ? options.path : resolveCliPath(options.path),
			...(options.sshRemote !== undefined ? { sshRemoteId: options.sshRemote } : {}),
		};
		const command: ProjectSettingsCommand =
			action === 'show'
				? { action: 'show', scope }
				: {
						action: 'set',
						scope,
						patch,
						...(toolPatches !== undefined ? { toolPatches } : {}),
						...(options.acknowledgeFullAccess ? { acknowledgeFullAccess: true } : {}),
					};
		const reply = await sendSimpleCommand<{
			ok: boolean;
			result: ProjectSettingsResult;
			error?: string;
		}>(
			{ type: 'bridge.invoke', channel: 'settings:projectSettings', args: [command] },
			'bridge.response'
		);
		if (!reply.ok) throw new Error(reply.error ?? t('workflows.projectSettings.cli.requestFailed'));
		const result = {
			...reply.result,
			...(reply.result.errorCode
				? {
						error: t(
							`workflows.projectSettings.errors.${reply.result.errorCode}`,
							reply.result.params
						),
					}
				: {}),
		};
		const shown = {
			...result,
			settings: {
				...result.settings,
				...(result.settings.envVars
					? {
							envVars: Object.fromEntries(
								Object.entries(result.settings.envVars).map(([name, value]) => [
									name,
									!options.showSecrets && isSecretEnvKey(name) ? maskEnvValue(value) : value,
								])
							),
						}
					: {}),
			},
		};
		if (options.json)
			return reportResult({ ...result }, { json: true, successMessage: '', jsonResult: shown });
		if (!result.success)
			return failCommand(result.error ?? t('workflows.projectSettings.cli.requestFailed'));
		console.log(JSON.stringify(shown, null, 2));
	} catch (error) {
		return failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
