import { memo, useMemo } from 'react';
import type { Session, Theme } from '../types';
import { ModelEffortPicker } from './ModelEffortPicker';
import { useModalStore, selectModalData, selectModalOpen } from '../stores/modalStore';
import { useTabStore } from '../stores/tabStore';
import {
	useConversationModelCatalog,
	resolveModelEffort,
} from '../hooks/agent/useAgentModelEffortOptions';
import { NATIVE_MODEL_DEFAULT, type ProviderModelCatalog } from '../../shared/modelCatalog';

/** Composer adapter. The exported picker itself has no conversation/store dependency. */
export const ConversationModelEffortPicker = memo(function ConversationModelEffortPicker({
	session,
	theme,
	currentModel,
	currentEffort,
	availableModels,
	availableEfforts,
	shortcutKeys,
}: {
	session: Session;
	theme: Theme;
	currentModel?: string;
	currentEffort?: string;
	availableModels: string[];
	availableEfforts: string[];
	shortcutKeys?: string[];
}) {
	const tabId = session.activeTabId;
	const tab = session.aiTabs.find((item) => item.id === tabId);
	const open = useModalStore(
		(state) =>
			selectModalOpen('modelEffort')(state) &&
			selectModalData('modelEffort')(state)?.tabId === tabId
	);
	const catalog = useConversationModelCatalog(
		{
			provider: session.toolType as 'codex' | 'claude-code',
			sessionId: session.id,
			account: { customEnvVars: session.customEnvVars },
			sshRemoteId: session.sshRemoteId,
		},
		open
	);
	const fallback = useMemo<ProviderModelCatalog>(
		() => ({
			provider: session.toolType as 'codex' | 'claude-code',
			effortLabel: session.toolType === 'codex' ? 'Reasoning' : 'Effort',
			models: availableModels.filter(Boolean).map((id) => ({
				id,
				displayName: id,
				description: '',
				group: 'current',
				hidden: false,
				efforts: availableEfforts
					.filter(Boolean)
					.map((effort) => ({ id: effort, description: '' })),
			})),
			fallbackEfforts: availableEfforts.filter(Boolean).map((id) => ({ id, description: '' })),
			followDefault: { modelId: null, source: 'unresolved' },
			source: { kind: 'fallback', files: [] },
			stale: true,
			error: 'unreadable',
		}),
		[session.toolType, availableModels, availableEfforts]
	);
	const data = useMemo(
		() =>
			!catalog
				? fallback
				: catalog.source.kind === 'fallback' && fallback.models.length
					? { ...catalog, models: fallback.models }
					: catalog,
		[catalog, fallback]
	);
	const effective = resolveModelEffort(tab, session, {
		defaultModel: currentModel ?? '',
		defaultEffort: currentEffort ?? '',
	});
	const scope =
		data.accountKey ?? JSON.stringify([session.toolType, session.id, session.sshRemoteId]);
	const remembered = useMemo(() => tab?.modelEfforts?.[scope] ?? {}, [tab?.modelEfforts, scope]);
	if (!tab) return null;
	return (
		<ModelEffortPicker
			theme={theme}
			catalog={data}
			policy="conversation"
			model={effective.model === NATIVE_MODEL_DEFAULT ? '' : effective.model}
			effort={effective.effort === NATIVE_MODEL_DEFAULT ? undefined : effective.effort}
			remembered={remembered}
			running={tab.state === 'busy'}
			shortcutKeys={shortcutKeys}
			open={open}
			onOpenChange={(value) =>
				value
					? useModalStore.getState().openModal('modelEffort', { tabId })
					: useModalStore.getState().closeModal('modelEffort')
			}
			onChange={(selection) =>
				useTabStore.getState().setTabModelEffort(session.id, tabId, scope, selection)
			}
		/>
	);
});
