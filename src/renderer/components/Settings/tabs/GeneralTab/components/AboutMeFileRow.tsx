import { useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Theme } from '../../../../../types';
import type { AboutMeFileStatus } from '../../../../../../shared/aboutMe';
import { getAgentDisplayName } from '../../../../../../shared/agentMetadata';
import { aboutMeNeedsConsent } from '../../../../../services/aboutMe';
import { AgentLogo } from '../../../../Wizard/screens/AgentSelectionScreen/components/AgentLogo';
import { MiniBadge } from '../../../../ui/MiniBadge';
import { useSessionStore } from '../../../../../stores/sessionStore';
import { useT, type MessageKey } from '../../../../../i18n';

type RowState =
	| 'synced'
	| 'empty'
	| 'pending'
	| 'unconfirmed'
	| 'external'
	| 'overridden'
	| 'missing'
	| 'broken'
	| 'error'
	| 'unrecorded';

/**
 * What the row says about a file. "Up to date" means the file holds the current
 * About Me, nothing more: a Codex override that Codex reads instead is shown as
 * Overridden rather than up to date, and no state claims a model loaded it.
 */
function rowState(file: AboutMeFileStatus, written: string[]): RowState {
	if (file.state === 'error' && file.resolvedPath && written.includes(file.resolvedPath))
		return 'unrecorded';
	switch (file.state) {
		case 'synced':
			if (file.shadowedBy.length > 0) return 'overridden';
			return file.currentBlock ? 'synced' : 'empty';
		case 'pending':
			return 'pending';
		case 'unconfirmed':
			return 'unconfirmed';
		case 'external-change':
			return 'external';
		case 'missing-directory':
			return 'missing';
		case 'invalid-block':
			return 'broken';
		default:
			return 'error';
	}
}

const STATE_LABELS: Record<RowState, MessageKey> = {
	synced: 'settings.general.profile.state.synced',
	empty: 'settings.general.profile.state.empty',
	pending: 'settings.general.profile.state.pending',
	unconfirmed: 'settings.general.profile.state.unconfirmed',
	external: 'settings.general.profile.state.external',
	overridden: 'settings.general.profile.state.overridden',
	missing: 'settings.general.profile.state.missing',
	broken: 'settings.general.profile.state.broken',
	error: 'settings.general.profile.state.error',
	unrecorded: 'settings.general.profile.state.unrecorded',
};

function stateColor(state: RowState, theme: Theme): string {
	switch (state) {
		case 'synced':
			return theme.colors.success;
		case 'pending':
			return theme.colors.accent;
		case 'unconfirmed':
		case 'external':
		case 'overridden':
			return theme.colors.warning;
		case 'empty':
		case 'missing':
			return theme.colors.textDim;
		default:
			return theme.colors.error;
	}
}

/** Agent names listed before "and N more". */
const USED_BY_SHOWN = 3;

interface AboutMeFileRowProps {
	theme: Theme;
	file: AboutMeFileStatus;
	approved: boolean;
	onApprove: (approved: boolean) => void;
	/** Real targets the last apply wrote, to tell an unrecorded write from a read error. */
	written: string[];
	disabled: boolean;
}

export function AboutMeFileRow({
	theme,
	file,
	approved,
	onApprove,
	written,
	disabled,
}: AboutMeFileRowProps) {
	const t = useT();
	const [showBlock, setShowBlock] = useState(false);
	const blockId = useId();
	const state = rowState(file, written);
	// A DeepSeek preset runs Claude Code, so its file is a CLAUDE.md; name it by
	// the provider the user picked.
	const provider = file.deepseek ? 'deepseek' : (file.providers[0] ?? 'claude-code');
	const providerLabel = file.deepseek
		? getAgentDisplayName('deepseek')
		: file.providers.map(getAgentDisplayName).join(' + ');
	// Joined to one string so the row re-renders only when a name changes,
	// not on every session update while Settings is open.
	const agentNames = useSessionStore((store) =>
		file.agentIds
			.map((id) => store.sessions.find((session) => session.id === id)?.name)
			.filter((name): name is string => !!name)
			.join('\n')
	);
	const names = agentNames ? agentNames.split('\n') : [];
	const usedBy =
		names.length === 0
			? t('settings.general.profile.usedByNone')
			: names.length > USED_BY_SHOWN
				? t('settings.general.profile.usedByMore', {
						names: names.slice(0, USED_BY_SHOWN).join(', '),
						count: names.length - USED_BY_SHOWN,
					})
				: t('settings.general.profile.usedBy', { names: names.join(', ') });
	const consent = aboutMeNeedsConsent(file);
	const consentLabel =
		file.state === 'external-change'
			? t('settings.general.profile.consentEdited')
			: file.currentBlock
				? t('settings.general.profile.consentForeign')
				: t('settings.general.profile.consentNew');

	return (
		<div
			data-testid={`about-me-file-${file.path}`}
			className="rounded border p-2.5"
			style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
		>
			<div className="flex items-center gap-2 min-w-0">
				<AgentLogo agentId={provider} supported detected theme={theme} className="w-4 h-4" />
				<span className="text-sm font-medium truncate" style={{ color: theme.colors.textMain }}>
					{providerLabel}
				</span>
				<MiniBadge
					theme={theme}
					label={t(STATE_LABELS[state])}
					color={stateColor(state, theme)}
					className="ml-auto"
				/>
			</div>
			<div className="mt-1 text-xs font-mono break-all select-text">{file.path}</div>
			{file.resolvedPath && file.resolvedPath !== file.path && (
				<div className="text-xs opacity-70 font-mono break-all select-text">
					{t('settings.general.profile.realFile', { path: file.resolvedPath })}
				</div>
			)}
			{(names.length > 0 || state !== 'missing') && (
				<div className="text-xs-plus opacity-55 mt-0.5">{usedBy}</div>
			)}

			{file.shadowedBy.length > 0 && (
				<div
					className="flex items-start gap-1.5 text-xs mt-1.5"
					style={{ color: theme.colors.warning }}
				>
					<AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
					<span className="select-text break-all">
						{t('settings.general.profile.overrideWarning', { path: file.shadowedBy.join(', ') })}
					</span>
				</div>
			)}
			{state === 'missing' && (
				<div className="text-xs-plus opacity-55 mt-1">
					{t('settings.general.profile.missingHint')}
				</div>
			)}
			{(state === 'broken' || state === 'error' || state === 'unrecorded') && (
				<div className="text-xs mt-1 select-text break-words" style={{ color: theme.colors.error }}>
					{state === 'broken'
						? t('settings.general.profile.brokenHint')
						: state === 'unrecorded'
							? t('settings.general.profile.unrecordedHint', { error: file.error ?? '' })
							: t('settings.general.profile.errorHint', { error: file.error ?? '' })}
				</div>
			)}

			{consent && (
				<div className="mt-2">
					<label className="flex items-start gap-2 text-xs cursor-pointer">
						<input
							type="checkbox"
							checked={approved}
							disabled={disabled}
							onChange={(event) => onApprove(event.target.checked)}
							className="w-4 h-4 flex-shrink-0 cursor-pointer mt-px"
							style={{ accentColor: theme.colors.accent }}
						/>
						<span style={{ color: theme.colors.textMain }}>{consentLabel}</span>
					</label>
					{file.currentBlock ? (
						<>
							<button
								type="button"
								className="text-xs mt-1 ml-6 underline underline-offset-2"
								style={{ color: theme.colors.accent }}
								aria-expanded={showBlock}
								aria-controls={blockId}
								onClick={() => setShowBlock((open) => !open)}
							>
								{showBlock
									? t('settings.general.profile.hideSection')
									: t('settings.general.profile.showSection')}
							</button>
							{showBlock && (
								<pre
									id={blockId}
									data-testid="about-me-current-block"
									className="mt-1 ml-6 p-2 rounded border text-xs-plus font-mono whitespace-pre-wrap break-words max-h-40 overflow-auto select-text"
									style={{
										borderColor: theme.colors.border,
										backgroundColor: theme.colors.bgMain,
										color: theme.colors.textMain,
										// Show the markers as typed: a ligature font draws `<!--` as an arrow.
										fontVariantLigatures: 'none',
									}}
								>
									{file.currentBlock}
								</pre>
							)}
						</>
					) : (
						<div className="text-xs-plus opacity-55 mt-1 ml-6">
							{t('settings.general.profile.noSection')}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
