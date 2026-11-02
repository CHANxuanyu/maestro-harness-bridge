import { RefreshCw, User } from 'lucide-react';
import type { Theme } from '../../../../../types';
import type { AboutMeResult } from '../../../../../../shared/aboutMe';
import { estimateTokenCount, formatTokensCompact } from '../../../../../../shared/formatters';
import type { AboutMeApplyOutcome } from '../../../../../services/aboutMe';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from '../../DisplayTab/components/SectionCard';
import { useResizableTextarea } from '../../../../../hooks/ui/useResizableTextarea';
import { useAboutMeState } from '../hooks/useAboutMeState';
import { AboutMeFileRow } from './AboutMeFileRow';
import { useT } from '../../../../../i18n';

interface AboutMeSectionProps {
	theme: Theme;
	isOpen: boolean;
	conductorProfile: string;
	saveConductorProfile: (content: string) => Promise<AboutMeResult>;
}

/**
 * About Me: one Markdown profile (`conductorProfile`) that Maestro gives every
 * agent, and that can also be written into each local Claude Code and Codex
 * account's own instruction file. The text saves on a typing pause and is never
 * cut; native files change only when the user presses Write, and a file Maestro
 * does not own yet (or one edited outside it) is written only after the user
 * ticks it, with the exact section they were shown.
 */
export function AboutMeSection({
	theme,
	isOpen,
	conductorProfile,
	saveConductorProfile,
}: AboutMeSectionProps) {
	const t = useT();
	const resize = useResizableTextarea({ sizeKey: 'settings-conductor-profile', minHeight: 100 });
	const state = useAboutMeState({ isOpen, saved: conductorProfile, save: saveConductorProfile });
	const { files, toWrite, outcome } = state;
	const clearing = conductorProfile === '';
	const count = toWrite.length;

	const saveLabel = state.saveError
		? state.saveError.code === 'invalid-request'
			? t('settings.general.profile.saveMarker')
			: t('settings.general.profile.saveFailed', { error: state.saveError.error })
		: state.unsaved
			? t('settings.general.profile.saving')
			: t('settings.general.profile.saved');

	const writeLabel = state.applying
		? t('settings.general.profile.writing')
		: count === 0
			? t('settings.general.profile.writeNone')
			: clearing
				? t(
						count === 1 ? 'settings.general.profile.removeOne' : 'settings.general.profile.remove',
						{
							count,
						}
					)
				: t(count === 1 ? 'settings.general.profile.writeOne' : 'settings.general.profile.write', {
						count,
					});
	const writeDisabled = count === 0 || state.applying || state.unsaved;

	return (
		<div data-setting-id="general-conductor-profile">
			<SettingsSectionHeading icon={User} description={t('settings.general.profile.description')}>
				{t('settings.general.profile.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<div>
					<textarea
						ref={resize.textareaRef}
						aria-label={t('settings.general.profile.aria')}
						value={state.draft}
						onChange={(event) => state.changeDraft(event.target.value)}
						onBlur={state.flushDraft}
						placeholder={t('settings.general.profile.placeholder')}
						className="w-full p-3 rounded border bg-transparent outline-none text-sm resize-y"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							minHeight: '100px',
							...resize.style,
						}}
					/>
					<div className="flex items-start justify-between gap-3 text-xs mt-1">
						<span data-testid="about-me-tokens" className="opacity-70 flex-shrink-0">
							{t('settings.general.profile.tokens', {
								tokens: formatTokensCompact(estimateTokenCount(state.draft)),
							})}
						</span>
						<span
							data-testid="about-me-save-state"
							role={state.saveError ? 'alert' : 'status'}
							aria-live={state.saveError ? 'assertive' : 'polite'}
							className={state.saveError ? 'text-right' : 'text-right opacity-70'}
							style={state.saveError ? { color: theme.colors.error } : undefined}
						>
							{saveLabel}
						</span>
					</div>
				</div>

				<div className="pt-3 border-t" style={{ borderColor: theme.colors.border }}>
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('settings.general.profile.nativeTitle')}
					</div>
					<p className="text-xs opacity-70 mt-0.5 mb-2">
						{t('settings.general.profile.nativeDescription')}
					</p>

					{state.statusError !== null && (
						<div role="alert" className="text-xs mb-2" style={{ color: theme.colors.warning }}>
							{t('settings.general.profile.statusFailed', { error: state.statusError })}
						</div>
					)}
					{files === null ? (
						<div className="text-xs opacity-70">{t('settings.general.profile.checking')}</div>
					) : files.length === 0 ? (
						<div className="text-xs opacity-70">{t('settings.general.profile.noFiles')}</div>
					) : (
						<div className="space-y-2">
							{files.map((file) => (
								<AboutMeFileRow
									key={file.path}
									theme={theme}
									file={file}
									approved={!!state.confirmed[file.path]}
									onApprove={(approved) => state.approve(file, approved)}
									written={outcome?.written ?? []}
									disabled={state.applying}
								/>
							))}
						</div>
					)}

					<div className="flex gap-2 mt-3">
						<button
							type="button"
							data-testid="about-me-write"
							onClick={state.apply}
							disabled={writeDisabled}
							className="px-2 py-1 rounded text-xs"
							style={{
								backgroundColor: theme.colors.accentDim,
								color: theme.colors.textMain,
								opacity: writeDisabled ? 0.6 : 1,
							}}
						>
							{writeLabel}
						</button>
						<button
							type="button"
							onClick={state.checkFiles}
							disabled={state.checking || state.applying}
							className="px-2 py-1 rounded text-xs flex items-center gap-1"
							style={{
								backgroundColor: theme.colors.bgActivity,
								color: theme.colors.textMain,
								opacity: state.checking || state.applying ? 0.6 : 1,
							}}
						>
							<RefreshCw className={`w-3 h-3 ${state.checking ? 'animate-spin' : ''}`} />
							{t('settings.general.profile.checkAgain')}
						</button>
					</div>
					{outcome && <AboutMeOutcome theme={theme} outcome={outcome} clearing={clearing} />}
				</div>
			</SectionCard>
		</div>
	);
}

function AboutMeOutcome({
	theme,
	outcome,
	clearing,
}: {
	theme: Theme;
	outcome: AboutMeApplyOutcome;
	clearing: boolean;
}) {
	const t = useT();
	const written = outcome.written.length;
	const notDone = outcome.waiting.length + outcome.failed.length + outcome.unrecorded.length;
	let text: string;
	let color = theme.colors.success;
	if (outcome.error !== undefined) {
		text = t('settings.general.profile.applyFailed', { error: outcome.error });
		color = theme.colors.error;
	} else if (outcome.profileChanged) {
		text = t('settings.general.profile.profileChanged');
		color = theme.colors.warning;
	} else if (notDone > 0) {
		text = t('settings.general.profile.partial', {
			written,
			total: written + outcome.waiting.length + outcome.failed.length,
		});
		color = theme.colors.warning;
	} else if (written === 0) {
		text = t('settings.general.profile.upToDate');
	} else {
		text = clearing
			? t(
					written === 1
						? 'settings.general.profile.removedOne'
						: 'settings.general.profile.removed',
					{
						count: written,
					}
				)
			: t(written === 1 ? 'settings.general.profile.wroteOne' : 'settings.general.profile.wrote', {
					count: written,
				});
	}
	return (
		<div
			data-testid="about-me-outcome"
			role="status"
			aria-live="polite"
			className="text-xs mt-2"
			style={{ color }}
		>
			{text}
			{written > 0 && ` ${t('settings.general.profile.restart')}`}
		</div>
	);
}
