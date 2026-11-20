import { useRef, useState } from 'react';
import { SEAT_ROLES, type SeatRole, type TeamState } from '../../../shared/team/types';
import { useT } from '../../i18n';
import { useTeamStore } from '../../stores/teamStore';
import { useFocusAfterRender } from '../../hooks/utils/useFocusAfterRender';
import { SeatTag } from './TeamPrimitives';

export function TeamComposer({ state }: { state: TeamState }) {
	const t = useT();
	const id = state.config!.id;
	const finished = !!state.terminal || state.stopped;
	const lastMessage = state.messages.at(-1);
	const delivery = lastMessage?.handled
		? 'handled'
		: lastMessage?.delivered
			? 'delivered'
			: 'queued';
	const [draft, setDraft] = useState('');
	const to =
		SEAT_ROLES.find((seat) =>
			new RegExp(`^@(?:${seat}|${t(`workflows.team.${seat}`)})\\s`, 'i').test(draft)
		) ?? 'pm';
	const [index, setIndex] = useState(0);
	const [focus, setFocus] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	const busy = useTeamStore((s) => s.pending[`${id}:say`]);
	const exporting = useTeamStore((s) => s.pending[`${id}:command`]);
	const mention = draft.match(/^@(\S*)$/);
	const options = mention
		? SEAT_ROLES.filter(
				(seat) =>
					seat.startsWith(mention[1].toLowerCase()) ||
					t(`workflows.team.${seat}`).toLowerCase().startsWith(mention[1].toLowerCase())
			)
		: [];
	const pick = (seat: SeatRole) => {
		setDraft(`@${t(`workflows.team.${seat}`)} `);
		setFocus(true);
	};
	useFocusAfterRender(ref, focus);
	const send = async () => {
		if (finished || !draft.trim() || busy) return;
		const submitted = draft;
		if (await useTeamStore.getState().say(id, draft.trim(), to)) {
			setDraft((current) => (current === submitted ? '' : current));
			setFocus(true);
		}
	};
	if (finished)
		return (
			<div
				data-testid="team-composer"
				className="shrink-0 px-5 py-3 border-t"
				style={{ borderColor: 'var(--team-border)', background: 'var(--team-side)' }}
			>
				<div className="max-w-[720px] mx-auto flex items-center gap-3">
					<textarea
						aria-label={t('workflows.team.message')}
						disabled
						rows={2}
						value=""
						placeholder={t('workflows.team.finishedMessages')}
						className="flex-1 min-w-0 resize-none !border-0 !p-0 !bg-transparent"
					/>
					<button
						type="button"
						className="team-button shrink-0"
						disabled={exporting}
						onClick={() => void useTeamStore.getState().command(id, 'export')}
					>
						{t('workflows.team.export')}
					</button>
				</div>
			</div>
		);
	return (
		<div
			data-testid="team-composer"
			className="shrink-0 px-5 pt-2.5 pb-4 border-t"
			style={{ borderColor: 'var(--team-border)', background: 'var(--team-side)' }}
		>
			<div
				className="max-w-[720px] mx-auto rounded-xl border p-3"
				style={{ borderColor: 'var(--team-border)', background: 'var(--team-bg)' }}
			>
				<div className="flex flex-wrap gap-2 items-center pb-1.5">
					<span className="team-dim">{t('workflows.team.sendTo')}</span>
					<SeatTag seat={to} model={state.seats[to].model ?? state.config!.seats[to]} />
					<span className="team-dim">{t('workflows.team.mentionHint')}</span>
				</div>
				{options.length > 0 && (
					<div
						role="listbox"
						aria-label={t('workflows.team.chooseSeat')}
						className="flex gap-2 py-2"
					>
						{options.map((seat, i) => (
							<button
								type="button"
								role="option"
								aria-selected={i === index % options.length}
								className="team-button"
								key={seat}
								onClick={() => pick(seat)}
							>
								<SeatTag seat={seat} />
							</button>
						))}
					</div>
				)}
				<textarea
					ref={ref}
					rows={2}
					className="w-full resize-none !border-0 !p-0"
					aria-label={t('workflows.team.message')}
					disabled={!!state.terminal || state.stopped}
					placeholder={t('workflows.team.messagePlaceholder')}
					value={draft}
					onBlur={() => setFocus(false)}
					onChange={(e) => {
						setDraft(e.target.value);
						setIndex(0);
						setFocus(false);
					}}
					onKeyDown={(e) => {
						if (e.nativeEvent.isComposing) return;
						if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
							e.preventDefault();
							setIndex(
								(value) =>
									(value + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length
							);
						}
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							if (options.length) pick(options[index % options.length]);
							else void send();
						}
					}}
				/>
				<div className="flex gap-2 items-center justify-between">
					<span
						className="team-dim"
						role="status"
						data-delivery={lastMessage ? delivery : undefined}
					>
						{busy
							? t('workflows.team.sending')
							: lastMessage
								? t(`workflows.team.${delivery}`, {
										seat: t(`workflows.team.${lastMessage.message.to ?? 'pm'}`),
									})
								: t('workflows.team.deliveryHint')}
					</span>
					<button
						type="button"
						className="team-button"
						data-primary="true"
						aria-label={t('workflows.team.send')}
						disabled={!draft.trim() || busy || !!state.terminal || state.stopped}
						onClick={() => void send()}
					>
						↑
					</button>
				</div>
			</div>
		</div>
	);
}
