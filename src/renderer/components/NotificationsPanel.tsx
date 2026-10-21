import { useT } from '../i18n';
import { useShallow } from 'zustand/react/shallow';
import { useState, useEffect } from 'react';
import {
	Bell,
	Volume2,
	Clock,
	Square,
	Check,
	AlertCircle,
	Loader2,
	Coffee,
	LayoutGrid,
} from 'lucide-react';
import { Spinner } from './ui/Spinner';
import type { Theme } from '../types';
import type { ToastWidth } from '../../shared/toastWidth';
import { TOAST_WIDTHS } from '../../shared/toastWidth';
import type { ToastPosition } from '../../shared/toastPosition';
import { TOAST_POSITIONS } from '../../shared/toastPosition';
import { SettingCheckbox } from './SettingCheckbox';
import { ToggleButtonGroup } from './ToggleButtonGroup';
import { SettingsSectionHeading } from './Settings/SettingsSectionHeading';
import { SectionCard } from './Settings/tabs/DisplayTab/components/SectionCard';
import { ToggleSettingRow } from './Settings/tabs/DisplayTab/components/ToggleSettingRow';
import { useSettingsStore } from '../stores/settingsStore';
import { shortcutSuffix } from './ui/ShortcutHint';
import { logger } from '../utils/logger';
import { showOsNotification } from '../stores/notificationStore';

interface NotificationsPanelProps {
	osNotificationsEnabled: boolean;
	setOsNotificationsEnabled: (value: boolean) => void;
	audioFeedbackEnabled: boolean;
	setAudioFeedbackEnabled: (value: boolean) => void;
	audioFeedbackCommand: string;
	setAudioFeedbackCommand: (value: string) => void;
	toastDuration: number;
	setToastDuration: (value: number) => void;
	toastWidth: ToastWidth;
	setToastWidth: (value: ToastWidth) => void;
	toastPosition: ToastPosition;
	setToastPosition: (value: ToastPosition) => void;
	idleNotificationEnabled: boolean;
	setIdleNotificationEnabled: (value: boolean) => void;
	idleNotificationCommand: string;
	setIdleNotificationCommand: (value: string) => void;
	onConfigureNotificationShortcut?: () => void;
	theme: Theme;
}

type TestStatus = 'idle' | 'running' | 'success' | 'error';

export function NotificationsPanel({
	osNotificationsEnabled,
	setOsNotificationsEnabled,
	audioFeedbackEnabled,
	setAudioFeedbackEnabled,
	audioFeedbackCommand,
	setAudioFeedbackCommand,
	toastDuration,
	setToastDuration,
	toastWidth,
	setToastWidth,
	toastPosition,
	setToastPosition,
	idleNotificationEnabled,
	setIdleNotificationEnabled,
	idleNotificationCommand,
	setIdleNotificationCommand,
	theme,
	onConfigureNotificationShortcut,
}: NotificationsPanelProps) {
	const tExtra = useT();
	const settings = useSettingsStore(
		useShallow((s) => ({
			notificationCenterLarge: s.notificationCenterLarge,
			setNotificationCenterLarge: s.setNotificationCenterLarge,
			notificationCenterDetails: s.notificationCenterDetails,
			setNotificationCenterDetails: s.setNotificationCenterDetails,
			notificationCenterKeyboardNavigation: s.notificationCenterKeyboardNavigation,
			setNotificationCenterKeyboardNavigation: s.setNotificationCenterKeyboardNavigation,
			notificationHistoryQueuedReplies: s.notificationHistoryQueuedReplies,
			setNotificationHistoryQueuedReplies: s.setNotificationHistoryQueuedReplies,
			notificationHistoryAutoRunTasks: s.notificationHistoryAutoRunTasks,
			setNotificationHistoryAutoRunTasks: s.setNotificationHistoryAutoRunTasks,
			shortcuts: s.shortcuts,
		}))
	);
	// Custom notification test state
	const [testNotificationId, setTestNotificationId] = useState<number | null>(null);
	const [testStatus, setTestStatus] = useState<TestStatus>('idle');
	const [testError, setTestError] = useState<string | null>(null);

	// Idle notification test state
	const [idleTestNotificationId, setIdleTestNotificationId] = useState<number | null>(null);
	const [idleTestStatus, setIdleTestStatus] = useState<TestStatus>('idle');
	const [idleTestError, setIdleTestError] = useState<string | null>(null);

	// Clear success/error status after a delay
	useEffect(() => {
		if (testStatus === 'success' || testStatus === 'error') {
			const timer = setTimeout(() => {
				setTestStatus('idle');
				setTestError(null);
			}, 3000);
			return () => clearTimeout(timer);
		}
	}, [testStatus]);

	// Listen for notification command completion to reset the Stop button
	useEffect(() => {
		if (testNotificationId === null) return;

		const cleanup = window.maestro.notification.onCommandCompleted((completedId) => {
			if (completedId === testNotificationId) {
				logger.info('[Notification] Command completed, id:', undefined, completedId);
				setTestNotificationId(null);
				setTestStatus('success');
			}
		});

		return cleanup;
	}, [testNotificationId]);

	// Idle notification: clear success/error status after a delay
	useEffect(() => {
		if (idleTestStatus === 'success' || idleTestStatus === 'error') {
			const timer = setTimeout(() => {
				setIdleTestStatus('idle');
				setIdleTestError(null);
			}, 3000);
			return () => clearTimeout(timer);
		}
	}, [idleTestStatus]);

	// Idle notification: listen for command completion
	useEffect(() => {
		if (idleTestNotificationId === null) return;

		const cleanup = window.maestro.notification.onCommandCompleted((completedId) => {
			if (completedId === idleTestNotificationId) {
				setIdleTestNotificationId(null);
				setIdleTestStatus('success');
			}
		});

		return cleanup;
	}, [idleTestNotificationId]);

	return (
		<div className="space-y-6">
			<div data-setting-id="notifications-center">
				<SettingsSectionHeading
					icon={Bell}
					description={tExtra(
						'settings.extra.notificationsPanel.optionalInboxEnhancementsAllAreOffBy'
					)}
				>
					{tExtra('settings.extra.notificationsPanel.notificationCenter')}
				</SettingsSectionHeading>
				<SectionCard theme={theme}>
					<ToggleSettingRow
						theme={theme}
						title={tExtra('settings.extra.notificationsPanel.useALargerNotificationCenter')}
						description={tExtra(
							'settings.extra.notificationsPanel.useAWiderTallerInboxWhileKeeping'
						)}
						checked={settings.notificationCenterLarge}
						onChange={settings.setNotificationCenterLarge}
						ariaLabel={tExtra('settings.extra.controls.useALargerNotificationCenter')}
						clickableRow
					/>
					<ToggleSettingRow
						theme={theme}
						title={tExtra('settings.extra.notificationsPanel.expandNotificationDetails')}
						description={tExtra(
							'settings.extra.notificationsPanel.readFullSourceNamesTitlesAndMessages'
						)}
						checked={settings.notificationCenterDetails}
						onChange={settings.setNotificationCenterDetails}
						ariaLabel={tExtra('settings.extra.controls.expandNotificationDetails')}
						clickableRow
					/>
					<ToggleSettingRow
						theme={theme}
						title={tExtra(
							'settings.extra.notificationsPanel.keyboardNavigationInTheNotificationCenter'
						)}
						description={tExtra('settings.extra.notificationsPanel.focusTheInboxWhenItOpensAnd')}
						checked={settings.notificationCenterKeyboardNavigation}
						onChange={settings.setNotificationCenterKeyboardNavigation}
						ariaLabel={tExtra('settings.extra.controls.keyboardNavigationInTheNotificationCenter')}
						clickableRow
					/>
					<ToggleSettingRow
						theme={theme}
						title={tExtra('settings.extra.notificationsPanel.recordEachQueuedReply')}
						description={tExtra(
							'settings.extra.notificationsPanel.keepEveryCompletedQueuedReplyInNotification'
						)}
						checked={settings.notificationHistoryQueuedReplies}
						onChange={settings.setNotificationHistoryQueuedReplies}
						ariaLabel={tExtra('settings.extra.controls.recordEachQueuedReply')}
						clickableRow
					/>
					<ToggleSettingRow
						theme={theme}
						title={tExtra('settings.extra.notificationsPanel.recordEachAutoRunTask')}
						description={tExtra('settings.extra.notificationsPanel.keepEachCompletedAutoRunTaskIn')}
						checked={settings.notificationHistoryAutoRunTasks}
						onChange={settings.setNotificationHistoryAutoRunTasks}
						ariaLabel={tExtra('settings.extra.controls.recordEachAutoRunTask')}
						clickableRow
					/>
					<p className="text-xs opacity-70">
						{tExtra(
							'settings.extra.notificationsPanel.configureOpenNotificationCenterInShortcutsIt'
						)}
					</p>
					{onConfigureNotificationShortcut && (
						<button
							type="button"
							className="text-xs hover:underline"
							style={{ color: theme.colors.accent }}
							onClick={onConfigureNotificationShortcut}
						>
							{tExtra('settings.extra.notificationsPanel.configureNotificationShortcut')}
							{shortcutSuffix(settings.shortcuts.openNotificationCenter?.keys)}
						</button>
					)}
				</SectionCard>
			</div>

			{/* OS Notifications */}
			<div data-setting-id="notifications-os">
				<SettingCheckbox
					icon={Bell}
					sectionLabel={tExtra('settings.extra.controls.operatingSystemNotifications')}
					title={tExtra('settings.extra.notificationsPanel.enableOsNotifications')}
					description={tExtra(
						'settings.extra.notificationsPanel.showDesktopNotificationsWhenTasksCompleteOr'
					)}
					checked={osNotificationsEnabled}
					onChange={setOsNotificationsEnabled}
					theme={theme}
				/>
				<button
					onClick={() =>
						showOsNotification(
							'Maestro',
							tExtra('settings.extra.notificationsPanel.testNotificationNotificationsAreWorking')
						)
					}
					className="mt-2 px-3 py-1.5 rounded text-xs font-medium transition-all"
					style={{
						backgroundColor: theme.colors.bgActivity,
						color: theme.colors.textMain,
						border: `1px solid ${theme.colors.border}`,
					}}
				>
					{tExtra('settings.extra.notificationsPanel.testNotification')}
				</button>
			</div>

			{/* Custom Notification */}
			<div data-setting-id="notifications-custom">
				<SettingCheckbox
					icon={Volume2}
					sectionLabel={tExtra('settings.extra.controls.customNotification')}
					title={tExtra('settings.extra.notificationsPanel.enableCustomNotification')}
					description={tExtra(
						'settings.extra.controls.executeACustomCommandWhenAiTasksCompleteSuch'
					)}
					checked={audioFeedbackEnabled}
					onChange={setAudioFeedbackEnabled}
					theme={theme}
				/>

				{/* Command Chain Configuration */}
				<div className="mt-3">
					<label className="block text-xs font-medium opacity-70 mb-1">
						{tExtra('settings.extra.notificationsPanel.commandChain')}
					</label>
					<div className="flex gap-2">
						<input
							type="text"
							value={audioFeedbackCommand}
							onChange={(e) => setAudioFeedbackCommand(e.target.value)}
							placeholder="say"
							className="flex-1 p-2 rounded border bg-transparent outline-none text-sm font-mono"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						/>
						{testNotificationId !== null ? (
							<button
								onClick={async () => {
									logger.info(
										'[Notification] Stop test button clicked, id:',
										undefined,
										testNotificationId
									);
									try {
										await window.maestro.notification.stopSpeak(testNotificationId);
									} catch (err) {
										logger.error('[Notification] Stop error:', undefined, err);
									}
									setTestNotificationId(null);
									setTestStatus('idle');
								}}
								className="px-3 py-2 rounded text-xs font-medium transition-all flex items-center gap-1"
								style={{
									backgroundColor: theme.colors.error,
									color: '#fff',
									border: `1px solid ${theme.colors.error}`,
								}}
							>
								<Square className="w-3 h-3" fill="currentColor" />
								{tExtra('settings.extra.notificationsPanel.stop')}
							</button>
						) : (
							<button
								onClick={async () => {
									logger.info(
										'[Notification] Test button clicked, command:',
										undefined,
										audioFeedbackCommand
									);
									setTestStatus('running');
									setTestError(null);
									try {
										const result = await window.maestro.notification.speak(
											tExtra('settings.extra.notificationsPanel.howdyIMMaestroHereToConduct'),
											audioFeedbackCommand
										);
										logger.info('[Notification] Speak result:', undefined, result);
										if (result.success && result.notificationId) {
											setTestNotificationId(result.notificationId);
											// Don't change status to 'success' yet - stay in 'running'
											// and show Stop button while process is active.
											// The onCommandCompleted listener will clear testNotificationId
											// when the process exits, which hides the Stop button.
										} else {
											setTestStatus('error');
											setTestError(
												result.error || tExtra('settings.extra.notificationsPanel.commandFailed')
											);
										}
									} catch (err) {
										logger.error('[Notification] Speak error:', undefined, err);
										setTestStatus('error');
										setTestError(String(err));
									}
								}}
								disabled={testStatus === 'running'}
								className="px-3 py-2 rounded text-xs font-medium transition-all flex items-center gap-1.5 min-w-[70px] justify-center"
								style={{
									backgroundColor:
										testStatus === 'success'
											? theme.colors.success + '20'
											: testStatus === 'error'
												? theme.colors.error + '20'
												: theme.colors.bgActivity,
									color:
										testStatus === 'success'
											? theme.colors.success
											: testStatus === 'error'
												? theme.colors.error
												: theme.colors.textMain,
									border: `1px solid ${
										testStatus === 'success'
											? theme.colors.success
											: testStatus === 'error'
												? theme.colors.error
												: theme.colors.border
									}`,
									opacity: testStatus === 'running' ? 0.7 : 1,
								}}
							>
								{testStatus === 'running' ? (
									<>
										<Spinner size={12} />
										{tExtra('settings.extra.notificationsPanel.running')}
									</>
								) : testStatus === 'success' ? (
									<>
										<Check className="w-3 h-3" />
										{tExtra('settings.extra.notificationsPanel.success')}
									</>
								) : testStatus === 'error' ? (
									<>
										<AlertCircle className="w-3 h-3" />
										{tExtra('settings.extra.notificationsPanel.failed')}
									</>
								) : (
									tExtra('settings.extra.notificationsPanel.test')
								)}
							</button>
						)}
					</div>
					{/* Error message display */}
					{testError && (
						<p
							className="text-xs mt-2 px-2 py-1 rounded"
							style={{
								color: theme.colors.error,
								backgroundColor: theme.colors.error + '10',
							}}
						>
							{testError}
						</p>
					)}
					<p className="text-xs opacity-50 mt-2" style={{ color: theme.colors.textDim }}>
						{tExtra('settings.extra.notificationsPanel.commandThatAcceptsTextViaStdinChain')}{' '}
						<code
							className="px-1 py-0.5 rounded"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							cmd1 | cmd2
						</code>
						{tExtra('settings.extra.notificationsPanel.toMixAndMatchToolsDefaultTts')}{' '}
						<code
							className="px-1 py-0.5 rounded"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							say
						</code>{' '}
						(macOS),{' '}
						<code
							className="px-1 py-0.5 rounded"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							espeak
						</code>{' '}
						(Linux),{' '}
						<code
							className="px-1 py-0.5 rounded"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							festival --tts
						</code>
						{tExtra('settings.extra.notificationsPanel.nonTtsCommands')}{' '}
						<code
							className="px-1 py-0.5 rounded"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							tee ~/log.txt | say
						</code>{' '}
						{tExtra('settings.extra.notificationsPanel.toLogAndSpeakSimultaneously')}
					</p>
				</div>
			</div>

			{/* Idle Notification */}
			<div data-setting-id="notifications-idle">
				<SettingCheckbox
					icon={Coffee}
					sectionLabel={tExtra('settings.extra.controls.idleNotification')}
					title={tExtra('settings.extra.notificationsPanel.enableIdleNotification')}
					description={tExtra(
						'settings.extra.notificationsPanel.executeACustomCommandWhenAllAgents'
					)}
					checked={idleNotificationEnabled}
					onChange={setIdleNotificationEnabled}
					theme={theme}
				/>

				{/* Command Configuration */}
				<div className="mt-3">
					<label className="block text-xs font-medium opacity-70 mb-1">
						{tExtra('settings.extra.notificationsPanel.command')}
					</label>
					<div className="flex gap-2">
						<input
							type="text"
							value={idleNotificationCommand}
							onChange={(e) => setIdleNotificationCommand(e.target.value)}
							placeholder="say Maestro is idle"
							className="flex-1 p-2 rounded border bg-transparent outline-none text-sm font-mono"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						/>
						{idleTestNotificationId !== null ? (
							<button
								onClick={async () => {
									try {
										await window.maestro.notification.stopSpeak(idleTestNotificationId);
									} catch (err) {
										console.error('[IdleNotification] Stop error:', err);
									}
									setIdleTestNotificationId(null);
									setIdleTestStatus('idle');
								}}
								className="px-3 py-2 rounded text-xs font-medium transition-all flex items-center gap-1"
								style={{
									backgroundColor: theme.colors.error,
									color: '#fff',
									border: `1px solid ${theme.colors.error}`,
								}}
							>
								<Square className="w-3 h-3" fill="currentColor" />
								{tExtra('settings.extra.notificationsPanel.stop')}
							</button>
						) : (
							<button
								onClick={async () => {
									setIdleTestStatus('running');
									setIdleTestError(null);
									try {
										const result = await window.maestro.notification.speak(
											'Maestro is idle',
											idleNotificationCommand
										);
										if (result.success && result.notificationId) {
											setIdleTestNotificationId(result.notificationId);
										} else {
											setIdleTestStatus('error');
											setIdleTestError(
												result.error || tExtra('settings.extra.notificationsPanel.commandFailed')
											);
										}
									} catch (err) {
										setIdleTestStatus('error');
										setIdleTestError(String(err));
									}
								}}
								disabled={idleTestStatus === 'running'}
								className="px-3 py-2 rounded text-xs font-medium transition-all flex items-center gap-1.5 min-w-[70px] justify-center"
								style={{
									backgroundColor:
										idleTestStatus === 'success'
											? theme.colors.success + '20'
											: idleTestStatus === 'error'
												? theme.colors.error + '20'
												: theme.colors.bgActivity,
									color:
										idleTestStatus === 'success'
											? theme.colors.success
											: idleTestStatus === 'error'
												? theme.colors.error
												: theme.colors.textMain,
									border: `1px solid ${
										idleTestStatus === 'success'
											? theme.colors.success
											: idleTestStatus === 'error'
												? theme.colors.error
												: theme.colors.border
									}`,
									opacity: idleTestStatus === 'running' ? 0.7 : 1,
								}}
							>
								{idleTestStatus === 'running' ? (
									<>
										<Loader2 className="w-3 h-3 animate-spin" />
										{tExtra('settings.extra.notificationsPanel.running')}
									</>
								) : idleTestStatus === 'success' ? (
									<>
										<Check className="w-3 h-3" />
										{tExtra('settings.extra.notificationsPanel.success')}
									</>
								) : idleTestStatus === 'error' ? (
									<>
										<AlertCircle className="w-3 h-3" />
										{tExtra('settings.extra.notificationsPanel.failed')}
									</>
								) : (
									tExtra('settings.extra.notificationsPanel.test')
								)}
							</button>
						)}
					</div>
					{idleTestError && (
						<p
							className="text-xs mt-2 px-2 py-1 rounded"
							style={{
								color: theme.colors.error,
								backgroundColor: theme.colors.error + '10',
							}}
						>
							{idleTestError}
						</p>
					)}
					<p className="text-xs opacity-50 mt-2" style={{ color: theme.colors.textDim }}>
						{tExtra('settings.extra.notificationsPanel.runsWhenAllAgentsFinishAndNo')}
					</p>
				</div>
			</div>

			{/* Toast Duration */}
			<div data-setting-id="notifications-toast">
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Clock className="w-3 h-3" />
					{tExtra('settings.extra.notificationsPanel.toastNotificationDuration')}
				</label>
				<ToggleButtonGroup
					options={[
						{ value: -1, label: tExtra('settings.extra.notificationsPanel.off') },
						{ value: 5, label: '5s' },
						{ value: 10, label: '10s' },
						{ value: 20, label: '20s' },
						{ value: 30, label: '30s' },
						{ value: 0, label: tExtra('settings.extra.notificationsPanel.never') },
					]}
					value={toastDuration}
					onChange={setToastDuration}
					theme={theme}
				/>
				<p className="text-xs opacity-50 mt-2">
					{tExtra('settings.extra.notificationsPanel.howLongToastNotificationsRemainOnScreen')}
				</p>
			</div>

			<div data-setting-id="notifications-toast-position">
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<LayoutGrid className="w-3 h-3" />
					{tExtra('settings.extra.notificationsPanel.toastNotificationPosition')}
				</label>
				<ToggleButtonGroup
					options={TOAST_POSITIONS.map((position) => ({
						value: position,
						label: tExtra(`settings.extra.notificationsPanel.position.${position}`),
					}))}
					value={toastPosition}
					onChange={setToastPosition}
					theme={theme}
				/>
				<p className="text-xs opacity-50 mt-2">
					{tExtra('settings.extra.notificationsPanel.whichCornerToastNotificationsAppearInBottom')}
				</p>
			</div>

			<div data-setting-id="notifications-toast-width">
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Bell className="w-3 h-3" />
					{tExtra('settings.extra.notificationsPanel.toastNotificationWidth')}
				</label>
				<ToggleButtonGroup
					options={TOAST_WIDTHS.map((width) => ({
						value: width,
						label: tExtra(`settings.extra.notificationsPanel.width.${width}`),
					}))}
					value={toastWidth}
					onChange={setToastWidth}
					theme={theme}
				/>
				<p className="text-xs opacity-50 mt-2">
					{tExtra('settings.extra.notificationsPanel.howWideToastNotificationsRenderInThe')}
				</p>
			</div>

			{/* Info about when notifications are triggered */}
			<div
				className="p-3 rounded-lg"
				style={{
					backgroundColor: theme.colors.bgActivity,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				<div className="text-xs font-medium mb-2" style={{ color: theme.colors.textMain }}>
					{tExtra('settings.extra.notificationsPanel.whenAreNotificationsTriggered')}
				</div>
				<ul className="text-xs opacity-70 space-y-1" style={{ color: theme.colors.textDim }}>
					<li>
						{tExtra('settings.extra.notificationsPanel.whenAnAiTaskCompletesCustomNotification')}
					</li>
					<li>{tExtra('settings.extra.notificationsPanel.whenAllAgentsAndAutoRunsFinish')}</li>
				</ul>
				<div
					className="text-xs opacity-60 mt-3 pt-3"
					style={{ color: theme.colors.textDim, borderTop: `1px solid ${theme.colors.border}` }}
				>
					<strong>{tExtra('settings.extra.notificationsPanel.tip')}</strong>{' '}
					{tExtra('settings.extra.notificationsPanel.tipBody')}
				</div>
			</div>
		</div>
	);
}
