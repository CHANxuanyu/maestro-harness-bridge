import { useEffect, useMemo, useRef, useState } from 'react';
import type { SeatRole, TeamState } from '../../../shared/team/types';
import { teamReplyMessage } from '../../../shared/team/report';
import { discussionPositionsOpen } from './TeamDiscussion';
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
import { FeedEvent, ReportMessage } from './TeamFeed';
import { SeatTag, TeamFold } from './TeamPrimitives';

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
	const events = useTeamStore((store) => store.teams[teamId]?.events);
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
	const visibleMessages = useMemo(() => {
		let assignment: TeamState['turns'][number] | undefined;
		return messages.map((message) => {
			const dispatched = state.turns.find(
				(turn) =>
					turn.seat === seat && message.content.includes(`[team-dispatch:${turn.dispatchId}]`)
			);
			if (dispatched?.dispatched) {
				assignment = dispatched;
				return {
					...message,
					content: `${t('workflows.team.assigned')}: ${t(`workflows.team.turn.${dispatched.dispatched.turn}`)}`,
				};
			}
			const discussion = state.discussions.find(
				(entry) => entry.id === assignment?.dispatched?.discussionId
			);
			return {
				...message,
				content:
					assignment?.dispatched?.turn === 'position' &&
					discussion &&
					!discussionPositionsOpen(discussion, state)
						? t('workflows.team.sealed')
						: teamReplyMessage(message.content),
			};
		});
	}, [messages, state, seat, t]);
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
			<div className="px-5 max-h-[45%] overflow-auto shrink-0" data-testid="team-member-turns">
				<TeamFold title={t('workflows.team.assignedTurns')}>
					{state.turns
						.filter((turn) => turn.seat === seat)
						.map((turn) => (
							<section
								key={turn.dispatchId}
								data-turn={turn.dispatchId}
								className="team-item space-y-2"
							>
								<h4>
									{t('workflows.team.assigned')}:{' '}
									{turn.dispatched && t(`workflows.team.turn.${turn.dispatched.turn}`)}
								</h4>
								{turn.report && (
									<div data-turn-reply>
										<h4>{t('workflows.team.reply')}</h4>
										<ReportMessage report={turn.report} state={state} />
									</div>
								)}
								<div data-turn-events>
									<h4>{t('workflows.team.produced')}</h4>
									{events
										?.filter((event) => event.id.startsWith(`${turn.dispatchId}:domain:`))
										.map((event) => (
											<FeedEvent
												key={event.id}
												event={event}
												state={state}
												events={events}
												theme={theme}
												onChanges={() => {}}
												readOnly
											/>
										))}
								</div>
							</section>
						))}
				</TeamFold>
			</div>
			{missing && <p className="team-dim px-5">{t('workflows.team.noTranscript')}</p>}
			<SessionMessagesView
				messages={visibleMessages}
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
