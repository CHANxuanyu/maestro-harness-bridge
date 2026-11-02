/**
 * HandoffDraftBar - the note above a handoff draft's composer.
 *
 * "Continue with another AI" (and `maestro-cli handoff`) open a tab whose
 * composer already holds a long prepared draft. Without a word of explanation
 * that reads as text from nowhere, so this strip says what it is, where it came
 * from, how large it is, what was left out to fit the budget, and that nothing
 * has been sent. Drawn in the same strip style as the mention routing bar, and
 * only while the tab has no conversation (`handoffDraftNoteFor`), so sending
 * the draft retires it on its own.
 */

import { memo } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import type { Theme } from '../../../types';
import type { HandoffDraftNote } from '../../../../shared/aiHandoff';
import { getAgentDisplayName } from '../../../../shared/agentMetadata';
import { formatCount, formatTokensCompact } from '../../../../shared/formatters';
import { useT } from '../../../i18n';

interface HandoffDraftBarProps {
	theme: Theme;
	note: HandoffDraftNote;
	onDismiss: () => void;
}

export const HandoffDraftBar = memo(function HandoffDraftBar({
	theme,
	note,
	onDismiss,
}: HandoffDraftBarProps) {
	const t = useT();
	const details = [
		note.sourceName &&
			(note.sourceProvider
				? t('workflows.sessions.handoff.draftFrom', {
						name: note.sourceName,
						provider: getAgentDisplayName(note.sourceProvider),
					})
				: t('workflows.sessions.handoff.draftFromName', { name: note.sourceName })),
		t('workflows.sessions.handoff.draftTokens', {
			tokens: formatTokensCompact(note.estimatedTokens),
		}),
		note.omittedEntries === 1
			? t('workflows.sessions.handoff.draftOmittedOne')
			: note.omittedEntries > 1
				? t('workflows.sessions.handoff.draftOmitted', { count: formatCount(note.omittedEntries) })
				: null,
		note.omittedCharacters > 0
			? t('workflows.sessions.handoff.draftCut', { count: formatCount(note.omittedCharacters) })
			: null,
	].filter(Boolean);

	return (
		<div
			className="flex items-center gap-2 px-3 py-1 border-b text-2xs select-none"
			style={{
				borderColor: `${theme.colors.accent}30`,
				backgroundColor: `color-mix(in srgb, ${theme.colors.accent} 10%, transparent)`,
			}}
			data-testid="handoff-draft-bar"
		>
			<ArrowRightLeft className="w-3 h-3 shrink-0" style={{ color: theme.colors.accent }} />
			<span
				className="font-medium uppercase tracking-wide shrink-0"
				style={{ color: theme.colors.accent }}
			>
				{t('workflows.sessions.handoff.draftLabel')}
			</span>
			<span className="truncate" style={{ color: theme.colors.textDim }}>
				{details.join(' · ')}
			</span>
			<span className="ml-auto flex shrink-0 items-center gap-2">
				<span className="hidden sm:inline" style={{ color: theme.colors.textDim }}>
					{t('workflows.sessions.handoff.draftHint')}
				</span>
				<button
					type="button"
					onClick={onDismiss}
					aria-label={t('workflows.sessions.handoff.dismissNote')}
					title={t('workflows.sessions.handoff.dismissNote')}
					className="p-0.5 rounded hover:bg-white/10 transition-colors"
					style={{ color: theme.colors.textDim }}
				>
					<X className="w-3 h-3" />
				</button>
			</span>
		</div>
	);
});
