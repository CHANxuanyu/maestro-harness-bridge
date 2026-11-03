import { useT } from '../../i18n';
/**
 * StopTurnButton - the red "Stop" pill that ends the active agent's turn.
 *
 * Every surface that offers Stop draws the SAME control, because Stop is one
 * agent-level action (see `useInterruptHandler`): it signals the agent's own
 * process, every other busy tab it owns, and every cross-agent consult it fanned
 * out. A surface that hand-rolls its own button drifts on the square glyph, the
 * padding, and - worse - on what the tooltip claims the button does.
 *
 * Exactly one surface draws it at a time, chosen by `resolveStopPlacement`: the
 * composer's send key while the conversation on screen runs (`variant="icon"`),
 * the thinking pill for another running conversation of this agent, or the
 * cross-agent "N agents responding…" pill for consults this agent fanned out.
 */

import type { Theme } from '../../types';
import { shortcutSuffix } from './ShortcutHint';

interface StopTurnButtonProps {
	theme: Theme;
	/** Runs the agent-level interrupt. */
	onClick: () => void;
	/** Tooltip text. Name what stops, not which provider is running. */
	title?: string;
	/**
	 * The key that does the same thing where this control is drawn, named in the
	 * tooltip: Escape for the send key's Stop. Omitted where no key reaches the
	 * same target (the pill's Stop is for a conversation off screen).
	 */
	shortcutKeys?: string[];
	/**
	 * `pill` (default): the labelled red pill. `icon`: the glyph alone, drawn in
	 * the send key's place while the conversation on screen runs.
	 */
	variant?: 'pill' | 'icon';
	/** Size and shape of the `icon` variant; a round send-sized key by default. */
	className?: string;
}

export function StopTurnButton({
	theme,
	onClick,
	title: titleProp,
	variant = 'pill',
	className,
	shortcutKeys,
}: StopTurnButtonProps): JSX.Element {
	const t = useT();
	const title = (titleProp ?? t('workflows.status.stopTurn')) + shortcutSuffix(shortcutKeys);
	if (variant === 'icon') {
		return (
			<button
				type="button"
				onClick={onClick}
				// Neutral rather than red: it sits where send was, and a red key in
				// the corner of every running turn would shout. Same glyph, same name.
				className={`flex shrink-0 items-center justify-center shadow-sm transition-all hover:opacity-90 cursor-pointer ${className ?? 'h-8 w-8 rounded-full'}`}
				style={{ backgroundColor: theme.colors.textMain, color: theme.colors.bgMain }}
				title={title}
				aria-label={title}
				data-testid="stop-turn-button"
			>
				<svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
					<rect x="6" y="6" width="12" height="12" rx="1" />
				</svg>
			</button>
		);
	}
	return (
		<button
			type="button"
			onClick={onClick}
			// shrink-0 + nowrap: in a crowded busy bar a flex child may otherwise be
			// squeezed until its label wraps one character per line ("停" over "止"),
			// which is exactly the control the user is reaching for.
			className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors hover:opacity-80 shrink-0 whitespace-nowrap"
			style={{ backgroundColor: theme.colors.error, color: 'white' }}
			title={title}
			aria-label={title}
			data-testid="stop-turn-button"
		>
			{/* Filled square: the universal transport "stop", and the one glyph that
			    cannot be read as "pause" or "close". */}
			<svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
				<rect x="6" y="6" width="12" height="12" rx="1" />
			</svg>
			{t('common.stop')}
		</button>
	);
}

export default StopTurnButton;
