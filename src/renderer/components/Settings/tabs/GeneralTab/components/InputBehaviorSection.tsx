import { AlertTriangle, Keyboard } from 'lucide-react';
import type { Theme } from '../../../../../types';
import {
	formatEnterToSend,
	formatMetaKey,
	formatShortcutKeys,
} from '../../../../../utils/shortcutFormatter';
import { ForcedParallelWarningModal } from '../../../../ForcedParallelWarningModal';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import { ToggleSwitch } from '../../../../ui/ToggleSwitch';
import type { ForcedParallelWarningState, GeneralTabSettings } from '../types';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useI18n } from '../../../../../i18n';

interface InputBehaviorSectionProps {
	theme: Theme;
	enterToSendAI: boolean;
	setEnterToSendAI: (enabled: boolean) => void;
	enterToSendAIExpanded: boolean;
	setEnterToSendAIExpanded: (enabled: boolean) => void;
	forcedParallelExecution: boolean;
	forcedParallelAlways: boolean;
	setForcedParallelAlways: (enabled: boolean) => void;
	shortcuts: GeneralTabSettings['shortcuts'];
	forcedParallelWarning: ForcedParallelWarningState;
}

export function InputBehaviorSection({
	theme,
	enterToSendAI,
	setEnterToSendAI,
	enterToSendAIExpanded,
	setEnterToSendAIExpanded,
	forcedParallelExecution,
	forcedParallelAlways,
	setForcedParallelAlways,
	shortcuts,
	forcedParallelWarning,
}: InputBehaviorSectionProps) {
	const { t, tRich } = useI18n();
	const meta = formatMetaKey();
	const forcedParallelShortcut = shortcuts?.forcedParallelSend
		? formatShortcutKeys(shortcuts.forcedParallelSend.keys)
		: formatShortcutKeys(['Meta', 'Shift', 'Enter']);

	// "Always" mode makes every send a force-send, so the modifier shortcut is
	// redundant - we ghost it out to signal that.
	const alwaysMode = forcedParallelExecution && forcedParallelAlways;

	return (
		<div data-setting-id="general-input-behavior">
			<SettingsSectionHeading icon={Keyboard}>
				{t('settings.general.input.heading')}
			</SettingsSectionHeading>
			<p className="text-xs opacity-70 mb-3">{t('settings.general.input.description', { meta })}</p>

			<div
				className="mb-4 p-3 rounded border"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div className="flex items-center justify-between mb-2">
					<div className="text-sm font-medium">{t('settings.general.input.aiMode')}</div>
					<button
						onClick={() => setEnterToSendAI(!enterToSendAI)}
						className="px-3 py-1.5 rounded text-xs font-mono transition-all"
						style={{
							backgroundColor: enterToSendAI ? theme.colors.accentDim : theme.colors.bgActivity,
							color: theme.colors.textMain,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						{formatEnterToSend(enterToSendAI)}
					</button>
				</div>
				<p className="text-xs opacity-70">
					{enterToSendAI
						? t('settings.general.input.enterSends')
						: t('settings.general.input.metaEnterSends', { meta })}
				</p>
				<p className="text-xs-plus opacity-55 mt-1">{t('settings.general.input.tabOverride')}</p>
			</div>

			<div
				className="mb-4 p-3 rounded border"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div className="flex items-center justify-between mb-2">
					<div className="text-sm font-medium">{t('settings.general.input.expandedMode')}</div>
					<button
						onClick={() => setEnterToSendAIExpanded(!enterToSendAIExpanded)}
						className="px-3 py-1.5 rounded text-xs font-mono transition-all"
						style={{
							backgroundColor: enterToSendAIExpanded
								? theme.colors.accentDim
								: theme.colors.bgActivity,
							color: theme.colors.textMain,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						{formatEnterToSend(enterToSendAIExpanded)}
					</button>
				</div>
				<p className="text-xs opacity-70">
					{enterToSendAIExpanded
						? t('settings.general.input.expandedEnterSends')
						: t('settings.general.input.expandedMetaEnterSends', { meta })}
				</p>
			</div>

			<div
				data-setting-id="general-forced-parallel"
				className="mt-4 p-3 rounded border"
				style={{
					borderColor: theme.colors.border,
					backgroundColor: theme.colors.bgMain,
					opacity: forcedParallelExecution ? 1 : 0.7,
				}}
			>
				<div className="flex items-center justify-between mb-2">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('settings.general.input.forcedParallel')}
					</div>
					<div className="flex items-center gap-2">
						<span
							className="px-2 py-0.5 rounded text-xs font-mono"
							style={{
								backgroundColor: theme.colors.bgActivity,
								color: theme.colors.textMain,
								opacity: !forcedParallelExecution || alwaysMode ? 0.35 : 1,
								textDecoration: alwaysMode ? 'line-through' : 'none',
							}}
							title={alwaysMode ? t('settings.general.input.alwaysNotNeeded') : undefined}
						>
							{forcedParallelShortcut}
						</span>
						<ToggleSwitch
							checked={forcedParallelExecution}
							onChange={forcedParallelWarning.handleToggle}
							theme={theme}
							ariaLabel={t('settings.general.input.forcedParallel')}
						/>
					</div>
				</div>
				<div
					className="flex items-start gap-1.5 text-xs"
					style={{
						color: theme.colors.warning,
						opacity: forcedParallelExecution ? 1 : 0.5,
					}}
				>
					<AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
					<span>
						{alwaysMode
							? tRich('settings.general.input.alwaysWarning', {
									lead: <strong>{t('settings.general.input.alwaysWarningLead')}</strong>,
								})
							: tRich('settings.general.input.modifierWarning', {
									shortcut: <strong>{forcedParallelShortcut}</strong>,
								})}
					</span>
				</div>

				{forcedParallelExecution && (
					<div className="mt-3">
						<div className="font-medium mb-2" style={{ color: theme.colors.textMain }}>
							{t('settings.general.input.sendTrigger')}
						</div>
						<ToggleButtonGroup
							options={[
								{ value: 'modifier' as const, label: t('settings.general.input.modifier') },
								{ value: 'always' as const, label: t('settings.general.input.always') },
							]}
							value={forcedParallelAlways ? 'always' : 'modifier'}
							onChange={(value) => setForcedParallelAlways(value === 'always')}
							theme={theme}
						/>
						<p className="text-xs opacity-70 mt-2">
							{forcedParallelAlways
								? t('settings.general.input.alwaysHelp')
								: t('settings.general.input.modifierHelp', { shortcut: forcedParallelShortcut })}
						</p>
					</div>
				)}
			</div>

			<ForcedParallelWarningModal
				isOpen={forcedParallelWarning.showWarning}
				onConfirm={forcedParallelWarning.handleConfirm}
				onCancel={forcedParallelWarning.handleCancel}
				theme={theme}
			/>
		</div>
	);
}
