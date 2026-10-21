/**
 * WelcomeContent.tsx
 *
 * Shared welcome content displayed on both the first-launch empty state
 * and the tour introduction overlay. Contains the Maestro icon, welcome
 * message, and explanation of core features.
 */

import type { Theme } from '../types';
import maestroWandIcon from '../assets/icon-wand.png';
import { openUrl } from '../utils/openUrl';
import { buildMaestroUrl } from '../utils/buildMaestroUrl';
import { useT } from '../i18n';

interface WelcomeContentProps {
	theme: Theme;
	/** Show the "To get started..." call-to-action message */
	showGetStarted?: boolean;
}

/**
 * WelcomeContent - Shared welcome message component
 *
 * Displays the Maestro icon and introductory copy explaining:
 * - Parallel agent management
 * - Auto Run automation
 * - Non-interactive mode behavior
 * - Read-Only mode option
 */
export function WelcomeContent({
	theme,
	showGetStarted = false,
}: WelcomeContentProps): JSX.Element {
	const t = useT();
	return (
		<div className="flex flex-col items-center text-center max-w-xl">
			{/* Maestro Icon */}
			<img src={maestroWandIcon} alt="Maestro" className="w-20 h-20 mb-6 opacity-90" />

			{/* Heading */}
			<h1 className="text-2xl font-bold mb-4" style={{ color: theme.colors.textMain }}>
				{t('workflows.welcome.title')}
			</h1>

			{/* Primary goals */}
			<p className="text-sm mb-4" style={{ color: theme.colors.textDim }}>
				{t('workflows.welcome.intro')}
			</p>

			<div className="text-left space-y-3 mb-6">
				<div className="flex gap-3">
					<span
						className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						1
					</span>
					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						<strong style={{ color: theme.colors.textMain }}>
							{t('workflows.welcome.goalParallelTitle')}
						</strong>{' '}
						- {t('workflows.welcome.goalParallelBody')}
					</p>
				</div>

				<div className="flex gap-3">
					<span
						className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						2
					</span>
					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						<strong style={{ color: theme.colors.textMain }}>
							{t('workflows.welcome.goalAutoRunTitle')}
						</strong>{' '}
						- {t('workflows.welcome.goalAutoRunBody')}
					</p>
				</div>
			</div>

			{/* How it works section */}
			<div
				className="text-sm leading-relaxed p-4 rounded-lg text-left space-y-2"
				style={{
					backgroundColor: theme.colors.bgActivity,
					color: theme.colors.textDim,
				}}
			>
				<p>
					<strong style={{ color: theme.colors.textMain }}>
						{t('workflows.welcome.howItWorksLabel')}
					</strong>{' '}
					{t('workflows.welcome.howItWorksBody')}
				</p>
				<p>{t('workflows.welcome.accessModes')}</p>
			</div>

			{/* Get started call-to-action (only on first-launch screen) */}
			{showGetStarted && (
				<p className="text-sm mt-6" style={{ color: theme.colors.textDim }}>
					{t('workflows.welcome.getStarted')}
				</p>
			)}

			{/* Read more link */}
			<button
				onClick={() => openUrl(buildMaestroUrl('https://docs.runmaestro.ai/getting-started'))}
				className="text-xs mt-4 hover:opacity-80 transition-colors"
				style={{ color: theme.colors.accent }}
			>
				{t('workflows.welcome.readMore')}
			</button>
		</div>
	);
}
