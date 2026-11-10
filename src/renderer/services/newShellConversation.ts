import { isValidAgentId } from '../../shared/agentIds';
import { projectSettingsForSession } from '../utils/projectConversationDefaults';
import type { Session } from '../types';
import { useOperationStore } from '../stores/operationStore';
import { getT } from '../i18n';
import { captureException } from '../utils/sentry';
import { useEffect, useState } from 'react';
import {
	isHandoffProvider,
	type HandoffProvider,
	type HandoffTargetsResult,
	type HandoffSourceSnapshot,
	type HandoffResult,
	type HandoffCommand,
} from '../../shared/aiHandoff';
import { useSettingsStore } from '../stores/settingsStore';
import { notifyToast } from '../stores/notificationStore';

/** The plus menu and empty conversation use the same configured tools on the project host. */
export function useNewConversationTools(sourceAgentId: string | undefined) {
	const newShell = useSettingsStore((s) => s.newShell);
	const [result, setResult] = useState<{ source: string; tools: HandoffProvider[] }>();
	useEffect(() => {
		if (!newShell || !sourceAgentId) return;
		let cancelled = false;
		void window.maestro.context
			.conversation({ action: 'targets', sourceAgentId, includeCurrent: true, localOnly: false })
			.then((value) => {
				if (!cancelled)
					setResult({
						source: sourceAgentId,
						tools: ((value as HandoffTargetsResult).targets ?? []).map((target) => target.provider),
					});
			})
			.catch((error) => {
				captureException(error, { tags: { context: 'newConversationTools' } });
				if (!cancelled) setResult({ source: sourceAgentId, tools: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [sourceAgentId, newShell]);
	return result && result.source === sourceAgentId && newShell ? result.tools : [];
}

export async function newShellConversation(
	sourceAgentId: string,
	targetProvider: string | undefined,
	replaceTabId?: string,
	options?: Omit<
		Extract<HandoffCommand, { action: 'new-conversation' }>,
		'action' | 'sourceAgentId' | 'targetProvider' | 'replaceTabId'
	>
) {
	const unlock = replaceTabId
		? useOperationStore.getState().lockTabReplacement(replaceTabId)
		: undefined;
	const result = await window.maestro.context
		.conversation({
			action: 'new-conversation',
			sourceAgentId,
			targetProvider,
			...(options ?? { replaceTabId }),
		})
		.catch((error) => {
			captureException(error, { tags: { context: 'newShellConversation' } });
			return {
				success: false as const,
				code: 'unavailable' as const,
				error: error instanceof Error ? error.message : String(error),
			};
		});
	unlock?.();
	if (!result.success)
		notifyToast({
			type: 'error',
			title: getT()('workflows.shell.newConversationFailed'),
			message: result.error ?? getT()('workflows.shell.newConversationFailed'),
		});
	return result;
}

/** Project entry points share this route with remote tab creation and the CLI. */
export async function newProjectConversation(
	session: Session,
	sourceTabId?: string,
	background = false,
	sourcePermission?: HandoffSourceSnapshot['sourcePermission'],
	prompt?: string,
	origin?: import('../../shared/aiHandoff').ConversationOrigin
) {
	if (!useSettingsStore.getState().newShell) return null;
	const project = projectSettingsForSession(session);
	if (
		(!project || !Object.keys(project).some((key) => key !== 'fullAccessAcknowledged')) &&
		!session.projectSettingsBaseEnv
	)
		return null;
	const provider = sourceTabId ? undefined : project?.defaultProvider;
	if (
		provider !== undefined &&
		!isHandoffProvider(provider) &&
		(!isValidAgentId(provider) || provider === 'terminal')
	)
		return null;
	return newShellConversation(session.id, provider, undefined, {
		sourceTabId,
		background,
		...(prompt ? { prompt } : {}),
		...(origin ? { origin } : {}),
		...(sourcePermission ? { sourcePermission } : {}),
	}) as Promise<HandoffResult>;
}
