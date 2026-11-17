import type { TeamState } from '../../../shared/team/types';
import { SEAT_ROLES } from '../../../shared/team/types';
import type { Theme } from '../../types';
import { useT } from '../../i18n';
import { useTeamStore } from '../../stores/teamStore';
import { SegmentedControl } from '../ui/SegmentedControl';
import { EscCloseButton } from '../ui/EscCloseButton';
import { ChangesPanel } from '../ChangesPanel';
import { TeamOutput } from './TeamOutput';
import { Criteria, SeatTag } from './TeamPrimitives';

export type TeamPanelTab = 'output' | 'progress' | 'decisions' | 'evidence' | 'members' | 'changes';
const TABS: TeamPanelTab[] = ['output', 'progress', 'decisions', 'evidence', 'members', 'changes'];

export function TeamPanel({
	state,
	theme,
	tab,
	onTab,
	onClose,
}: {
	state: TeamState;
	theme: Theme;
	tab: TeamPanelTab;
	onTab: (tab: TeamPanelTab) => void;
	onClose: () => void;
}) {
	const t = useT();
	const config = state.config!;
	const events = useTeamStore((s) => s.teams[config.id]?.events);
	const models = SEAT_ROLES.map((seat) => state.seats[seat].model ?? config.seats[seat]);
	const dev = state.seats.dev.binding;
	const bound = SEAT_ROLES.map((seat) => state.seats[seat].binding);
	const conversationsSeparate =
		bound.every((b) => b?.nativeSessionId) &&
		new Set(bound.map((b) => b?.nativeSessionId)).size === 3;
	const workspacesSeparate =
		!!bound[1]?.workspace && !!bound[2]?.workspace && bound[1].workspace !== bound[2].workspace;
	return (
		<aside
			className="w-[360px] max-w-full shrink-0 border-l flex flex-col min-h-0 max-lg:absolute max-lg:right-0 max-lg:inset-y-0 max-lg:z-20"
			style={{ borderColor: 'var(--team-border)', background: 'var(--team-side)' }}
			aria-label={t('workflows.team.panel')}
		>
			<div className="p-2 flex gap-2 border-b" style={{ borderColor: 'var(--team-border)' }}>
				<SegmentedControl
					theme={theme}
					value={tab}
					onChange={onTab}
					options={TABS.map((value) => ({ value, label: t(`workflows.team.panel.${value}`) }))}
					ariaLabel={t('workflows.team.panel')}
				/>
				<EscCloseButton theme={theme} onClose={onClose} />
			</div>
			<div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
				{tab === 'output' && <TeamOutput state={state} theme={theme} />}
				{tab === 'progress' && (
					<>
						<h3>{t('workflows.team.workItems')}</h3>
						{state.workItems.map((item) => (
							<div className="team-item" key={item.itemId}>
								<p>
									{item.itemId} · {item.title}
								</p>
								<p className="team-dim">{t(`workflows.team.${item.state}`)}</p>
								<SeatTag seat={item.owner} />
							</div>
						))}
						<h3>{t('workflows.team.issues')}</h3>
						{state.issues.map((issue) => (
							<div className="team-item" key={issue.id}>
								{issue.opened.title}
								<p className="team-dim">{t(`workflows.team.${issue.state}`)}</p>
							</div>
						))}
						<h3>{t('workflows.team.waitingFor')}</h3>
						{state.followUps.map((wait) => (
							<div key={wait.id} className="team-item">
								{wait.waitFor}
								<p className="team-dim">{wait.reason}</p>
							</div>
						))}
						{state.residual.length > 0 && (
							<>
								<h3>{t('workflows.team.residual')}</h3>
								{state.residual.map((item) => (
									<p key={item}>{item}</p>
								))}
							</>
						)}
						{state.reviews.some((r) => r.suggestions.length) && (
							<>
								<h3>{t('workflows.team.suggestions')}</h3>
								{state.reviews.flatMap((r) =>
									r.suggestions.map((s, i) => <p key={`${r.id}:${i}`}>{s}</p>)
								)}
							</>
						)}
					</>
				)}
				{tab === 'decisions' && (
					<>
						{state.decisions.map((decision) => (
							<div className="team-item" key={decision.id}>
								<p>{decision.decision}</p>
								<p className="team-dim">
									{t(`workflows.team.${decision.decider}`)} · {decision.dissent}
								</p>
							</div>
						))}
						{state.cardAnswers.map((answer) => (
							<div className="team-item" key={answer.id}>
								{t('workflows.team.owner')} ·{' '}
								{events
									?.filter((event) => event.kind === 'decision_card')
									.find((event) => event.card.id === answer.cardId)
									?.card.options.find((option) => option.id === answer.optionId)?.label ??
									answer.optionId}
								<p>{answer.note}</p>
							</div>
						))}
						{state.standardChanges.length > 0 && (
							<>
								<h3>{t('workflows.team.standardChanges')}</h3>
								{state.standardChanges.map((change) => (
									<div key={change.id} className="team-item">
										{change.criterionId}: {change.before} → {change.after}
										<p className="team-dim">
											{change.reason} · {t(`workflows.team.${change.approvedBy}`)}
										</p>
									</div>
								))}
							</>
						)}
						{!state.decisions.length && !state.cardAnswers.length && (
							<p className="team-dim">{t('workflows.team.noDecisions')}</p>
						)}
					</>
				)}
				{tab === 'evidence' && (
					<>
						<Criteria state={state} />
						<p className="team-dim">{t('workflows.team.evidenceSource')}</p>
					</>
				)}
				{tab === 'members' && (
					<>
						{SEAT_ROLES.map((seat) => (
							<div className="team-item space-y-2" key={seat}>
								<div className="flex flex-wrap gap-2 justify-between">
									<SeatTag seat={seat} model={state.seats[seat].model ?? config.seats[seat]} />
									<button
										className="team-button"
										onClick={() => useTeamStore.getState().selectTeam(config.id, seat)}
									>
										{t('workflows.team.openConversation')}
									</button>
								</div>
								<p className="team-dim">{t(`workflows.team.${seat}Workspace`)}</p>
								<p className="team-dim break-all">{state.seats[seat].binding?.workspace}</p>
								<p className="team-dim">
									{t('workflows.team.substitute')}:{' '}
									{config.seats[seat].substitute ? (
										<SeatTag seat={seat} model={config.seats[seat].substitute} />
									) : (
										t('workflows.team.noSubstitute')
									)}
								</p>
							</div>
						))}
						<h3>{t('workflows.team.isolation')}</h3>
						<p className="team-dim">
							{t('workflows.team.conversations')}:{' '}
							{t(conversationsSeparate ? 'workflows.team.yes' : 'workflows.team.notConfirmed')}
						</p>
						<p className="team-dim">
							{t('workflows.team.workspaces')}:{' '}
							{t(workspacesSeparate ? 'workflows.team.yes' : 'workflows.team.notConfirmed')}
						</p>
						<p className="team-dim">
							{t('workflows.team.checksByApp')}:{' '}
							{state.checks.length ? state.checks.length : t('workflows.team.noneYet')}
						</p>
						<p className="team-dim">
							{t('workflows.team.sources')}:{' '}
							{t(
								models[1].tool === models[2].tool
									? 'workflows.team.sameVendor'
									: 'workflows.team.differentVendors'
							)}
						</p>
						<h3>{t('workflows.team.auth')}</h3>
						{(Object.keys(config.authorizations) as Array<keyof typeof config.authorizations>).map(
							(key) => (
								<p key={key} className="team-dim">
									{t(`workflows.team.auth.${key}`)}:{' '}
									{t(
										config.authorizations[key]
											? 'workflows.team.authorized'
											: 'workflows.team.notAuthorized'
									)}
								</p>
							)
						)}
						<p className="team-dim">
							{t('workflows.team.turns', { used: state.usage.turns, total: config.turnBudget })}
						</p>
						<p className="team-dim">{t('workflows.team.alwaysAsk')}</p>
					</>
				)}
				{tab === 'changes' &&
					(dev ? (
						<ChangesPanel
							theme={theme}
							readOnlyScope={{
								cwd: dev.workspace,
								sshRemoteId: config.sshRemoteId,
								revision: state.usage.durationMs,
							}}
						/>
					) : (
						<p className="team-dim">{t('workflows.team.changesUnavailable')}</p>
					))}
			</div>
		</aside>
	);
}
