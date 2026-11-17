import { useEffect, useRef, useState } from 'react';
import type { SeatRole, TeamState } from '../../../shared/team/types';
import { teamClient } from '../../services/teamClient';
import { useTeamStore } from '../../stores/teamStore';
import { useT } from '../../i18n';
import type { Theme } from '../../types';
import type { SessionMessage } from '../../hooks/agent/useSessionViewer';
import { SessionMessagesView } from '../AgentSessionsBrowser/components/SessionMessagesView';
import { EscCloseButton } from '../ui/EscCloseButton';
import { useModalLayer } from '../../hooks/ui/useModalLayer';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { useFocusAfterRender } from '../../hooks/utils/useFocusAfterRender';
import { SeatTag } from './TeamPrimitives';

export function TeamMemberView({
	teamId,
	seat,
	state,
	theme,
}: {
	teamId: string;
	seat: SeatRole;
	state: TeamState;
	theme: Theme;
}) {
	const t = useT();
	const [messages, setMessages] = useState<SessionMessage[]>([]);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const [missing, setMissing] = useState(false);
	const [limit, setLimit] = useState(50);
	const [hasMore, setHasMore] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const focused = useRef(false);
	const back = () => useTeamStore.getState().backToTeam();
	useModalLayer(MODAL_PRIORITIES.GROUP_CHAT_INFO, t('workflows.team.back'), back, {
		capturesFocus: false,
		focusTrap: 'none',
		blocksAppShortcuts: false,
		blocksLowerLayers: false,
	});
	useFocusAfterRender(ref, !focused.current);
	useEffect(() => {
		focused.current = true;
	}, []);
	const revision = state.turns
		.filter((turn) => turn.seat === seat)
		.map((turn) => `${turn.dispatchId}:${turn.finished?.id ?? ''}:${turn.report ? 'reported' : ''}`)
		.join('|');
	const binding = state.seats[seat].binding;
	useEffect(() => {
		let stale = false;
		setLoading(true);
		setFailed(false);
		void (async () => {
			try {
				const transcript = await teamClient()?.seatTranscript(teamId, seat);
				if (stale) return;
				setMissing(!transcript?.nativeSessionId);
				if (!transcript?.nativeSessionId) {
					setMessages([]);
					return;
				}
				const result = await window.maestro.agentSessions.read(
					transcript.provider,
					transcript.cwd,
					transcript.nativeSessionId,
					{
						offset: 0,
						limit,
						readOnly: true,
						...(transcript.configDir ? { configDir: transcript.configDir } : {}),
					},
					state.config?.sshRemoteId
				);
				if (stale) return;
				setMessages(result.messages);
				setHasMore(result.hasMore);
			} catch {
				if (!stale) setFailed(true);
			} finally {
				if (!stale) setLoading(false);
			}
		})();
		return () => {
			stale = true;
		};
	}, [teamId, seat, binding, revision, limit, state.config?.sshRemoteId]);
	return (
		<div className="flex flex-col flex-1 min-w-0 min-h-0" data-testid="team-member-view">
			<header className="team-head">
				<button className="team-button" onClick={back}>
					← {state.config?.title}
				</button>
				<SeatTag seat={seat} model={state.seats[seat].model ?? state.config?.seats[seat]} />
				<span className="team-dim">{t(`workflows.team.${seat}Workspace`)}</span>
				<EscCloseButton
					theme={theme}
					onClose={back}
					label={t('workflows.team.back')}
					className="ml-auto"
				/>
			</header>
			<p className="team-dim px-5 py-3">{t('workflows.team.memberHint')}</p>
			{missing && <p className="team-dim px-5">{t('workflows.team.noTranscript')}</p>}
			<SessionMessagesView
				messages={messages}
				messagesLoading={loading}
				messagesError={failed ? 'failed' : null}
				hasMoreMessages={hasMore}
				theme={theme}
				messagesContainerRef={ref}
				onScroll={() => {}}
				onKeyDown={() => {}}
				handleLoadMore={() => setLimit((value) => value + 50)}
			/>
		</div>
	);
}
