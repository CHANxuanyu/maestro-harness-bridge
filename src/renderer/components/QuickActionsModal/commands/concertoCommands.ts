import { getT } from '../../../i18n';
import type { QuickAction } from '../types';

interface BuildConcertoCommandsArgs {
	/** Concerto Encore Feature state - with it off, neither surface exists. */
	concertoEnabled: boolean;
	/** True while the Concerto stage window is up. */
	stageOpen: boolean;
	/** True while every cadenza card is stashed. */
	cadenzasHidden: boolean;
	/** True while the stage is popped out into a floating window. */
	stageFloating: boolean;
	toggleConcertoStage: () => void;
	toggleStageFloating: () => void;
	toggleCadenzas: () => void;
	setQuickActionOpen: (open: boolean) => void;
	shortcuts: {
		toggleConcerto?: QuickAction['shortcut'];
		toggleCadenzas?: QuickAction['shortcut'];
	};
}

/**
 * Palette entries for the Concerto surfaces.
 *
 * These are toggles, and they are offered unconditionally while Concerto is on -
 * including when nothing is on stage. The palette is where a user goes to find a
 * surface they cannot see, so an entry that disappears exactly when they have
 * lost track of the window would be the wrong way round. Cadenzas get a hotkey
 * and a palette entry but no hamburger item on purpose: stashing floating cards
 * is an in-the-moment action, not a place you navigate to.
 *
 * Dock/pop-out is palette-only and deliberately has no hotkey: it changes how an
 * already-open surface is presented rather than taking the user somewhere, and
 * it is a set-once preference, not something to flip mid-thought.
 */
export function buildConcertoCommands({
	concertoEnabled,
	stageOpen,
	cadenzasHidden,
	stageFloating,
	toggleConcertoStage,
	toggleStageFloating,
	toggleCadenzas,
	setQuickActionOpen,
	shortcuts,
}: BuildConcertoCommandsArgs): QuickAction[] {
	const t = getT();
	if (!concertoEnabled) return [];

	return [
		{
			id: 'concerto-stage',
			label: stageOpen
				? t('workflows.shell.hideConcertoStage')
				: t('workflows.shell.showConcertoStage'),
			shortcut: shortcuts.toggleConcerto,
			subtext: stageOpen
				? t('workflows.shell.parkTheStageWindowPanelsKeepRunning')
				: t('workflows.shell.agentComposedInteractiveViewsInOneResizableWindow'),
			action: () => {
				toggleConcertoStage();
				setQuickActionOpen(false);
			},
		},
		{
			id: 'concerto-stage-float',
			label: stageFloating
				? t('workflows.shell.dockConcertoStage')
				: t('workflows.shell.popConcertoStageOut'),
			subtext: stageFloating
				? t('workflows.shell.backToACenteredWindow')
				: t('workflows.shell.floatTheStageSoYouCanKeepTyping'),
			action: () => {
				toggleStageFloating();
				setQuickActionOpen(false);
			},
		},
		{
			id: 'concerto-cadenzas',
			label: cadenzasHidden
				? t('workflows.shell.showAllCadenzas')
				: t('workflows.shell.hideAllCadenzas'),
			shortcut: shortcuts.toggleCadenzas,
			subtext: cadenzasHidden
				? t('workflows.shell.bringBackTheStashedFloatingCards')
				: t('workflows.shell.stashEveryFloatingCardWithoutClosingAnyOf'),
			action: () => {
				toggleCadenzas();
				setQuickActionOpen(false);
			},
		},
	];
}
