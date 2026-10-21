import {
	Bell,
	Wand2,
	Plus,
	Settings,
	Keyboard,
	ScrollText,
	Cpu,
	ExternalLink,
	Info,
	Download,
	Compass,
	Globe,
	BookOpen,
	BarChart3,
	Music,
	Command,
	Zap,
	Music2,
	LogOut,
} from 'lucide-react';
import type { Theme } from '../../types';
import { formatShortcutKeys } from '../../utils/shortcutFormatter';
import { useSettingsStore } from '../../stores/settingsStore';
import { getModalActions } from '../../stores/modalStore';
import { buildMaestroUrl } from '../../utils/buildMaestroUrl';
import { openUiSurface } from '../../utils/openUiSurface';
import { openUrl } from '../../utils/openUrl';
import { isWebDesktop } from '../../utils/runtimeContext';
import { currentWebLoginUser, signOutWebLogin } from '../../services/webLoginSession';
import { usePhoneLayout } from '../../hooks/ui/useViewportBreakpoint';
import { ShortcutHint } from '../ui/ShortcutHint';
import { useT } from '../../i18n';

interface HamburgerMenuContentProps {
	theme: Theme;
	onNewAgentSession?: () => void;
	openWizard?: () => void;
	startTour?: () => void;
	setMenuOpen: (open: boolean) => void;
}

export function HamburgerMenuContent({
	theme,
	onNewAgentSession,
	openWizard,
	startTour,
	setMenuOpen,
}: HamburgerMenuContentProps) {
	const t = useT();
	const shortcuts = useSettingsStore((s) => s.shortcuts);
	const encoreFeatures = useSettingsStore((s) => s.encoreFeatures);
	// A phone has no keyboard and no room for a guided tour's anchored
	// callouts, so the two entries that exist only for those are not offered.
	// (The chord badges beside every other row are hidden by CSS via
	// data-shortcut-hint.)
	const phone = usePhoneLayout();
	// Only a browser that actually signed in has somewhere to sign out to. On
	// the desktop there is no session and no login page, so the row is absent
	// rather than disabled.
	const webLoginUser = isWebDesktop() ? currentWebLoginUser() : null;
	const {
		setShortcutsHelpOpen,
		setSettingsModalOpen,
		setLogViewerOpen,
		setProcessMonitorOpen,
		setUsageDashboardOpen,
		setSymphonyModalOpen,
		setDirectorNotesOpen,
		setCueModalOpen,
		setPianolaModalOpen,
		setConcertoStageOpen,
		setUpdateCheckModalOpen,
		setAboutModalOpen,
		setQuickActionOpen,
	} = getModalActions();

	return (
		<div className="p-1">
			{onNewAgentSession && (
				<button
					onClick={() => {
						onNewAgentSession();
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Plus className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.menu.newAgent')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.newAgentHint')}
						</div>
					</div>
					<span
						className="text-xs font-mono px-1.5 py-0.5 rounded"
						data-shortcut-hint=""
						style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
					>
						{shortcuts.newInstance ? formatShortcutKeys(shortcuts.newInstance.keys) : '⌘N'}
					</span>
				</button>
			)}
			{openWizard && (
				<button
					onClick={() => {
						openWizard();
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Wand2 className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.emptyState.wizard')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.emptyState.wizardHint')}
						</div>
					</div>
					<span
						className="text-xs font-mono px-1.5 py-0.5 rounded"
						data-shortcut-hint=""
						style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
					>
						{shortcuts.openWizard ? formatShortcutKeys(shortcuts.openWizard.keys) : '⇧⌘N'}
					</span>
				</button>
			)}
			<button
				onClick={() => {
					setQuickActionOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Command className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('workflows.menu.commandPalette')}
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{t('workflows.menu.commandPaletteHint')}
					</div>
				</div>
				<span
					className="text-xs font-mono px-1.5 py-0.5 rounded"
					data-shortcut-hint=""
					style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
				>
					{shortcuts.quickAction ? formatShortcutKeys(shortcuts.quickAction.keys) : '⌘K'}
				</span>
			</button>
			<button
				onClick={() => {
					openUiSurface('notification-center');
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Bell className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('workflows.menu.notificationCenter')}
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{t('workflows.menu.notificationCenterHint')}
					</div>
				</div>
				<ShortcutHint keys={shortcuts.openNotificationCenter?.keys ?? []} theme={theme} />
			</button>
			{startTour && !phone && (
				<button
					onClick={() => {
						startTour();
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Compass className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.menu.tour')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.tourHint')}
						</div>
					</div>
				</button>
			)}
			<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
			{!phone && (
				<button
					onClick={() => {
						setShortcutsHelpOpen(true);
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Keyboard className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.emptyState.shortcuts')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.shortcutsHint')}
						</div>
					</div>
					<span
						className="text-xs font-mono px-1.5 py-0.5 rounded"
						data-shortcut-hint=""
						style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
					>
						{formatShortcutKeys(shortcuts.help.keys)}
					</span>
				</button>
			)}
			<button
				onClick={() => {
					setSettingsModalOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Settings className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('common.settings')}
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{t('workflows.menu.settingsHint')}
					</div>
				</div>
				<span
					className="text-xs font-mono px-1.5 py-0.5 rounded"
					data-shortcut-hint=""
					style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
				>
					{formatShortcutKeys(shortcuts.settings.keys)}
				</span>
			</button>
			<button
				onClick={() => {
					setLogViewerOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<ScrollText className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('workflows.menu.systemLogs')}
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{t('workflows.menu.systemLogsHint')}
					</div>
				</div>
				<span
					className="text-xs font-mono px-1.5 py-0.5 rounded"
					data-shortcut-hint=""
					style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
				>
					{formatShortcutKeys(shortcuts.systemLogs.keys)}
				</span>
			</button>
			<button
				onClick={() => {
					setProcessMonitorOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Cpu className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('workflows.menu.processMonitor')}
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{t('workflows.menu.processMonitorHint')}
					</div>
				</div>
				<span
					className="text-xs font-mono px-1.5 py-0.5 rounded"
					data-shortcut-hint=""
					style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
				>
					{formatShortcutKeys(shortcuts.processMonitor.keys)}
				</span>
			</button>
			{encoreFeatures.usageStats && (
				<button
					onClick={() => {
						setUsageDashboardOpen(true);
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<BarChart3 className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.menu.usageDashboard')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.usageDashboardHint')}
						</div>
					</div>
					<span
						className="text-xs font-mono px-1.5 py-0.5 rounded"
						data-shortcut-hint=""
						style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
					>
						{formatShortcutKeys(shortcuts.usageDashboard.keys)}
					</span>
				</button>
			)}
			{encoreFeatures.directorNotes && (
				<button
					onClick={() => {
						setDirectorNotesOpen(true);
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<ScrollText className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.menu.directorNotes')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.directorNotesHint')}
						</div>
					</div>
					{shortcuts.directorNotes && (
						<span
							className="text-xs font-mono px-1.5 py-0.5 rounded"
							data-shortcut-hint=""
							style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
						>
							{formatShortcutKeys(shortcuts.directorNotes.keys)}
						</span>
					)}
				</button>
			)}
			{encoreFeatures.symphony && (
				<button
					onClick={() => {
						setSymphonyModalOpen(true);
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Music className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.shell.maestroSymphony')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.symphonyHint')}
						</div>
					</div>
					<span
						className="text-xs font-mono px-1.5 py-0.5 rounded"
						data-shortcut-hint=""
						style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
					>
						{shortcuts.openSymphony ? formatShortcutKeys(shortcuts.openSymphony.keys) : '⌥⌘Y'}
					</span>
				</button>
			)}
			{encoreFeatures.maestroCue && (
				<button
					onClick={() => {
						setCueModalOpen(true);
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Zap className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.shell.maestroCue')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.cueHint')}
						</div>
					</div>
					{shortcuts.openCue && (
						<span
							className="text-xs font-mono px-1.5 py-0.5 rounded"
							data-shortcut-hint=""
							style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
						>
							{formatShortcutKeys(shortcuts.openCue.keys)}
						</span>
					)}
				</button>
			)}
			{encoreFeatures.concerto && (
				<button
					onClick={() => {
						setConcertoStageOpen(true);
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Music2 className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.shell.concerto')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.concertoHint')}
						</div>
					</div>
					{shortcuts.toggleConcerto && (
						<span
							className="text-xs font-mono px-1.5 py-0.5 rounded"
							data-shortcut-hint=""
							style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
						>
							{formatShortcutKeys(shortcuts.toggleConcerto.keys)}
						</span>
					)}
				</button>
			)}
			{encoreFeatures.pianola && (
				<button
					onClick={() => {
						setPianolaModalOpen(true);
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Music className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.shell.pianola')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.pianolaHint')}
						</div>
					</div>
				</button>
			)}
			<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
			<button
				onClick={() => {
					openUrl(buildMaestroUrl('https://runmaestro.ai'));
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Globe className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('workflows.emptyState.website')}
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{t('workflows.emptyState.websiteHint')}
					</div>
				</div>
				<ExternalLink className="w-4 h-4" style={{ color: theme.colors.textDim }} />
			</button>
			<button
				onClick={() => {
					openUrl(buildMaestroUrl('https://docs.runmaestro.ai'));
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<BookOpen className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('workflows.emptyState.docs')}
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{t('workflows.emptyState.docsHint')}
					</div>
				</div>
				<ExternalLink className="w-4 h-4" style={{ color: theme.colors.textDim }} />
			</button>
			{/* Check for Updates assumes the user is running the Electron binary
			    directly - it would dump a misleading dialog when the renderer is
			    served through the web-desktop bridge. Hide it in that context. */}
			{!isWebDesktop() && (
				<button
					onClick={() => {
						setUpdateCheckModalOpen(true);
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Download className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.emptyState.checkUpdates')}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.emptyState.checkUpdatesHint')}
						</div>
					</div>
				</button>
			)}
			<button
				onClick={() => {
					setAboutModalOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Info className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('workflows.emptyState.about')}
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{t('workflows.emptyState.aboutHint')}
					</div>
				</div>
			</button>
			{webLoginUser && (
				<button
					data-testid="hamburger-sign-out"
					onClick={() => {
						setMenuOpen(false);
						void signOutWebLogin();
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<LogOut className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{t('workflows.menu.signOut', { name: webLoginUser.displayName })}
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.menu.signOutHint')}
						</div>
					</div>
				</button>
			)}
		</div>
	);
}
