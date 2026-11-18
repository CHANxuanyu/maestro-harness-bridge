import {
	memo,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import {
	effortsForModel,
	rememberEffortPerModel,
	rememberedEffortForModel,
	teamSeatEfforts,
	visibleCatalogModels,
	type CatalogModel,
	type ModelEffort,
	type ModelPickerSelection,
	type ProviderModelCatalog,
	type RememberedModelEfforts,
} from '../../shared/modelCatalog';
import { readableTextOn } from '../../shared/colorContrast';
import type { Theme } from '../types';
import { useI18n, type MessageKey } from '../i18n';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { useModalLayer } from '../hooks/ui/useModalLayer';
import { useAnchoredMenuPosition } from '../hooks/ui/useAnchoredMenuPosition';
import { useFocusAfterRender, useFocusOnClose } from '../hooks/utils/useFocusAfterRender';
import { useScrollIntoView } from '../hooks/ui/useScrollIntoView';
import { EscCloseButton } from './ui/EscCloseButton';
import { ShortcutHint, shortcutSuffix } from './ui/ShortcutHint';
import { formatShortcutKeys } from '../utils/shortcutFormatter';

export interface ModelEffortPickerProps {
	theme: Theme;
	catalog: ProviderModelCatalog;
	policy: 'conversation' | 'team-seat';
	/** Empty means follow the native default. */
	model: string;
	effort?: string;
	remembered: RememberedModelEfforts;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChange: (selection: ModelPickerSelection) => void;
	running?: boolean;
	shortcutKeys?: string[];
}

/** Vendor vocabulary is intentionally untranslated; explanations are localized. */
function levelName(provider: ProviderModelCatalog['provider'], effort?: ModelEffort): string {
	if (!effort) return '';
	if (effort.id === 'xhigh') return provider === 'claude-code' ? 'Extra' : 'Extra High';
	return effort.displayName || effort.id.charAt(0).toUpperCase() + effort.id.slice(1);
}

export const ModelEffortPicker = memo(function ModelEffortPicker(props: ModelEffortPickerProps) {
	const { theme, catalog, model, effort, open, onOpenChange, shortcutKeys } = props;
	const { t } = useI18n();
	const anchorRef = useRef<HTMLButtonElement>(null);
	const clickedOpener = useRef<HTMLButtonElement | null>(null);
	useFocusOnClose(clickedOpener, open);
	useEffect(() => {
		if (!open) clickedOpener.current = null;
	}, [open]);
	const resolved = catalog.models.find(
		(item) => item.id === (model || catalog.followDefault.modelId)
	);
	const levels =
		resolved && props.policy === 'team-seat'
			? teamSeatEfforts(catalog.provider, resolved)
			: (resolved?.efforts ??
				(catalog.source.kind === 'fallback' ? catalog.fallbackEfforts : undefined));
	const level = levels?.find((item) => item.id === (effort || resolved?.defaultEffort));
	const name =
		resolved?.displayName ||
		model ||
		catalog.followDefault.modelId ||
		t('workflows.modelPicker.unresolved');
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="model-effort-picker"
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => {
					clickedOpener.current = anchorRef.current;
					onOpenChange(!open);
				}}
				className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs whitespace-nowrap"
				style={{ color: readableTextOn(theme.colors.textDim, [theme.colors.bgMain]) }}
				title={t('workflows.modelPicker.title') + shortcutSuffix(shortcutKeys)}
			>
				<span>
					{name}
					{level ? ` · ${levelName(catalog.provider, level)}` : ''}
				</span>
				{/* One quiet tag when the conversation follows the tool's own default,
				    instead of repeating "Default" after both the model and the effort. */}
				{(!model || !effort) && (
					<span
						className="rounded px-1 text-2xs leading-4"
						style={{ border: `1px solid ${theme.colors.border}` }}
					>
						{t('workflows.modelPicker.default')}
					</span>
				)}
				<ChevronDown size={12} aria-hidden />
			</button>
			{open && <ModelEffortPopover {...props} anchorRef={anchorRef} />}
		</>
	);
});

function ModelEffortPopover({
	theme,
	catalog,
	policy,
	model,
	effort,
	remembered,
	onOpenChange,
	onChange,
	running,
	shortcutKeys,
	anchorRef,
}: ModelEffortPickerProps & { anchorRef: RefObject<HTMLButtonElement> }) {
	const { t, locale } = useI18n();
	const pickerId = useId();
	const [filter, setFilter] = useState('');
	const [expanded, setMore] = useState<boolean | null>(null);
	const more =
		expanded ?? catalog.models.some((item) => item.id === model && item.group === 'more');
	const [pickedModel, setPickedModel] = useState<string | null>(null);
	const [pickedEffort, setPickedEffort] = useState<string | undefined>();
	const [column, setColumn] = useState<'model' | 'effort'>('model');
	const menuRef = useRef<HTMLDivElement>(null);
	const filterRef = useRef<HTMLInputElement>(null);
	const effortRef = useRef<HTMLDivElement>(null);
	const close = () => onOpenChange(false);
	useModalLayer(MODAL_PRIORITIES.MODEL_EFFORT, t('workflows.modelPicker.title'), close);
	// The layer snapshots the opener before this layout effect focuses the filter.
	useFocusAfterRender(filterRef, column === 'model');
	useFocusAfterRender(effortRef, column === 'effort');
	const positionKey = useMemo(
		() => [catalog, filter, more, pickedModel, model, locale],
		[catalog, filter, more, pickedModel, model, locale]
	);
	const position = useAnchoredMenuPosition(menuRef, anchorRef, {
		placement: 'above',
		align: 'end',
		gap: 8,
		contentKey: positionKey,
	});
	const visible = useMemo(() => visibleCatalogModels(catalog), [catalog]);
	const query = filter.trim().toLowerCase();
	const rows = useMemo(() => {
		const matches = visible.filter((item) =>
			query
				? `${item.id} ${item.displayName} ${item.description}`.toLowerCase().includes(query)
				: more || item.group === 'current'
		);
		// Preserve vendor order inside each vendor-declared group.
		return [
			...(!query ? [''] : []),
			...['current', 'more'].flatMap((group) =>
				matches.filter((item) => item.group === group).map((item) => item.id)
			),
		];
	}, [visible, query, more]);
	const selectedModel = rows.includes(pickedModel ?? model) ? (pickedModel ?? model) : rows[0];
	const modelIndex = rows.indexOf(selectedModel);
	const highlighted =
		selectedModel === undefined
			? undefined
			: catalog.models.find((item) => item.id === (selectedModel || catalog.followDefault.modelId));
	const effortModel: CatalogModel | undefined =
		highlighted ??
		(catalog.source.kind === 'fallback'
			? {
					id: selectedModel ?? filter.trim(),
					displayName: selectedModel || t('workflows.modelPicker.unresolved'),
					description: '',
					group: 'current',
					hidden: false,
					efforts: catalog.fallbackEfforts ?? [],
				}
			: undefined);
	const levels = effortModel
		? policy === 'team-seat'
			? teamSeatEfforts(catalog.provider, effortModel)
			: highlighted
				? effortsForModel(catalog, highlighted.id)
				: effortModel.efforts
		: [];
	// Reapply team policy when restoring a saved choice, including a saved Ultra.
	const policyModel: CatalogModel | undefined = effortModel && {
		...effortModel,
		efforts: [...levels],
	};
	const restored =
		policyModel &&
		(rememberedEffortForModel(remembered, policyModel) ??
			(policy === 'team-seat' ? levels[0]?.id : undefined));
	const proposed =
		pickedEffort ??
		(selectedModel === model && levels.some((item) => item.id === effort) ? effort : restored);
	const selectedEffort = levels.some((item) => item.id === proposed) ? proposed : undefined;
	const effortIndex = Math.max(
		0,
		levels.findIndex((item) => item.id === selectedEffort)
	);
	const modelRefs = useScrollIntoView<HTMLButtonElement>(true, modelIndex, rows.length, 'auto');
	const effortRefs = useScrollIntoView<HTMLButtonElement>(
		column === 'effort',
		effortIndex,
		levels.length,
		'auto'
	);
	const normal = readableTextOn(theme.colors.textMain, [
		theme.colors.bgMain,
		theme.colors.bgActivity,
	]);
	const dim = readableTextOn(theme.colors.textDim, [theme.colors.bgMain, theme.colors.bgActivity]);
	const accent = readableTextOn(theme.colors.accent, [theme.colors.bgActivity]);
	const current = catalog.models.find(
		(item) => item.id === (model || catalog.followDefault.modelId)
	);
	const unsupported =
		!!effort &&
		!!highlighted &&
		highlighted.id !== current?.id &&
		!levels.some((item) => item.id === effort);
	const selectModel = (id: string) => {
		setPickedModel(id);
		setPickedEffort(undefined);
		setColumn('model');
	};
	const confirm = (nextEffort = selectedEffort) => {
		if (selectedModel === undefined && !query) return;
		let memory = remembered;
		if (current && effort) memory = rememberEffortPerModel(memory, current, effort);
		if (policyModel?.id) memory = rememberEffortPerModel(memory, policyModel, nextEffort);
		onChange({ model: selectedModel ?? filter.trim(), effort: nextEffort, remembered: memory });
		close();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') return; // Owned exclusively by the layer stack.
		event.stopPropagation();
		if (event.nativeEvent.isComposing) return;
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			if (column === 'model' && rows.length)
				selectModel(rows[(modelIndex + delta + rows.length) % rows.length]);
			else if (levels.length)
				setPickedEffort(levels[(effortIndex + delta + levels.length) % levels.length].id);
		} else if (
			(event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) &&
			column === 'model' &&
			levels.length
		) {
			event.preventDefault();
			setColumn('effort');
		} else if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
			event.preventDefault();
			setColumn('model');
		} else if (event.key === 'Tab') {
			event.preventDefault();
			setColumn('model');
		} else if (event.key === 'Enter') {
			event.preventDefault();
			confirm();
		}
	};
	const description = (level: ModelEffort) => {
		const known = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(level.id);
		return known
			? t(
					`workflows.modelPicker.${catalog.provider === 'codex' ? 'codex' : 'claude'}.${level.id}` as MessageKey
				)
			: level.description;
	};
	return createPortal(
		<>
			<div className="fixed inset-0 z-[1000]" onMouseDown={close} />
			<div
				ref={menuRef}
				role="dialog"
				aria-label={t('workflows.modelPicker.title')}
				aria-modal="true"
				data-testid="model-effort-popover"
				className="fixed z-[1001] select-none overflow-hidden rounded-xl border flex flex-col"
				onKeyDown={onKeyDown}
				style={{
					left: position.left,
					top: position.top,
					opacity: position.ready ? 1 : 0,
					width: 'min(40rem, calc(100vw - 2rem))',
					maxHeight: position.maxHeight,
					background: theme.colors.bgMain,
					boxShadow: `0 1rem 3rem ${theme.colors.bgSidebar}80`,
					borderColor: theme.colors.border,
					color: normal,
				}}
			>
				{(catalog.error || catalog.source.kind === 'fallback') && (
					<div className="px-3 py-2 text-xs" role="status" style={{ color: dim }}>
						{t('workflows.modelPicker.fallback')}
					</div>
				)}
				<div
					className="flex items-center gap-2.5 px-3 py-2 border-b text-xs"
					style={{ borderColor: theme.colors.border }}
				>
					<Search size={14} aria-hidden style={{ color: dim }} />
					<input
						ref={filterRef}
						value={filter}
						onChange={(event) => {
							setFilter(event.target.value);
							setPickedModel(null);
							setPickedEffort(undefined);
							setColumn('model');
						}}
						className="flex-1 min-w-0 bg-transparent outline-none"
						placeholder={t('workflows.modelPicker.filter')}
						aria-label={t('workflows.modelPicker.filter')}
						role="combobox"
						aria-expanded="true"
						aria-controls={`${pickerId}-models`}
						aria-activedescendant={modelIndex >= 0 ? `${pickerId}-model-${modelIndex}` : undefined}
					/>
					<ShortcutHint theme={theme} keys={shortcutKeys ?? []} />
					<EscCloseButton theme={theme} onClose={close} />
				</div>
				{running && (
					<div role="status" className="px-3 py-2 text-xs" style={{ color: dim }}>
						{t('workflows.modelPicker.nextTurn')}
					</div>
				)}
				{unsupported && !levels.length && (
					<p className="px-3 py-2 text-xs" style={{ color: dim }}>
						{t('workflows.modelPicker.noEffort', { model: highlighted!.displayName })}
					</p>
				)}
				<div
					className={`grid min-h-0 grid-cols-1 ${levels.length ? 'min-[720px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]' : ''}`}
					style={{
						maxHeight: 'min(26.25rem, 56vh)',
					}}
				>
					<div
						id={`${pickerId}-models`}
						role="listbox"
						aria-label={t('workflows.modelPicker.models')}
						className={`overflow-y-auto p-1.5 ${levels.length ? 'max-h-[12.5rem] min-[720px]:max-h-none border-b min-[720px]:border-b-0 min-[720px]:border-r' : ''}`}
						style={{ borderColor: theme.colors.border }}
					>
						{rows.map((id, index) => {
							const item = catalog.models.find(
								(entry) => entry.id === (id || catalog.followDefault.modelId)
							);
							return (
								<button
									type="button"
									role="option"
									tabIndex={-1}
									id={`${pickerId}-model-${index}`}
									key={id}
									ref={(el) => {
										modelRefs.current[index] = el;
									}}
									aria-selected={id === selectedModel}
									onClick={() => selectModel(id)}
									className="block w-full text-left rounded-lg px-2 py-[7px]"
									style={{ background: id === selectedModel ? theme.colors.bgActivity : undefined }}
								>
									<span className="flex items-center gap-1.5 text-sm font-medium">
										{id ? item?.displayName : t('workflows.modelPicker.followDefault')}
										{!id && (
											<span
												className="text-xs-plus rounded border px-1 font-normal"
												style={{ color: dim, borderColor: theme.colors.border }}
											>
												{item?.displayName ||
													catalog.followDefault.modelId ||
													t('workflows.modelPicker.unresolved')}
											</span>
										)}
										{id === model && (
											<Check
												className="ml-auto shrink-0"
												size={14}
												aria-label={t('workflows.modelPicker.selected')}
												style={{ color: accent }}
											/>
										)}
									</span>
									<span
										className="block text-xs truncate"
										title={item?.description}
										style={{ color: dim }}
									>
										{id ? item?.description : t('workflows.modelPicker.followDescription')}
									</span>
								</button>
							);
						})}
						{!rows.length && (
							<p className="px-2 py-2 text-xs" style={{ color: dim }}>
								{t('workflows.modelPicker.custom', { model: filter.trim() })}
							</p>
						)}
						{!query && visible.some((item) => item.group === 'more') && (
							<button
								type="button"
								className="w-full text-left px-2 py-2 text-xs"
								style={{ color: dim }}
								aria-expanded={more}
								onClick={() => setMore(!more)}
							>
								{t(more ? 'workflows.modelPicker.less' : 'workflows.modelPicker.more')}
							</button>
						)}
					</div>
					{!!levels.length && (
						<div
							ref={effortRef}
							tabIndex={-1}
							role="listbox"
							aria-label={catalog.effortLabel}
							aria-activedescendant={`${pickerId}-effort-${effortIndex}`}
							className="overflow-y-auto p-1.5 outline-none"
						>
							{unsupported && (
								<p
									className="m-1.5 p-2 rounded-lg text-xs"
									style={{ color: accent, background: theme.colors.bgActivity }}
								>
									{t('workflows.modelPicker.unsupported', {
										model: highlighted!.displayName,
										effort:
											levelName(
												catalog.provider,
												levels.find((item) => item.id === restored)
											) || t('workflows.modelPicker.default'),
									})}
								</p>
							)}
							<h5 className="px-2 pt-2 pb-0.5 text-xs font-normal" style={{ color: dim }}>
								{catalog.effortLabel} · {highlighted?.displayName}
							</h5>
							{levels.map((level, index) => (
								<button
									type="button"
									role="option"
									tabIndex={-1}
									id={`${pickerId}-effort-${index}`}
									key={level.id}
									ref={(el) => {
										effortRefs.current[index] = el;
									}}
									aria-selected={level.id === selectedEffort}
									onClick={() => confirm(level.id)}
									className="block w-full text-left rounded-lg px-2 py-1.5"
									style={{
										background: level.id === selectedEffort ? theme.colors.bgActivity : undefined,
									}}
								>
									<span className="flex items-center gap-1.5 text-sm font-medium">
										{levelName(catalog.provider, level)}
										{level.id === highlighted?.defaultEffort && (
											<span
												className="rounded border px-1 text-xs-plus font-normal"
												style={{ color: dim, borderColor: theme.colors.border }}
											>
												{t('workflows.modelPicker.default')}
											</span>
										)}
									</span>
									<span className="block text-xs" style={{ color: dim }}>
										{description(level)}
									</span>
								</button>
							))}
						</div>
					)}
				</div>
				{!!catalog.quota?.windows.length && (
					<div
						data-testid="model-picker-quota"
						className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-xs border-t"
						style={{ borderColor: theme.colors.border, color: dim }}
					>
						{catalog.quota.windows.map((window) => (
							<span key={window.id} className="inline-flex items-center gap-1.5">
								<span
									className="w-11 h-[5px] rounded overflow-hidden"
									style={{ background: theme.colors.bgActivity }}
								>
									<span
										className="block h-full"
										style={{
											width: `${window.remainingPercent}%`,
											background: theme.colors.success,
										}}
									/>
								</span>
								{t('workflows.modelPicker.remaining', {
									window:
										window.label ||
										t(
											window.id === 'session'
												? 'workflows.modelPicker.session'
												: window.id === 'weekly' || window.id === 'weekAllModels'
													? 'workflows.modelPicker.week'
													: 'workflows.modelPicker.window'
										),
									percent: window.remainingPercent,
								})}
								{window.resetsAt &&
									` · ${t('workflows.modelPicker.resets', { time: new Date(window.resetsAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}`}
							</span>
						))}
						{catalog.quota.stale && <span>{t('workflows.modelPicker.stale')}</span>}
					</div>
				)}
				<div
					className="flex items-center gap-3 px-3 py-2 border-t text-xs"
					style={{ borderColor: theme.colors.border, color: dim }}
				>
					<span data-shortcut-hint>
						{t('workflows.modelPicker.keys', {
							up: formatShortcutKeys(['ArrowUp']),
							down: formatShortcutKeys(['ArrowDown']),
							right: formatShortcutKeys(['ArrowRight']),
							tab: formatShortcutKeys(['Tab']),
							enter: formatShortcutKeys(['Enter']),
						})}
					</span>
					<button
						type="button"
						className="ml-auto rounded px-2 py-1"
						style={{ background: theme.colors.bgActivity, color: accent }}
						onClick={() => confirm()}
					>
						{t('workflows.modelPicker.apply')}
					</button>
				</div>
			</div>
		</>,
		document.body
	);
}
