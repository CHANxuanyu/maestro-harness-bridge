import { useI18n, type MessageKey } from '../../../i18n';
import { useShortcutLabel } from '../../../i18n/shortcutLabels';
/**
 * ShortcutsTab - Keyboard shortcuts settings tab
 *
 * Displays configurable shortcuts with recording, filtering, and
 * grouping (General vs AI Tab). Self-sources shortcut settings
 * from useSettings().
 */

import React, { useState, useRef, useEffect } from 'react';
import { Keyboard, MessageSquare, X } from 'lucide-react';
import { useSettings } from '../../../hooks';
import { formatShortcutKeys } from '../../../utils/shortcutFormatter';
import { buildKeysFromEvent } from '../../../utils/shortcutRecorder';
import { shortcutKeysEqual, findReservedShortcutCombo } from '../../../../shared/shortcutKeys';
import { ShortcutFilterButton } from '../../ui/ShortcutFilterButton';
import { GhostIconButton } from '../../ui/GhostIconButton';
import { FIXED_SHORTCUTS } from '../../../constants/shortcuts';
import { SettingsSectionHeading } from '../SettingsSectionHeading';
import type { Theme, Shortcut } from '../../../types';

const RESERVED_REASON_KEYS: Readonly<Record<string, MessageKey>> = {
	'extends the text selection to the top': 'settings.finish.shortcuts.reason.top',
	'extends the text selection to the bottom': 'settings.finish.shortcuts.reason.bottom',
	'extends the text selection to the start of the line':
		'settings.finish.shortcuts.reason.lineStart',
	'extends the text selection to the end of the line': 'settings.finish.shortcuts.reason.lineEnd',
};

type ShortcutConflict =
	| { kind: 'reserved'; keys: string[]; reason: string }
	| { kind: 'duplicate'; keys: string[]; action: Shortcut };

export interface ShortcutsTabProps {
	theme: Theme;
	hasNoAgents?: boolean;
	onRecordingChange?: (isRecording: boolean) => void;
}

export function ShortcutsTab({ theme, hasNoAgents, onRecordingChange }: ShortcutsTabProps) {
	const { t, tRich } = useI18n();
	const shortcutLabel = useShortcutLabel();
	const { shortcuts, setShortcuts, tabShortcuts, setTabShortcuts } = useSettings();

	const [recordingId, setRecordingId] = useState<string | null>(null);
	const [shortcutsFilter, setShortcutsFilter] = useState('');
	const [recordingFilterShortcut, setRecordingFilterShortcut] = useState(false);
	const [filterShortcutKeys, setFilterShortcutKeys] = useState<string[]>([]);
	const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
	const [shortcutConflict, setShortcutConflict] = useState<ShortcutConflict | null>(null);
	const conflictMessage = shortcutConflict
		? shortcutConflict.kind === 'reserved'
			? t('settings.finish.shortcuts.reserved', {
					keys: formatShortcutKeys(shortcutConflict.keys),
					reason: RESERVED_REASON_KEYS[shortcutConflict.reason]
						? t(RESERVED_REASON_KEYS[shortcutConflict.reason])
						: shortcutConflict.reason,
				})
			: t('settings.finish.shortcuts.conflict', {
					keys: formatShortcutKeys(shortcutConflict.keys),
					action: shortcutLabel(shortcutConflict.action),
				})
		: null;
	const shortcutsFilterRef = useRef<HTMLInputElement>(null);

	// Notify parent of recording state changes (for escape handler coordination)
	useEffect(() => {
		onRecordingChange?.(!!recordingId || recordingFilterShortcut);
	}, [recordingId, recordingFilterShortcut, onRecordingChange]);

	// Auto-focus filter input on mount
	useEffect(() => {
		const timer = setTimeout(() => shortcutsFilterRef.current?.focus(), 50);
		return () => clearTimeout(timer);
	}, []);

	const saveKeys = (actionId: string, isTabShortcut: boolean, keys: string[]) => {
		if (isTabShortcut) {
			setTabShortcuts({
				...tabShortcuts,
				[actionId]: { ...tabShortcuts[actionId], keys },
			});
		} else {
			setShortcuts({
				...shortcuts,
				[actionId]: { ...shortcuts[actionId], keys },
			});
		}
	};

	// An empty key list is the stored form of "Unassigned". The load-time merge
	// only falls back to the default on a missing entry, so the clear sticks.
	const clearShortcut = (actionId: string, isTabShortcut: boolean) => {
		setShortcutConflict(null);
		saveKeys(actionId, isTabShortcut, []);
		setRecordingId(null);
	};

	const handleRecord = (
		e: React.KeyboardEvent,
		actionId: string,
		isTabShortcut: boolean = false
	) => {
		e.preventDefault();
		e.stopPropagation();

		// Escape cancels recording without saving
		if (e.key === 'Escape') {
			setRecordingId(null);
			return;
		}

		// A bare Backspace or Delete clears the binding, as in the macOS keyboard
		// settings. Nobody can want either one bare as a global shortcut: it would
		// swallow deletion in every text field in the app.
		if (
			(e.key === 'Backspace' || e.key === 'Delete') &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey &&
			!e.shiftKey
		) {
			clearShortcut(actionId, isTabShortcut);
			return;
		}

		const keys = buildKeysFromEvent(e);
		if (!keys) return;

		// Refuse a chord the OS owns inside a text field before checking Maestro's
		// own table. These never collide with another action, so the conflict
		// check below would wave them through, and the binding then shadows
		// select-to-end in every input in the app.
		const reserved = findReservedShortcutCombo(keys);
		if (reserved) {
			setShortcutConflict({ kind: 'reserved', keys, reason: reserved.reason });
			setRecordingId(null);
			return;
		}

		// Refuse a chord that is already spoken for. Scanning FIXED_SHORTCUTS too
		// is the part that is easy to miss: those cannot be rebound, so a
		// collision with one is unresolvable from this screen and silently
		// shadowing it would be the worst outcome of the three.
		//
		// Reject rather than auto-steal. Taking the chord would leave the other
		// action dead with no indication, and the user would find out weeks later
		// when a key they have used for months stops working.
		const conflict = [
			...Object.values(shortcuts),
			...Object.values(tabShortcuts),
			...Object.values(FIXED_SHORTCUTS),
		].find((sc) => sc.id !== actionId && shortcutKeysEqual(sc.keys, keys));

		if (conflict) {
			// Name the LABEL, not the id: the user picked this action from a list of
			// labels, and 'closeOtherTabs' is not what they read.
			setShortcutConflict({ kind: 'duplicate', keys, action: conflict });
			setRecordingId(null);
			return;
		}
		setShortcutConflict(null);
		saveKeys(actionId, isTabShortcut, keys);
		setRecordingId(null);
	};

	const allShortcuts = [
		...Object.values(shortcuts).map((sc) => ({ ...sc, isTabShortcut: false })),
		...Object.values(tabShortcuts).map((sc) => ({ ...sc, isTabShortcut: true })),
	];
	const totalShortcuts = allShortcuts.length;
	const unassignedCount = allShortcuts.filter((sc) => !sc.keys?.length).length;
	const filteredShortcuts = allShortcuts.filter((sc) => {
		// The unassigned view is a mode, not another filter: someone asking "what
		// can I still bind?" wants the whole list of them, not the intersection
		// with whatever they last typed.
		if (showUnassignedOnly) return !sc.keys?.length;
		if (filterShortcutKeys.length > 0) {
			return shortcutKeysEqual(sc.keys, filterShortcutKeys);
		}
		const query = shortcutsFilter.toLowerCase();
		return (
			shortcutLabel(sc).toLowerCase().includes(query) || sc.label.toLowerCase().includes(query)
		);
	});
	const filteredCount = filteredShortcuts.length;

	// Group shortcuts by category
	const generalShortcuts = filteredShortcuts.filter((sc) => !sc.isTabShortcut);
	const tabShortcutsFiltered = filteredShortcuts.filter((sc) => sc.isTabShortcut);

	const renderShortcutItem = (sc: Shortcut & { isTabShortcut: boolean }) => (
		<div
			key={sc.id}
			className="flex items-center justify-between p-3 rounded border"
			style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
		>
			<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
				{shortcutLabel(sc)}
			</span>
			<div className="flex items-center gap-1">
				<button
					onClick={(e) => {
						setRecordingId(sc.id);
						e.currentTarget.focus();
					}}
					onKeyDownCapture={(e) => {
						if (recordingId === sc.id) {
							e.preventDefault();
							e.stopPropagation();
							handleRecord(e, sc.id, sc.isTabShortcut);
						}
					}}
					className={`px-3 py-1.5 rounded border text-xs font-mono min-w-[80px] text-center transition-colors ${recordingId === sc.id ? 'ring-2' : ''}`}
					style={
						{
							borderColor: recordingId === sc.id ? theme.colors.accent : theme.colors.border,
							backgroundColor:
								recordingId === sc.id ? theme.colors.accentDim : theme.colors.bgActivity,
							color: recordingId === sc.id ? theme.colors.accent : theme.colors.textDim,
							opacity: recordingId !== sc.id && sc.keys.length === 0 ? 0.6 : 1,
							'--tw-ring-color': theme.colors.accent,
						} as React.CSSProperties
					}
				>
					{recordingId === sc.id
						? t('settings.finish.shortcuts.press')
						: sc.keys?.length
							? formatShortcutKeys(sc.keys)
							: // An action registered with no default chord (keys: []) formats to an
								// empty string, which renders as a blank button the user cannot tell
								// is clickable. Label it so it reads as "assign one here".
								t('settings.finish.shortcuts.notSet')}
				</button>
				{sc.keys?.length && recordingId !== sc.id ? (
					<GhostIconButton
						onClick={() => clearShortcut(sc.id, sc.isTabShortcut)}
						ariaLabel={t('settings.finish.shortcuts.clearAction', { action: shortcutLabel(sc) })}
						title={t('settings.finish.shortcuts.clear')}
						color={theme.colors.textDim}
					>
						<X className="w-3.5 h-3.5" />
					</GhostIconButton>
				) : (
					// Hold the slot so the key buttons stay in one column whether or
					// not a row has anything to clear.
					<span className="w-[22px]" aria-hidden />
				)}
			</div>
		</div>
	);

	return (
		<div data-setting-id="shortcuts-tab" className="flex flex-col" style={{ minHeight: '450px' }}>
			{hasNoAgents && (
				<p
					className="text-xs mb-3 px-2 py-1.5 rounded"
					style={{
						backgroundColor: theme.colors.accent + '20',
						color: theme.colors.accent,
					}}
				>
					{t('settings.finish.shortcuts.noAgents')}
				</p>
			)}
			<div className="flex items-stretch gap-2 mb-3">
				<input
					ref={shortcutsFilterRef}
					type="text"
					value={shortcutsFilter}
					onChange={(e) => {
						setShortcutsFilter(e.target.value);
						setFilterShortcutKeys([]);
						setShowUnassignedOnly(false);
					}}
					placeholder={t('settings.finish.shortcuts.filter')}
					className="flex-1 px-3 py-2 rounded border bg-transparent outline-none text-sm"
					style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
				/>
				<ShortcutFilterButton
					theme={theme}
					keys={filterShortcutKeys}
					onKeysChange={setFilterShortcutKeys}
					recording={recordingFilterShortcut}
					onRecordingChange={setRecordingFilterShortcut}
				/>
				{unassignedCount > 0 && (
					<button
						type="button"
						onClick={() => {
							setShowUnassignedOnly((v) => !v);
							setShortcutsFilter('');
							setFilterShortcutKeys([]);
						}}
						aria-pressed={showUnassignedOnly}
						title={t('settings.finish.shortcuts.unassignedHint')}
						className="text-xs px-2 rounded font-medium whitespace-nowrap border"
						style={{
							backgroundColor: showUnassignedOnly
								? theme.colors.accentDim
								: theme.colors.bgActivity,
							borderColor: showUnassignedOnly ? theme.colors.accent : theme.colors.border,
							color: showUnassignedOnly ? theme.colors.accent : theme.colors.textDim,
						}}
					>
						{t('settings.finish.shortcuts.unassigned', { count: unassignedCount })}
					</button>
				)}
				<span
					className="text-xs px-2 rounded font-medium flex items-center"
					style={{
						backgroundColor: theme.colors.bgActivity,
						color: theme.colors.textDim,
					}}
				>
					{shortcutsFilter || filterShortcutKeys.length > 0 || showUnassignedOnly
						? `${filteredCount} / ${totalShortcuts}`
						: totalShortcuts}
				</span>
			</div>
			{conflictMessage && (
				<p
					role="alert"
					className="text-xs mb-3 px-2 py-1.5 rounded"
					style={{
						backgroundColor: `${theme.colors.error}20`,
						color: theme.colors.error,
					}}
				>
					{conflictMessage}
				</p>
			)}
			<p className="text-xs mb-3" style={{ color: theme.colors.textDim }}>
				{tRich('settings.finish.shortcuts.help', {
					key: (
						<kbd
							className="px-1.5 py-0.5 rounded font-mono"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							{formatShortcutKeys(['Meta', '/'])}
						</kbd>
					),
				})}
			</p>
			<div className="space-y-5 flex-1 overflow-y-auto pr-2 scrollbar-thin">
				{/* General Shortcuts Section */}
				{generalShortcuts.length > 0 && (
					<div>
						<SettingsSectionHeading icon={Keyboard}>
							{t('settings.finish.shortcuts.general')}
						</SettingsSectionHeading>
						<div className="space-y-2">{generalShortcuts.map(renderShortcutItem)}</div>
					</div>
				)}

				{/* AI Tab Shortcuts Section */}
				{tabShortcutsFiltered.length > 0 && (
					<div>
						<SettingsSectionHeading icon={MessageSquare}>
							{t('settings.finish.shortcuts.aiTab')}
						</SettingsSectionHeading>
						<div className="space-y-2">{tabShortcutsFiltered.map(renderShortcutItem)}</div>
					</div>
				)}
			</div>
		</div>
	);
}
