import type { MessageKey, TFunction } from '../../../i18n';
import { getPermissionModeLabel, getPermissionModeTooltip } from '../../../../shared/agentMetadata';

type PermissionMode = 'full' | 'standard' | 'readonly';

const PERMISSION_LABEL_KEYS: Record<string, MessageKey> = {
	'Full Access': 'workflows.permission.full',
	Standard: 'workflows.permission.standard',
	'Read Only': 'workflows.permission.readonly',
	'Read-Only': 'workflows.permission.readonlyHyphen',
	'Plan-Mode': 'workflows.permission.plan',
};

/** Keep provider-specific mode names and stored permission values authoritative. */
export function permissionModeLabel(t: TFunction, mode: PermissionMode, agentId?: string): string {
	const label = getPermissionModeLabel(mode, agentId);
	const key = PERMISSION_LABEL_KEYS[label];
	return key ? t(key) : label;
}

export function permissionModeTooltip(
	t: TFunction,
	mode: PermissionMode,
	agentId?: string
): string {
	if (mode === 'full') return t('workflows.permission.fullHint');
	if (mode === 'standard') return t('workflows.permission.standardHint');
	if (!agentId) return t('workflows.permission.readonlyHint');
	const label = getPermissionModeLabel(mode, agentId);
	if (label === 'Plan-Mode') return t('workflows.permission.planHint');
	if (label === 'Read-Only') return t('workflows.permission.agentReadonlyHint');
	return getPermissionModeTooltip(mode, agentId);
}
