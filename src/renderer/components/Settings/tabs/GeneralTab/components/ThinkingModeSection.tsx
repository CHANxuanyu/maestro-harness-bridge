import { Brain } from 'lucide-react';
import type { Theme, ThinkingMode } from '../../../../../types';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import { ToggleSwitch } from '../../../../ui/ToggleSwitch';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface ThinkingModeSectionProps {
	theme: Theme;
	defaultShowThinking: ThinkingMode;
	setDefaultShowThinking: (mode: ThinkingMode) => void;
	showToolCalls: boolean;
	setShowToolCalls: (enabled: boolean) => void;
}

export function ThinkingModeSection({
	theme,
	defaultShowThinking,
	setDefaultShowThinking,
	showToolCalls,
	setShowToolCalls,
}: ThinkingModeSectionProps) {
	const t = useT();
	// Tool-call visibility is independent of the thinking mode. The two settings
	// live under one heading because they both shape how much of the agent's work
	// the transcript shows, but neither gates the other: thinking On with tools
	// hidden gives a pure reasoning chain, and tools On with thinking Off gives a
	// pure activity log.
	return (
		<div data-setting-id="general-thinking-mode">
			<SettingsSectionHeading icon={Brain}>
				{t('settings.general.thinking.heading')}
			</SettingsSectionHeading>
			<div
				className="mb-4 p-3 rounded border"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div className="font-medium mb-1" style={{ color: theme.colors.textMain }}>
					{t('settings.general.thinking.title')}
				</div>
				<div className="text-sm opacity-70 mb-3">
					{defaultShowThinking === 'off' && t('settings.general.thinking.offState')}
					{defaultShowThinking === 'on' && t('settings.general.thinking.onState')}
					{defaultShowThinking === 'sticky' && t('settings.general.thinking.stickyState')}
				</div>
				<ToggleButtonGroup
					options={[
						{ value: 'off' as const, label: t('common.off') },
						{ value: 'on' as const, label: t('common.on') },
						{ value: 'sticky' as const, label: t('settings.general.thinking.sticky') },
					]}
					value={defaultShowThinking}
					onChange={setDefaultShowThinking}
					theme={theme}
				/>
			</div>

			<div
				data-setting-id="general-tool-calls"
				className="p-3 rounded border"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div
					className="flex items-center justify-between cursor-pointer"
					onClick={() => setShowToolCalls(!showToolCalls)}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => {
						// Only activate from the row itself. The nested ToggleSwitch handles
						// its own keyboard events, so ignoring descendant keydowns keeps a
						// focused switch from toggling twice (row handler + native click).
						if (e.target !== e.currentTarget) return;
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setShowToolCalls(!showToolCalls);
						}
					}}
				>
					<div className="flex-1 pr-3">
						<div className="font-medium" style={{ color: theme.colors.textMain }}>
							{t('settings.general.thinking.toolCalls')}
						</div>
						<div className="text-xs opacity-70 mt-0.5">
							{t('settings.general.thinking.toolCallsDescription')}
						</div>
					</div>
					<ToggleSwitch
						checked={showToolCalls}
						onChange={setShowToolCalls}
						theme={theme}
						ariaLabel={t('settings.general.thinking.toolCalls')}
					/>
				</div>
			</div>
		</div>
	);
}
