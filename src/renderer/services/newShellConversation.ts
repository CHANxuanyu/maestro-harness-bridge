import { useOperationStore } from '../stores/operationStore';
import { getT } from '../i18n';
import { captureException } from '../utils/sentry';
import { useEffect, useState } from 'react';
import type { HandoffProvider, HandoffTargetsResult } from '../../shared/aiHandoff';
import { useSettingsStore } from '../stores/settingsStore';
import { notifyToast } from '../stores/notificationStore';

/** The plus menu and empty conversation use the same configured, local tools. */
export function useNewConversationTools(sourceAgentId: string | undefined) {
	const newShell = useSettingsStore((s) => s.newShell);
	const [result, setResult] = useState<{ source: string; tools: HandoffProvider[] }>();
	useEffect(() => {
		if (!newShell || !sourceAgentId) return;
		let cancelled = false;
		void window.maestro.context
			.conversation({ action: 'targets', sourceAgentId, includeCurrent: true, localOnly: true })
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
	targetProvider: HandoffProvider,
	replaceTabId?: string
) {
	const unlock = replaceTabId
		? useOperationStore.getState().lockTabReplacement(replaceTabId)
		: undefined;
	const result = await window.maestro.context
		.conversation({ action: 'new-conversation', sourceAgentId, targetProvider, replaceTabId })
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
