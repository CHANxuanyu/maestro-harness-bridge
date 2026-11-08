/**
 * Human-readable titles for agent error types.
 * Used for toast notifications and history entries.
 */

import type { TFunction } from '../../../../i18n';
import type { AgentError } from '../../../../types';

export function getErrorTitleForType(type: AgentError['type'], t?: TFunction): string {
	switch (type) {
		case 'auth_expired':
			return t
				? t('workflows.newShellCopy.feedback.error.auth_expired')
				: 'Authentication Required';
		case 'token_exhaustion':
			return t
				? t('workflows.newShellCopy.feedback.error.token_exhaustion')
				: 'Context Limit Reached';
		case 'rate_limited':
			return t ? t('workflows.newShellCopy.feedback.error.rate_limited') : 'Rate Limit Exceeded';
		case 'network_error':
			return t ? t('workflows.newShellCopy.feedback.error.network_error') : 'Connection Error';
		case 'agent_crashed':
			return t ? t('workflows.newShellCopy.feedback.error.agent_crashed') : 'Agent Error';
		case 'permission_denied':
			return t ? t('workflows.newShellCopy.feedback.error.permission_denied') : 'Permission Denied';
		case 'session_busy':
			return t ? t('workflows.newShellCopy.feedback.error.session_busy') : 'Session In Use';
		case 'session_not_found':
			return t ? t('workflows.newShellCopy.feedback.error.session_not_found') : 'Session Not Found';
		default:
			return t ? t('workflows.newShellCopy.feedback.error.unknown') : 'Error';
	}
}
