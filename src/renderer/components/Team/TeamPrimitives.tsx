import type { CSSProperties, ReactNode } from 'react';
import { readableTextOn, blendColors } from '../../../shared/colorContrast';
import type { SeatModel, SeatRole, TeamState } from '../../../shared/team/types';
import type { Theme } from '../../types';
import { useT } from '../../i18n';
import { getAgentDisplayName } from '../../../shared/agentMetadata';
import { NATIVE_MODEL_DEFAULT, modelEffortLevelName } from '../../../shared/modelCatalog';
import { useTeamModelCatalog } from './TeamModelCatalogs';
import { getBasename, isAbsolutePath } from '../../../shared/formatters';
import { toRelativePath } from '../../utils/fileLinks/matcher';
import { normalizeWorktreePath } from '../../../shared/worktreePaths';
import './team.css';

export function teamStyle(theme: Theme): CSSProperties {
	const c = theme.colors;
	const soft = blendColors(c.bgMain, c.accent, 0.08);
	return {
		'--team-bg': c.bgMain,
		'--team-side': c.bgSidebar,
		'--team-activity': c.bgActivity,
		'--team-border': c.border,
		'--team-accent': c.accent,
		'--team-soft': soft,
		'--team-text': readableTextOn(c.textMain, [c.bgMain, c.bgSidebar, c.bgActivity, soft]),
		'--team-dim': readableTextOn(c.textDim, [c.bgMain, c.bgSidebar, c.bgActivity, soft]),
		'--team-on-accent': readableTextOn(c.accentForeground, [c.accent]),
		'--team-success': readableTextOn(c.success, [c.bgMain]),
		'--team-warning': readableTextOn(c.warning, [c.bgMain]),
		'--team-error': readableTextOn(c.error, [c.bgMain]),
	} as CSSProperties;
}

export function teamPathLabel(path: string, state: TeamState): string {
	if (!isAbsolutePath(path)) return path;
	const cwd = state.seats.dev.binding?.workspace ?? state.config!.projectRoot;
	return (
		toRelativePath(
			normalizeWorktreePath(path, !!state.config?.sshRemoteId),
			normalizeWorktreePath(cwd, !!state.config?.sshRemoteId)
		) ?? getBasename(path)
	);
}

/** Evidence references are ledger keys, not owner-facing captions. */
export function teamEvidenceLabel(value: string, state: TeamState): string {
	const check = state.checks.find((entry) => entry.id === value || entry.evidenceId === value);
	if (check) return check.command;
	const output = state.outputs.find((entry) => entry.id === value || entry.outputId === value);
	if (output)
		return (
			output.locations?.[0]?.location.label ??
			teamPathLabel(output.files[0] ?? output.previews[0] ?? '', state)
		);
	return teamPathLabel(value, state);
}

export function criterionLabel(state: TeamState, id: string): string {
	return (
		state.criteria.find((criterion) => criterion.id === id)?.text ??
		state.briefs.flatMap((brief) => brief.criteria).find((criterion) => criterion.id === id)
			?.text ??
		''
	);
}

export function SeatTag({ seat, model }: { seat: SeatRole; model?: SeatModel }) {
	const t = useT();
	const catalog = useTeamModelCatalog(seat, model?.tool);
	const modelId =
		model?.model && model.model !== NATIVE_MODEL_DEFAULT
			? model.model
			: catalog?.followDefault.modelId;
	const resolved = catalog?.models.find((entry) => entry.id === modelId);
	const effort = model?.effort ?? resolved?.defaultEffort;
	const level = resolved?.efforts.find((entry) => entry.id === effort);
	return (
		<span className="inline-flex items-center gap-1.5 text-sm font-semibold">
			<i className="team-seat-mark" data-seat={seat} aria-hidden />
			{t(`workflows.team.${seat}`)}
			{model && (
				<span className="team-dim font-normal">
					{resolved?.displayName ||
						modelId ||
						`${getAgentDisplayName(model.tool)} · ${t('workflows.team.nativeDefault')}`}
					{effort
						? ` · ${level && catalog ? modelEffortLevelName(catalog.provider, level) : effort}`
						: ''}
				</span>
			)}
		</span>
	);
}

export function TeamFold({
	title,
	children,
	kind,
}: {
	title: ReactNode;
	children: ReactNode;
	kind?: string;
}) {
	return (
		<details className="team-fold" data-card={kind}>
			<summary>{title}</summary>
			<div className="team-fold-body">{children}</div>
		</details>
	);
}

export function Criteria({ state, ids }: { state: TeamState; ids?: readonly string[] }) {
	const t = useT();
	return (
		<div className="space-y-2">
			{state.criteria
				.filter((criterion) => !ids || ids.includes(criterion.id))
				.map((criterion, index) => (
					<div key={criterion.id} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
						<span className="team-dim">{index + 1}</span>
						<span>{criterion.text}</span>
						<span />
						<div className="team-dim">
							{t(`workflows.team.proof.${criterion.proof}`)} ·{' '}
							{t(`workflows.team.${criterion.status}`)}
							{criterion.how ? ` · ${criterion.how}` : ''}
							{criterion.evidence.map((e) => (
								<p key={e.eventId}>
									{t(`workflows.team.proof.${e.source}`)}: {teamEvidenceLabel(e.evidence, state)}
								</p>
							))}
						</div>
					</div>
				))}
		</div>
	);
}
