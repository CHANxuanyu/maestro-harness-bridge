import { useEffect, useId, useRef, useState } from 'react';
import type {
	BaselineDiff,
	Brief,
	Criterion,
	OwnerCard,
	TeamState,
} from '../../../shared/team/types';
import { baselineDiff } from '../../../shared/team/policy';
import { teamClient, presentTeamText } from '../../services/teamClient';
import { useTeamStore } from '../../stores/teamStore';
import { useT, useFormatList } from '../../i18n';
import { useFocusAfterRender } from '../../hooks/utils/useFocusAfterRender';
import { teamPathLabel, criterionLabel, SeatTag, TeamFold } from './TeamPrimitives';

/** The card retains its own cycle even after a later owner edit starts another one. */
export function TeamBaselineChallenges({
	payload,
	state,
}: {
	payload: Extract<NonNullable<OwnerCard['payload']>, { type: 'baseline' }>;
	state: TeamState;
}) {
	const t = useT();
	const list = useFormatList();
	const challenges = payload.challenges ?? [];
	const versions = [...new Set(challenges.map((challenge) => challenge.briefVersion))];
	const round = payload.challengeRound;
	if (!round && !challenges.length) return null;
	return (
		<div className="space-y-2" data-card="baseline-challenges">
			{round && (
				<p className="team-dim" data-challenge-round={round.round}>
					{round.round === 2
						? t('workflows.team.challengeSecond', {
								criteria: list(
									round.criteria.map((id) => {
										const change = round.diff?.criteria.find((entry) => entry.id === id);
										return change?.after?.text ?? change?.before?.text ?? criterionLabel(state, id);
									})
								),
							})
						: t('workflows.team.challengeFull')}
				</p>
			)}
			{challenges.length > 0 && (
				<TeamFold kind="baseline-challenge-history" title={t('workflows.team.challenge')}>
					{versions.map((version, index) => (
						<div key={version ?? index} className="space-y-2" data-challenge-version={version}>
							<h4>{t('workflows.team.round', { round: index + 1 })}</h4>
							{challenges
								.filter((entry) => entry.briefVersion === version)
								.map((entry) => (
									<div key={entry.id}>
										<SeatTag seat={entry.seat} />
										{entry.objections.map((objection, i) => (
											<p key={i}>{presentTeamText(objection.problem, state, t)}</p>
										))}
										{entry.plans?.map((plan, i) => (
											<p key={i} className="team-dim">
												{t('workflows.team.verificationPlan')}:{' '}
												{criterionLabel(state, plan.criterion)} ·{' '}
												{presentTeamText(plan.how, state, t)} {presentTeamText(plan.data, state, t)}
											</p>
										))}
									</div>
								))}
						</div>
					))}
					{payload.responses
						?.filter((response) => response.decisions.length)
						.map((response) => (
							<div key={response.id} className="space-y-1">
								<h4>{t('workflows.team.briefResponse')}</h4>
								{response.decisions.map((decision, index) => (
									<p key={index}>
										{t(`workflows.team.objection.${decision.result}`)}:{' '}
										{presentTeamText(decision.reason, state, t)}
									</p>
								))}
							</div>
						))}
					{payload.discussions?.map((decision) => (
						<p key={decision.id}>
							{t('workflows.team.decider', { seat: t(`workflows.team.${decision.decider}`) })}:{' '}
							{presentTeamText(decision.decision, state, t)}
						</p>
					))}
				</TeamFold>
			)}
		</div>
	);
}

export function BaselineDiffView({ diff, state }: { diff: BaselineDiff; state: TeamState }) {
	const t = useT();
	const list = useFormatList();
	const changed = (label: string, before: string, after: string) =>
		before === after ? null : (
			<div key={label} data-diff-field={label}>
				<span className="team-dim">{label}: </span>
				{before && <del className="mr-2">{before}</del>}
				{after && <ins>{after}</ins>}
			</div>
		);
	return (
		<div className="space-y-2" data-card="baseline-diff" data-version={diff.toVersion}>
			<p className="team-dim">
				{t('workflows.team.changedFields', { from: diff.fromVersion ?? 0, to: diff.toVersion })}
			</p>
			{diff.scope && changed(t('workflows.team.idea'), diff.scope.before, diff.scope.after)}
			{diff.notDoing &&
				changed(
					t('workflows.team.notDoing'),
					list(diff.notDoing.before),
					list(diff.notDoing.after)
				)}
			{diff.criteria.map(({ id, before, after }) => (
				<div key={id} data-diff-criterion={id} className="team-item">
					{changed(t('workflows.team.criterionText'), before?.text ?? '', after?.text ?? '')}
					{changed(
						t('workflows.team.proofKind'),
						before ? t(`workflows.team.proof.${before.proof}`) : '',
						after ? t(`workflows.team.proof.${after.proof}`) : ''
					)}
					{changed(t('workflows.team.proofHow'), before?.how ?? '', after?.how ?? '')}
					{changed(
						t('workflows.team.experienceCriterion'),
						before?.experience ? t('workflows.team.yes') : '',
						after?.experience ? t('workflows.team.yes') : ''
					)}
					{changed(
						t('workflows.team.location'),
						list(
							before?.locations?.map(
								(location) => `${location.label}: ${teamPathLabel(location.target, state)}`
							) ?? []
						),
						list(
							after?.locations?.map(
								(location) => `${location.label}: ${teamPathLabel(location.target, state)}`
							) ?? []
						)
					)}
				</div>
			))}
			{diff.checks &&
				changed(
					t('workflows.team.check'),
					list(
						diff.checks.before.map(
							(check) =>
								`${check.command}${check.expectExit ? ` ${t('workflows.team.expectExit', { code: check.expectExit })}` : ''} (${list(check.covers.map((id) => criterionLabel(state, id)))}) ${check.boundary ? t(`workflows.team.checkScope.${check.boundary}`) : ''}`
						)
					),
					list(
						diff.checks.after.map(
							(check) =>
								`${check.command}${check.expectExit ? ` ${t('workflows.team.expectExit', { code: check.expectExit })}` : ''} (${list(check.covers.map((id) => criterionLabel(state, id)))}) ${check.boundary ? t(`workflows.team.checkScope.${check.boundary}`) : ''}`
						)
					)
				)}
		</div>
	);
}

function CriterionEditor({
	criterion,
	teamId,
	onClose,
}: {
	criterion: Criterion;
	teamId: string;
	onClose: () => void;
}) {
	const t = useT();
	const fieldId = useId();
	const [text, setText] = useState(criterion.text);
	const [proof, setProof] = useState(criterion.proof);
	const [how, setHow] = useState(criterion.how ?? '');
	const busy = useTeamStore((state) => state.pending[`${teamId}:baseline`]);
	const input = useRef<HTMLTextAreaElement>(null);
	const initialFocus = useRef(true);
	useFocusAfterRender(input, initialFocus.current);
	useEffect(() => {
		initialFocus.current = false;
	}, []);
	return (
		<form
			className="space-y-2"
			onSubmit={async (event) => {
				event.preventDefault();
				if (
					await useTeamStore
						.getState()
						.baselineEdit(teamId, criterion.id, text.trim(), { proof, how })
				)
					onClose();
			}}
		>
			<div>
				<label className="block" htmlFor={`${fieldId}-text`}>
					{t('workflows.team.criterionText')}
				</label>
				<textarea
					id={`${fieldId}-text`}
					ref={input}
					className="w-full"
					value={text}
					onChange={(event) => setText(event.target.value)}
				/>
			</div>
			<div>
				<label htmlFor={`${fieldId}-proof`}>{t('workflows.team.proofKind')}</label>
				<select
					id={`${fieldId}-proof`}
					value={proof}
					onChange={(event) => setProof(event.target.value as Criterion['proof'])}
				>
					{(['app', 'qa', 'pm'] as const).map((source) => (
						<option key={source} value={source}>
							{t(`workflows.team.proof.${source}`)}
						</option>
					))}
				</select>
			</div>
			<div>
				<label className="block" htmlFor={`${fieldId}-how`}>
					{t('workflows.team.proofHow')}
				</label>
				<input
					id={`${fieldId}-how`}
					className="w-full"
					value={how}
					onChange={(event) => setHow(event.target.value)}
				/>
			</div>
			<div className="flex gap-2">
				<button className="team-button" disabled={busy || !text.trim()}>
					{t('workflows.team.saveCriterion')}
				</button>
				<button type="button" className="team-button" onClick={onClose}>
					{t('workflows.team.cancel')}
				</button>
			</div>
		</form>
	);
}

export function TeamBaseline({
	brief,
	state,
	editable,
	frozenDiff,
}: {
	brief: Brief;
	state: TeamState;
	editable: boolean;
	frozenDiff?: BaselineDiff;
}) {
	const t = useT();
	const [editing, setEditing] = useState<string | null>(null);
	const [showDiff, setShowDiff] = useState(false);
	const [diff, setDiff] = useState<BaselineDiff | null>(null);
	const [error, setError] = useState(false);
	const [returning, setReturning] = useState(false);
	const [note, setNote] = useState('');
	const returnId = useId();
	const returnInput = useRef<HTMLTextAreaElement>(null);
	const editButton = useRef<HTMLButtonElement>(null);
	const restoreEditFocus = useRef(false);
	const lastEdited = useRef<string | null>(null);
	const returnFocused = useRef(false);
	useFocusAfterRender(returnInput, returning && !returnFocused.current);
	useEffect(() => {
		returnFocused.current = returning;
	}, [returning]);
	useFocusAfterRender(editButton, restoreEditFocus.current && !editing);
	useEffect(() => {
		restoreEditFocus.current = false;
	});
	const busy = useTeamStore((store) => store.pending[`${state.config!.id}:baseline`]);
	useEffect(() => {
		if (!showDiff) return;
		if (!editable) {
			setDiff(
				frozenDiff ??
					baselineDiff(
						state.briefs.filter((value) => value.version < brief.version).at(-1) ?? null,
						brief
					)
			);
			return;
		}
		let stale = false;
		setDiff(null);
		setError(false);
		void teamClient()
			?.baselineDiff(state.config!.id)
			.then(
				(value) => {
					if (!stale) setDiff(value);
				},
				() => {
					if (!stale) setError(true);
				}
			);
		return () => {
			stale = true;
		};
	}, [showDiff, brief, state.briefs, state.config!.id, editable, frozenDiff]);
	return (
		<div className="space-y-3" data-baseline-version={brief.version}>
			{brief.criteria.map((criterion, index) => (
				<div key={criterion.id} data-criterion-id={criterion.id} className="space-y-1">
					{editing === criterion.id ? (
						<CriterionEditor
							criterion={criterion}
							teamId={state.config!.id}
							onClose={() => {
								restoreEditFocus.current = true;
								setEditing(null);
							}}
						/>
					) : (
						<>
							<p>
								<span className="team-dim mr-2">{index + 1}</span>
								{criterion.text}{' '}
								{editable && (
									<button
										ref={lastEdited.current === criterion.id ? editButton : undefined}
										type="button"
										className="underline ml-2"
										data-action="edit-criterion"
										onClick={() => {
											lastEdited.current = criterion.id;
											setEditing(criterion.id);
										}}
									>
										{t('workflows.team.edit')}
									</button>
								)}
							</p>
							<p className="team-dim">
								{t(`workflows.team.proof.${criterion.proof}`)} · {criterion.how}
							</p>
						</>
					)}
				</div>
			))}
			{showDiff &&
				(error ? (
					<p role="alert">
						{t('workflows.team.error', { error: t('workflows.sessions.loadMessagesFailed') })}
					</p>
				) : diff ? (
					<BaselineDiffView diff={diff} state={state} />
				) : (
					<p>{t('workflows.team.loading')}</p>
				))}
			{editable && returning && (
				<form
					onSubmit={async (event) => {
						event.preventDefault();
						if (await useTeamStore.getState().baselineReturn(state.config!.id, note.trim()))
							setReturning(false);
					}}
				>
					<label htmlFor={returnId}>{t('workflows.team.returnNote')}</label>
					<textarea
						id={returnId}
						ref={returnInput}
						className="w-full"
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
					<button className="team-button" disabled={busy || !note.trim()}>
						{t('workflows.team.returnSend')}
					</button>
				</form>
			)}
			<div className="flex gap-2">
				<button
					type="button"
					className="team-button"
					data-action="baseline-diff"
					aria-expanded={showDiff}
					onClick={() => setShowDiff(!showDiff)}
				>
					{t('workflows.team.diff')}
				</button>
				{editable && (
					<button
						type="button"
						className="team-button"
						data-action="baseline-return"
						aria-expanded={returning}
						onClick={() => setReturning(!returning)}
					>
						{t('workflows.team.return')}
					</button>
				)}
			</div>
		</div>
	);
}
