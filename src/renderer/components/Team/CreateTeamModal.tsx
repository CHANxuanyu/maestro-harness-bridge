import { useEffect, useRef, useState } from 'react';
import {
	DEFAULT_TEAM_AUTHORIZATIONS,
	DEFAULT_TEAM_TURN_BUDGET,
	SEAT_ROLES,
	type SeatConfig,
	type SeatModel,
	type SeatRole,
} from '../../../shared/team/types';
import {
	rememberedEffortForModel,
	teamSeatEfforts,
	type ModelCatalogProvider,
} from '../../../shared/modelCatalog';
import { projectSettingsScopeForSession } from '../../../shared/projectSettings';
import { resolveGitSshRemoteId } from '../../hooks/git/useGitAgentActions';
import { useConversationModelCatalog } from '../../hooks/agent/useAgentModelEffortOptions';
import { ModelEffortPicker } from '../ModelEffortPicker';
import { Modal } from '../ui/Modal';
import { EscCloseButton } from '../ui/EscCloseButton';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { useFocusAfterRender } from '../../hooks/utils/useFocusAfterRender';
import { useT } from '../../i18n';
import { useTeamStore } from '../../stores/teamStore';
import { selectActiveSession, useSessionStore } from '../../stores/sessionStore';
import type { Theme } from '../../types';
import { SeatTag, teamStyle } from './TeamPrimitives';

function SeatPicker({
	theme,
	value,
	onChange,
	label,
	sshRemoteId,
}: {
	theme: Theme;
	value: SeatModel;
	onChange: (value: SeatModel) => void;
	label: string;
	sshRemoteId?: string;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const provider = value.tool as ModelCatalogProvider;
	const catalog = useConversationModelCatalog({ provider, sshRemoteId }, open);
	useEffect(() => {
		if (!catalog || provider !== 'codex') return;
		const model = catalog.models.find(
			(entry) => entry.id === (value.model || catalog.followDefault.modelId)
		);
		if (!model) return;
		const efforts = teamSeatEfforts(provider, model);
		if (value.effort && efforts.some((entry) => entry.id === value.effort)) return;
		const effort = rememberedEffortForModel({}, { ...model, efforts }) ?? efforts[0]?.id;
		// Pin an allowed effort even when the unopened picker follows a native Ultra default.
		if (effort !== value.effort) onChange({ ...value, effort });
	}, [catalog, provider, value, onChange]);
	return (
		<div className="flex flex-wrap items-center gap-1 min-w-0" role="group" aria-label={label}>
			<select
				aria-label={`${label} ${t('workflows.team.tool')}`}
				value={value.tool}
				onChange={(e) => onChange({ tool: e.target.value as ModelCatalogProvider })}
			>
				<option value="claude-code">Claude Code</option>
				<option value="codex">Codex</option>
			</select>
			{catalog ? (
				<ModelEffortPicker
					key={`${provider}:${catalog.accountKey}`}
					theme={theme}
					catalog={catalog}
					policy="team-seat"
					model={value.model ?? ''}
					effort={value.effort}
					remembered={{}}
					open={open}
					onOpenChange={setOpen}
					onChange={(selection) =>
						onChange({
							tool: provider,
							model: selection.model || undefined,
							effort: selection.effort,
						})
					}
				/>
			) : (
				<span className="team-dim">{t('workflows.team.catalogUnavailable')}</span>
			)}
		</div>
	);
}

export function CreateTeamModal({
	theme,
	open,
	onClose,
}: {
	theme: Theme;
	open: boolean;
	onClose: () => void;
}) {
	const t = useT();
	const session = useSessionStore(selectActiveSession);
	const sshRemoteId = session ? resolveGitSshRemoteId(session) : undefined;
	const missingRemote =
		session?.sessionSshRemoteConfig?.enabled && !session.sessionSshRemoteConfig.remoteId;
	const projectRoot =
		session && !missingRemote ? projectSettingsScopeForSession(session).projectPath : undefined;
	const [idea, setIdea] = useState('');
	const [seats, setSeats] = useState<Record<SeatRole, SeatConfig>>({
		pm: { tool: 'claude-code' },
		dev: { tool: 'codex' },
		qa: { tool: 'claude-code' },
	});
	const [deadline, setDeadline] = useState('today');
	const [turnBudget, setTurnBudget] = useState(DEFAULT_TEAM_TURN_BUDGET);
	const [authorizations, setAuthorizations] = useState({ ...DEFAULT_TEAM_AUTHORIZATIONS });
	const available = useTeamStore((s) => s.available);
	const pending = useTeamStore((s) => s.pending.create);
	const error = useTeamStore((s) => s.error);
	const ideaRef = useRef<HTMLTextAreaElement>(null);
	const wasOpen = useRef(false);
	useFocusAfterRender(ideaRef, open && !wasOpen.current);
	useEffect(() => {
		wasOpen.current = open;
	}, [open]);
	const create = async () => {
		if (!projectRoot || missingRemote || !idea.trim()) return;
		const due = new Date();
		if (deadline === 'tomorrow') due.setDate(due.getDate() + 1);
		due.setHours(deadline === 'tomorrow' ? 10 : 18, 0, 0, 0);
		const ok = await useTeamStore.getState().create({
			idea: idea.trim(),
			projectRoot,
			seats,
			deadline: deadline === 'none' ? undefined : due.getTime(),
			turnBudget,
			authorizations,
			sshRemoteId,
		});
		if (ok) setIdea('');
	};
	return (
		<Modal
			theme={theme}
			title={t('workflows.team.new')}
			priority={MODAL_PRIORITIES.NEW_GROUP_CHAT}
			onClose={onClose}
			hidden={!open}
			resizeKey="create-team"
			zIndex={900}
			initialFocusRef={ideaRef}
			width={720}
			portal
			showHeader={false}
			contentClassName="p-5 overflow-y-auto flex-1"
		>
			<div className="team-surface space-y-4" style={teamStyle(theme)}>
				<header className="flex items-center justify-between">
					<h2 className="font-semibold text-base">{t('workflows.team.new')}</h2>
					<EscCloseButton theme={theme} onClose={onClose} />
				</header>
				<label className="block space-y-1">
					<span>{t('workflows.team.idea')}</span>
					<textarea
						ref={ideaRef}
						className="w-full"
						rows={2}
						value={idea}
						onChange={(e) => setIdea(e.target.value)}
					/>
				</label>
				{idea.trim().length > 0 && idea.trim().length < 20 && (
					<p className="team-dim">{t('workflows.team.ideaHint')}</p>
				)}
				<fieldset className="space-y-2">
					<legend className="mb-2">{t('workflows.team.membersSetup')}</legend>
					{SEAT_ROLES.map((seat) => (
						<div
							key={seat}
							className="grid grid-cols-[64px_1.5fr_1fr] gap-2 items-start max-sm:grid-cols-1"
						>
							<SeatTag seat={seat} />
							<SeatPicker
								theme={theme}
								value={seats[seat]}
								label={t(`workflows.team.${seat}`)}
								sshRemoteId={sshRemoteId}
								onChange={(value) =>
									setSeats((s) => ({ ...s, [seat]: { ...value, substitute: s[seat].substitute } }))
								}
							/>
							<div>
								<label className="flex gap-2 items-center text-xs">
									<input
										type="checkbox"
										checked={!!seats[seat].substitute}
										onChange={(e) =>
											setSeats((s) => ({
												...s,
												[seat]: {
													...s[seat],
													substitute: e.target.checked ? { tool: s[seat].tool } : undefined,
												},
											}))
										}
									/>
									{t(`workflows.team.${seat}`)} {t('workflows.team.substitute')}
								</label>
								{seats[seat].substitute ? (
									<SeatPicker
										theme={theme}
										value={seats[seat].substitute!}
										label={`${t(`workflows.team.${seat}`)} ${t('workflows.team.substitute')}`}
										sshRemoteId={sshRemoteId}
										onChange={(value) =>
											setSeats((s) => ({ ...s, [seat]: { ...s[seat], substitute: value } }))
										}
									/>
								) : (
									<span className="team-dim">{t('workflows.team.noSubstitute')}</span>
								)}
							</div>
						</div>
					))}
				</fieldset>
				<p className="team-dim">{t('workflows.team.pmRecovery')}</p>
				<p className="team-dim">
					{t(
						seats.dev.tool === seats.qa.tool
							? 'workflows.team.sameVendor'
							: 'workflows.team.differentVendors'
					)}
				</p>
				<fieldset>
					<legend className="mb-2">{t('workflows.team.budgetHeading')}</legend>
					<div className="flex flex-wrap gap-3 items-center">
						<label>
							{t('workflows.team.deadline')}{' '}
							<select value={deadline} onChange={(e) => setDeadline(e.target.value)}>
								<option value="today">{t('workflows.team.today')}</option>
								<option value="tomorrow">{t('workflows.team.tomorrow')}</option>
								<option value="none">{t('workflows.team.noDeadline')}</option>
							</select>
						</label>
						<label>
							{t('workflows.team.turnBudget')}{' '}
							<input
								type="number"
								className="w-20"
								min={10}
								max={200}
								value={turnBudget}
								onChange={(e) => setTurnBudget(Number(e.target.value))}
							/>
						</label>
					</div>
				</fieldset>
				<fieldset className="space-y-2">
					<legend className="mb-2">{t('workflows.team.auth')}</legend>
					{(Object.keys(DEFAULT_TEAM_AUTHORIZATIONS) as Array<keyof typeof authorizations>).map(
						(key) => (
							<label key={key} className="flex items-start gap-2">
								<input
									className="mt-1"
									type="checkbox"
									checked={authorizations[key]}
									onChange={(e) => setAuthorizations((a) => ({ ...a, [key]: e.target.checked }))}
								/>
								{t(`workflows.team.auth.${key}`)}
							</label>
						)
					)}
				</fieldset>
				<p className="team-dim">{t('workflows.team.alwaysAsk')}</p>
				{!projectRoot && !missingRemote && (
					<p role="status">{t('workflows.team.projectMissing')}</p>
				)}
				{missingRemote && <p role="alert">{t('workflows.changes.missingRemote')}</p>}
				{!available && <p role="status">{t('workflows.team.unavailable')}</p>}
				{error && <p role="alert">{t('workflows.team.error', { error })}</p>}
				<div className="flex justify-end gap-2">
					<button type="button" className="team-button" onClick={onClose}>
						{t('workflows.team.cancel')}
					</button>
					<button
						type="button"
						className="team-button"
						data-primary="true"
						disabled={
							!available ||
							!projectRoot ||
							missingRemote ||
							!idea.trim() ||
							!Number.isInteger(turnBudget) ||
							turnBudget < 10 ||
							turnBudget > 200 ||
							pending
						}
						onClick={() => void create()}
					>
						{t('workflows.team.start')}
					</button>
				</div>
			</div>
		</Modal>
	);
}
