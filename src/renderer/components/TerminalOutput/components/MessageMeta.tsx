import type React from 'react';
import { ArrowLeftRight, Info } from 'lucide-react';
import type { Theme } from '../../../types';
import { TurnSettingPills } from '../../ui/TurnSettingPills';
import type { TurnSettingChange } from '../utils/turnSettingChanges';
import { useT } from '../../../i18n';

/**
 * The conversation feed's one line under a message: its actions, the message
 * info toggle, and - only when the conversation really switched configuration
 * - the new model/effort.
 *
 * Always one line tall and always rendered, so revealing the actions (opacity
 * only) or a chip arriving later (an older page loading gives the first reply
 * a predecessor) never changes the row's height under the reading anchor.
 * NOT `overflow: hidden`: the controls never shrink and must stay reachable at
 * any width; the only thing allowed to give way is the change chip, which
 * truncates. On a row narrower than all the controls together they wrap among
 * themselves rather than clip a keyboard-reachable button.
 */
export function MessageMetaLine({
	theme,
	align,
	compact,
	actions,
	revealed = false,
	infoOpen,
	infoId,
	onToggleInfo,
	turnSettingChange,
	trailing,
	endControl,
	secondaryTextColor,
}: {
	theme: Theme;
	/** `end` for a right-aligned user message, so the line sits under its bubble. */
	align: 'start' | 'end';
	/** A user message's line is a little shorter than a reply's. */
	compact?: boolean;
	actions: React.ReactNode;
	/** Keep the controls visible without hover (the newest reply). */
	revealed?: boolean;
	infoOpen: boolean;
	infoId: string;
	onToggleInfo: () => void;
	turnSettingChange?: TurnSettingChange;
	/** Opt-in readouts that sit at the end of the line (the Claude mode pill). */
	trailing?: React.ReactNode;
	/** A control that may appear and disappear; rendered last so it moves nothing. */
	endControl?: React.ReactNode;
	secondaryTextColor: string;
}) {
	const t = useT();
	const infoLabel = infoOpen
		? t('workflows.transcript.hideMessageInfo')
		: t('workflows.transcript.messageInfo');
	const changeLabel = [
		turnSettingChange?.model &&
			t('workflows.transcript.modelChanged', {
				from: turnSettingChange.model.from,
				to: turnSettingChange.model.to,
			}),
		turnSettingChange?.effort &&
			t('workflows.transcript.effortChanged', {
				from: turnSettingChange.effort.from,
				to: turnSettingChange.effort.to,
			}),
	]
		.filter(Boolean)
		.join('; ');

	return (
		<div
			data-feed-meta=""
			className={`flex flex-nowrap items-center gap-x-1 max-w-full ${compact ? 'min-h-5 mt-0.5' : 'min-h-6 mt-1'} ${
				align === 'end' ? 'justify-end' : 'justify-start'
			}`}
			style={{ color: secondaryTextColor }}
		>
			{/* The controls keep their full width (shrink-0) and wrap among
			    themselves only if the row is narrower than all of them; the chip
			    after them is what gives way. */}
			<div
				data-feed-actions=""
				className="flex flex-wrap items-center gap-0.5 shrink-0 max-w-full [&>*]:shrink-0"
			>
				{actions}
				<button
					type="button"
					onClick={onToggleInfo}
					aria-expanded={infoOpen}
					aria-controls={infoId}
					aria-label={infoLabel}
					title={infoLabel}
					data-message-info-toggle=""
					className={`p-1 rounded transition-opacity hover:bg-white/10 outline-none focus-visible:ring-1 ${
						infoOpen || revealed
							? 'opacity-100'
							: 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
					}`}
					style={{ color: infoOpen ? theme.colors.accent : secondaryTextColor }}
				>
					<Info className="w-3.5 h-3.5" />
				</button>
			</div>
			{changeLabel && (
				<span
					className="flex items-center gap-1 min-w-0 shrink overflow-hidden ml-1"
					title={changeLabel}
					data-turn-setting-change=""
				>
					<ArrowLeftRight className="w-3 h-3 shrink-0" aria-hidden />
					<span className="sr-only">{changeLabel}</span>
					<span className="flex items-center gap-1 min-w-0" aria-hidden>
						<TurnSettingPills
							theme={theme}
							model={turnSettingChange?.model?.to}
							effort={turnSettingChange?.effort?.to}
						/>
					</span>
				</span>
			)}
			{trailing}
			{/* Last on purpose: a control that comes and goes (the long-message
			    jump hides while the whole message is on screen) must not push
			    anything sideways under the pointer. */}
			{endControl && <span className="shrink-0 flex items-center">{endControl}</span>}
		</div>
	);
}

export interface MessageInfoField {
	label: string;
	value: React.ReactNode;
}

/**
 * The on-demand metadata for one message: a definition list under the meta
 * line, opened by its info toggle. Inline rather than a popover so it needs no
 * portal or focus trap, reads in document order, and works on a phone.
 */
export function MessageInfoPanel({
	theme,
	id,
	fields,
	secondaryTextColor,
	align,
}: {
	theme: Theme;
	id: string;
	fields: MessageInfoField[];
	secondaryTextColor: string;
	align: 'start' | 'end';
}) {
	const t = useT();
	return (
		<div
			id={id}
			role="group"
			aria-label={t('workflows.transcript.messageInfo')}
			data-message-info=""
			className={`mt-1 mb-1 px-3 py-2 rounded-lg border text-xs select-text max-w-full w-fit ${
				align === 'end' ? 'self-end' : 'self-start'
			}`}
			style={{ borderColor: theme.colors.border }}
		>
			<dl
				className="m-0 grid gap-x-3 gap-y-0.5"
				style={{ gridTemplateColumns: 'auto minmax(0, 1fr)' }}
			>
				{fields.map((field) => (
					<div key={field.label} className="contents">
						<dt style={{ color: secondaryTextColor }}>{field.label}</dt>
						<dd className="m-0 break-words" style={{ color: theme.colors.textMain }}>
							{field.value}
						</dd>
					</div>
				))}
			</dl>
		</div>
	);
}
