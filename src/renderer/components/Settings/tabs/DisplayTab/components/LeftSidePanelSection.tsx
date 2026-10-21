import { PanelLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Theme } from '../../../../../types';
import { useI18n } from '../../../../../i18n';
import { WorktreePill } from '../../../../ui/WorktreePill';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface LeftSidePanelSectionProps {
	theme: Theme;
	maestroCueEnabled: boolean;
	showStarredSessionsSection: boolean;
	setShowStarredSessionsSection: (enabled: boolean) => void;
	showLeftPanelGroupMemberCount: boolean;
	setShowLeftPanelGroupMemberCount: (enabled: boolean) => void;
	showLeftPanelCollapsedInitials: boolean;
	setShowLeftPanelCollapsedInitials: (enabled: boolean) => void;
	leftPanelCollapsedPillsPerRow: number;
	setLeftPanelCollapsedPillsPerRow: (value: number) => void;
	showLeftPanelLocationPills: boolean;
	setShowLeftPanelLocationPills: (enabled: boolean) => void;
	showLeftPanelGitIndicator: boolean;
	setShowLeftPanelGitIndicator: (enabled: boolean) => void;
	showLeftPanelCueIndicator: boolean;
	setShowLeftPanelCueIndicator: (enabled: boolean) => void;
	showLeftPanelStartupCommandIndicator: boolean;
	setShowLeftPanelStartupCommandIndicator: (enabled: boolean) => void;
	showGroupLabelInBookmarks: boolean;
	setShowGroupLabelInBookmarks: (enabled: boolean) => void;
	showFullGroupLabelInBookmarks: boolean;
	setShowFullGroupLabelInBookmarks: (enabled: boolean) => void;
	showWorktreePill: boolean;
	setShowWorktreePill: (enabled: boolean) => void;
	showWorktreeBranchName: boolean;
	setShowWorktreeBranchName: (enabled: boolean) => void;
}

function MonoExample({ children }: { children: ReactNode }) {
	return <span className="font-mono">{children}</span>;
}

export function LeftSidePanelSection({
	theme,
	maestroCueEnabled,
	showStarredSessionsSection,
	setShowStarredSessionsSection,
	showLeftPanelGroupMemberCount,
	setShowLeftPanelGroupMemberCount,
	showLeftPanelCollapsedInitials,
	setShowLeftPanelCollapsedInitials,
	leftPanelCollapsedPillsPerRow,
	setLeftPanelCollapsedPillsPerRow,
	showLeftPanelLocationPills,
	setShowLeftPanelLocationPills,
	showLeftPanelGitIndicator,
	setShowLeftPanelGitIndicator,
	showLeftPanelCueIndicator,
	setShowLeftPanelCueIndicator,
	showLeftPanelStartupCommandIndicator,
	setShowLeftPanelStartupCommandIndicator,
	showGroupLabelInBookmarks,
	setShowGroupLabelInBookmarks,
	showFullGroupLabelInBookmarks,
	setShowFullGroupLabelInBookmarks,
	showWorktreePill,
	setShowWorktreePill,
	showWorktreeBranchName,
	setShowWorktreeBranchName,
}: LeftSidePanelSectionProps) {
	const { t, tRich } = useI18n();
	const pillPercentage = ((leftPanelCollapsedPillsPerRow - 5) / 45) * 100;

	return (
		<div data-setting-id="display-left-side-panel">
			<SettingsSectionHeading icon={PanelLeft}>
				{t('settings.display.left.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<div data-setting-id="display-left-panel-starred-sessions">
					<ToggleSettingRow
						theme={theme}
						title={t('settings.display.left.starred')}
						description={t('settings.display.left.starredDescription')}
						checked={showStarredSessionsSection}
						onChange={setShowStarredSessionsSection}
						ariaLabel={t('settings.display.left.starredAria')}
					/>
				</div>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.left.memberCount')}
					description={t('settings.display.left.memberCountDescription')}
					checked={showLeftPanelGroupMemberCount}
					onChange={setShowLeftPanelGroupMemberCount}
					ariaLabel={t('settings.display.left.memberCountAria')}
					borderTop
				/>
				<div data-setting-id="display-left-panel-collapsed-initials">
					<ToggleSettingRow
						theme={theme}
						title={t('settings.display.left.initials')}
						description={tRich('settings.display.left.initialsDescription', {
							example: <MonoExample>MR</MonoExample>,
						})}
						checked={showLeftPanelCollapsedInitials}
						onChange={setShowLeftPanelCollapsedInitials}
						ariaLabel={t('settings.display.left.initialsAria')}
						borderTop
					/>
				</div>

				<div className="pt-3 border-t" style={{ borderColor: theme.colors.border }}>
					<p className="text-sm" style={{ color: theme.colors.textMain }}>
						{t('settings.display.left.pillsPerRow')}
					</p>
					<p className="text-xs opacity-70 mt-0.5 mb-2">
						{t('settings.display.left.pillsPerRowDescription')}
					</p>
					<div className="flex items-center gap-3">
						<input
							type="range"
							min={5}
							max={50}
							step={5}
							value={leftPanelCollapsedPillsPerRow}
							onChange={(event) => setLeftPanelCollapsedPillsPerRow(Number(event.target.value))}
							className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, ${theme.colors.accent} 0%, ${theme.colors.accent} ${pillPercentage}%, ${theme.colors.bgActivity} ${pillPercentage}%, ${theme.colors.bgActivity} 100%)`,
							}}
							aria-label={t('settings.display.left.pillsPerRow')}
						/>
						<span
							className="text-sm font-mono w-8 text-right"
							style={{ color: theme.colors.textMain }}
						>
							{leftPanelCollapsedPillsPerRow}
						</span>
					</div>
				</div>

				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.left.locationPills')}
					description={t('settings.display.left.locationPillsDescription')}
					checked={showLeftPanelLocationPills}
					onChange={setShowLeftPanelLocationPills}
					ariaLabel={t('settings.display.left.locationPillsAria')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.left.git')}
					description={t('settings.display.left.gitDescription')}
					checked={showLeftPanelGitIndicator}
					onChange={setShowLeftPanelGitIndicator}
					ariaLabel={t('settings.display.left.gitAria')}
					borderTop
				/>
				{maestroCueEnabled && (
					<ToggleSettingRow
						theme={theme}
						title={t('settings.display.left.cue')}
						description={t('settings.display.left.cueDescription')}
						checked={showLeftPanelCueIndicator}
						onChange={setShowLeftPanelCueIndicator}
						ariaLabel={t('settings.display.left.cueAria')}
						borderTop
					/>
				)}
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.left.startup')}
					description={tRich('settings.display.left.startupDescription', {
						glyph: <MonoExample>{'>_'}</MonoExample>,
					})}
					checked={showLeftPanelStartupCommandIndicator}
					onChange={setShowLeftPanelStartupCommandIndicator}
					ariaLabel={t('settings.display.left.startupAria')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.left.groupLabel')}
					description={tRich('settings.display.left.groupLabelDescription', {
						example: <MonoExample>CCS</MonoExample>,
					})}
					checked={showGroupLabelInBookmarks}
					onChange={setShowGroupLabelInBookmarks}
					ariaLabel={t('settings.display.left.groupLabelAria')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.left.fullGroupLabel')}
					description={tRich('settings.display.left.fullGroupLabelDescription', {
						full: <MonoExample>[2] CASE/CONTENT-SYSTEM</MonoExample>,
						short: <MonoExample>CCS</MonoExample>,
					})}
					checked={showFullGroupLabelInBookmarks}
					onChange={setShowFullGroupLabelInBookmarks}
					ariaLabel={t('settings.display.left.fullGroupLabelAria')}
					disabled={!showGroupLabelInBookmarks}
					className={`pt-2 pl-4 transition-opacity ${
						showGroupLabelInBookmarks ? '' : 'opacity-40'
					}`}
				/>
				<ToggleSettingRow
					theme={theme}
					title={
						<span className="flex items-center gap-2">
							{tRich('settings.display.left.worktreePill', {
								pill: <WorktreePill theme={theme} />,
							})}
						</span>
					}
					description={t('settings.display.left.worktreePillDescription')}
					checked={showWorktreePill}
					onChange={setShowWorktreePill}
					ariaLabel={t('settings.display.left.worktreePillAria')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.left.branchName')}
					description={t('settings.display.left.branchNameDescription')}
					checked={showWorktreeBranchName}
					onChange={setShowWorktreeBranchName}
					ariaLabel={t('settings.display.left.branchNameAria')}
					borderTop
				/>
			</SectionCard>
		</div>
	);
}
