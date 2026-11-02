/**
 * AiHandoffModal - "Continue with another AI".
 *
 * Picks which AI takes over one tab's conversation, then asks the shared
 * handoff service (the one `maestro-cli handoff` also calls) for a DRAFT. The
 * request never carries `send`, so nothing can be sent from here: the user
 * lands on a new tab whose composer holds the draft, edits it there, and sends
 * it with the normal Send. The draft's size and what was left out are shown by
 * the note above that composer (`HandoffDraftBar`), which is also what explains
 * a draft prepared from the CLI.
 *
 * Targets come from `handoffTargets`, which already leaves out the source's own
 * provider, SSH, and CLIs this machine does not have. The dialog only says
 * where each draft will land: a new tab in the project's existing agent for
 * that provider, or a new agent.
 *
 * Nothing retries on its own. When no draft was made the dialog stays open with
 * the reason. When a draft was made but a later step failed (it was not saved,
 * say), the user is taken to it and told, because preparing again would open a
 * second draft tab rather than fix the first.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import type { Theme } from '../types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';
import { RadioGroup } from './ui/RadioGroup';
import { Spinner } from './ui/Spinner';
import { AgentLogo } from './Wizard/screens/AgentSelectionScreen/components/AgentLogo';
import { useSessionStore } from '../stores/sessionStore';
import { notifyToast } from '../stores/notificationStore';
import { jumpToAgent } from '../services/agentNavigation';
import { getTabDisplayName } from '../utils/tabHelpers';
import { conversationDisplayTitle } from '../utils/conversationTitle';
import { captureException } from '../utils/sentry';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { formatCount } from '../../shared/formatters';
import {
	DEFAULT_HANDOFF_BUDGET,
	type HandoffProvider,
	type HandoffTargetsResult,
} from '../../shared/aiHandoff';
import { useT } from '../i18n';

type HandoffTarget = NonNullable<HandoffTargetsResult['targets']>[number];

export interface AiHandoffModalProps {
	theme: Theme;
	/** The agent and tab whose conversation moves on. */
	sessionId: string;
	tabId: string;
	onClose: () => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AiHandoffModal({ theme, sessionId, tabId, onClose }: AiHandoffModalProps) {
	const t = useT();
	const tab = useSessionStore((state) =>
		state.sessions.find((session) => session.id === sessionId)?.aiTabs.find((x) => x.id === tabId)
	);
	const sessions = useSessionStore((state) => state.sessions);
	// `null` while the list is loading.
	const [targets, setTargets] = useState<HandoffTarget[] | null>(null);
	const [listError, setListError] = useState<string | null>(null);
	const [selected, setSelected] = useState<HandoffProvider | null>(null);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		window.maestro.context.handoffTargets(sessionId).then(
			(result) => {
				if (!live) return;
				if (!result.success) {
					setListError(result.error ?? '');
					setTargets([]);
					return;
				}
				const list = result.targets ?? [];
				setTargets(list);
				setSelected(list[0]?.provider ?? null);
			},
			(cause: unknown) => {
				if (!live) return;
				captureException(cause, { tags: { context: 'aiHandoffTargets' } });
				setListError(messageOf(cause));
				setTargets([]);
			}
		);
		return () => {
			live = false;
		};
	}, [sessionId]);

	const prepare = useCallback(async () => {
		if (!selected || busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		const provider = getAgentDisplayName(selected);
		try {
			const result = await window.maestro.context.handoff({
				sourceAgentId: sessionId,
				sourceTabId: tabId,
				targetProvider: selected,
			});
			if (result.agentId && result.tabId) {
				jumpToAgent(result.agentId, { tabId: result.tabId });
				if (!result.success) {
					const notSaved = result.code === 'persistence-failed';
					notifyToast({
						color: notSaved ? 'red' : 'orange',
						title: t(
							notSaved
								? 'workflows.sessions.handoff.notSavedTitle'
								: 'workflows.sessions.handoff.problemTitle'
						),
						message: notSaved
							? t('workflows.sessions.handoff.notSaved', { provider })
							: t('workflows.sessions.handoff.problem', { provider, error: result.error ?? '' }),
						dismissible: true,
						sessionId: result.agentId,
						tabId: result.tabId,
					});
				}
				onClose();
				return;
			}
			setError(t('workflows.sessions.handoff.failed', { error: result.error ?? '' }));
		} catch (cause) {
			captureException(cause, { tags: { context: 'aiHandoffPrepare' } });
			setError(t('workflows.sessions.handoff.failed', { error: messageOf(cause) }));
		}
		busyRef.current = false;
		setBusy(false);
	}, [onClose, selected, sessionId, t, tabId]);

	// Arrow keys move between the targets natively (they are radios). Enter
	// prepares from anywhere in the body; the footer buttons handle their own.
	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== 'Enter' || event.target instanceof HTMLButtonElement) return;
		event.preventDefault();
		void prepare();
	};

	const describeTarget = (target: HandoffTarget) => {
		const runner = target.runnerId
			? sessions.find((session) => session.id === target.runnerId)
			: undefined;
		const provider = getAgentDisplayName(target.provider);
		return target.runnerId
			? t('workflows.sessions.handoff.newTab', { name: runner?.name ?? provider })
			: t('workflows.sessions.handoff.newRunner', { provider });
	};

	const dim = { color: theme.colors.textDim };
	const alertStyle = {
		color: theme.colors.error,
		backgroundColor: `${theme.colors.error}12`,
		borderColor: `${theme.colors.error}40`,
	};

	return (
		<Modal
			theme={theme}
			title={t('workflows.sessions.handoff.title')}
			subtitle={tab ? (conversationDisplayTitle(tab) ?? getTabDisplayName(tab)) : undefined}
			headerIcon={<ArrowRightLeft className="w-4 h-4" style={{ color: theme.colors.accent }} />}
			priority={MODAL_PRIORITIES.AI_HANDOFF}
			onClose={onClose}
			width={460}
			testId="ai-handoff-modal"
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={() => void prepare()}
					confirmLabel={
						busy
							? t('workflows.sessions.handoff.preparing')
							: t('workflows.sessions.handoff.prepare')
					}
					confirmDisabled={!selected || busy}
				/>
			}
		>
			<div className="flex flex-col gap-4 select-none" onKeyDown={handleKeyDown}>
				<p className="text-sm leading-relaxed" style={dim}>
					{t('workflows.sessions.handoff.intro')}
				</p>

				{targets === null ? (
					<div className="flex items-center gap-2 text-xs py-3" style={dim}>
						<Spinner size={14} color={theme.colors.textDim} />
						{t('workflows.sessions.handoff.loading')}
					</div>
				) : listError !== null ? (
					<div role="alert" className="text-xs px-3 py-2 rounded border" style={alertStyle}>
						{t('workflows.sessions.handoff.listFailed', { error: listError })}
					</div>
				) : targets.length === 0 ? (
					<div
						className="text-xs leading-relaxed px-3 py-2.5 rounded-lg border"
						style={{ ...dim, borderColor: theme.colors.border }}
					>
						{t('workflows.sessions.handoff.none')}
					</div>
				) : (
					<div className="flex flex-col gap-2">
						<div className="text-2xs uppercase tracking-wide font-medium" style={dim}>
							{t('workflows.sessions.handoff.targets')}
						</div>
						<RadioGroup
							theme={theme}
							value={selected ?? ''}
							onChange={(value) => setSelected(value as HandoffProvider)}
							ariaLabel={t('workflows.sessions.handoff.targets')}
							autoFocus
							options={targets.map((target) => ({
								value: target.provider,
								label: getAgentDisplayName(target.provider),
								description: describeTarget(target),
								icon: (
									<AgentLogo
										agentId={target.provider}
										supported
										detected
										theme={theme}
										className="w-5 h-5"
									/>
								),
							}))}
						/>
						<p className="text-xs leading-relaxed" style={dim}>
							{t('workflows.sessions.handoff.scope', {
								budget: formatCount(DEFAULT_HANDOFF_BUDGET),
							})}
						</p>
					</div>
				)}

				{error && (
					<div
						role="alert"
						className="text-xs px-3 py-2 rounded border select-text"
						style={alertStyle}
					>
						{error}
					</div>
				)}
			</div>
		</Modal>
	);
}
