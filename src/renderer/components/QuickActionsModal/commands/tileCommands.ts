import { getT, type TFunction } from '../../../i18n';
import type { Session } from '../../../types';
import type { QuickAction } from '../types';
import { isWebDesktop } from '../../../utils/runtimeContext';
import { tileNewTabInSession } from '../../../services/tileNewTabAction';
import { canTileNewTab, type TileableTabKind } from '../../../hooks/tabs/tileNewTab';

interface BuildTileCommandsArgs {
	activeSession: Session | undefined;
	setQuickActionOpen: (open: boolean) => void;
	/**
	 * Hotkeys to show on each row, keyed by the kind's shortcut id. Only the
	 * terminal kind ships with a default chord; the rest render no badge until
	 * the user assigns one in Settings -> Shortcuts, at which point it appears
	 * here automatically.
	 */
	shortcuts?: Partial<Record<TileShortcutId, QuickAction['shortcut']>>;
}

/**
 * The tile-below family, in the order they read in the palette. Every label
 * starts with "Tile" so typing `tile` surfaces the whole set at once (the
 * palette filters on a plain substring of the label and sorts alphabetically,
 * so the shared prefix is what clusters them).
 */
export type TileShortcutId =
	| 'tileAiBelow'
	| 'tileBrowserBelow'
	| 'tileFileBelow'
	| 'tileTerminalBelow';

function getTileKinds(t: TFunction): ReadonlyArray<{
	kind: TileableTabKind;
	label: string;
	subtext: string;
	shortcutId: TileShortcutId;
}> {
	return [
		{
			kind: 'ai',
			label: t('workflows.shell.tileNewAiChatBelow'),
			subtext: t('workflows.shell.splitTheCurrentViewAndOpenANew'),
			shortcutId: 'tileAiBelow',
		},
		{
			kind: 'browser',
			label: t('workflows.shell.tileNewBrowserBelow'),
			subtext: t('workflows.shell.splitTheCurrentViewAndOpenANew2'),
			shortcutId: 'tileBrowserBelow',
		},
		{
			kind: 'file',
			label: t('workflows.shell.tileNewFileBelow'),
			subtext: t('workflows.shell.splitTheCurrentViewAndOpenANew3'),
			shortcutId: 'tileFileBelow',
		},
		{
			kind: 'terminal',
			label: t('workflows.shell.tileNewTerminalBelow'),
			subtext: t('workflows.shell.splitTheCurrentViewAndOpenANew4'),
			shortcutId: 'tileTerminalBelow',
		},
	];
}

/**
 * Commands that create a tab AND tile it under the current view in one step,
 * so a user never has to open a tab and then drag it into place. The work is
 * done by {@link tileNewTab}, which reuses the same layout primitives as the
 * drag-to-tile path.
 *
 * Emitted only when there is a tab on screen to split against - with no tabs at
 * all these would just be slower versions of the New Tab commands.
 */
export function buildTileCommands({
	activeSession,
	setQuickActionOpen,
	shortcuts,
}: BuildTileCommandsArgs): QuickAction[] {
	if (!canTileNewTab(activeSession) || !activeSession) return [];
	const sessionId = activeSession.id;

	return getTileKinds(getT())
		.filter(
			// Browser tabs need the Electron <webview>, which is inert in the
			// web-desktop bundle; tiling one there would place an empty pane.
			({ kind }) => kind !== 'browser' || !isWebDesktop()
		)
		.map(({ kind, label, subtext, shortcutId }) => ({
			id: `tileBelow:${kind}`,
			label,
			subtext,
			// An unbound entry has `keys: []`; drop the badge entirely rather than
			// rendering an empty pill next to the label.
			shortcut: shortcuts?.[shortcutId]?.keys?.length ? shortcuts[shortcutId] : undefined,
			action: () => {
				setQuickActionOpen(false);
				tileNewTabInSession(sessionId, kind);
			},
		}));
}
