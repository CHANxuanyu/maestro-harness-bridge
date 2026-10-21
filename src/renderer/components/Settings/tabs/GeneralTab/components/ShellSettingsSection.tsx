import type { CSSProperties } from 'react';
import { Check, ChevronDown, Terminal } from 'lucide-react';
import type { Theme } from '../../../../../types';
import type { ShellSettingsState } from '../types';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface ShellSettingsSectionProps {
	theme: Theme;
	defaultShell: string;
	setCustomShellPath: (path: string) => void;
	customShellPath: string;
	setShellArgs: (args: string) => void;
	shellArgs: string;
	shellState: ShellSettingsState;
}

export function ShellSettingsSection({
	theme,
	defaultShell,
	setCustomShellPath,
	customShellPath,
	setShellArgs,
	shellArgs,
	shellState,
}: ShellSettingsSectionProps) {
	const {
		shells,
		shellsLoading,
		shellsLoaded,
		shellConfigExpanded,
		setShellConfigExpanded,
		handleShellInteraction,
		selectShell,
	} = shellState;
	const t = useT();

	return (
		<div data-setting-id="general-default-shell">
			<SettingsSectionHeading icon={Terminal}>
				{t('settings.general.shell.heading')}
			</SettingsSectionHeading>
			<p className="text-xs opacity-70 mb-2">{t('settings.general.shell.description')}</p>
			{shellsLoading ? (
				<div className="text-sm opacity-70 p-2">{t('settings.general.shell.loading')}</div>
			) : (
				<div className="space-y-2">
					{shellsLoaded && shells.length > 0 ? (
						shells.map((shell) => (
							<button
								key={shell.id}
								onClick={() => selectShell(shell)}
								onMouseEnter={handleShellInteraction}
								onFocus={handleShellInteraction}
								className={`w-full text-left p-3 rounded border transition-all ${
									defaultShell === shell.id ? 'ring-2' : ''
								} row-hover`}
								style={
									{
										borderColor: theme.colors.border,
										backgroundColor:
											defaultShell === shell.id ? theme.colors.accentDim : theme.colors.bgMain,
										'--tw-ring-color': theme.colors.accent,
										color: theme.colors.textMain,
									} as CSSProperties
								}
							>
								<div className="flex items-center justify-between">
									<div>
										<div className="font-medium">{shell.name}</div>
										{shell.path && (
											<div className="text-xs opacity-70 font-mono mt-1">{shell.path}</div>
										)}
									</div>
									{shell.available ? (
										defaultShell === shell.id ? (
											<Check className="w-4 h-4" style={{ color: theme.colors.accent }} />
										) : (
											<span
												className="text-xs px-2 py-0.5 rounded"
												style={{
													backgroundColor: theme.colors.success + '20',
													color: theme.colors.success,
												}}
											>
												{t('settings.general.shell.available')}
											</span>
										)
									) : defaultShell === shell.id ? (
										<div className="flex items-center gap-2">
											<span
												className="text-xs px-2 py-0.5 rounded"
												style={{
													backgroundColor: theme.colors.warning + '20',
													color: theme.colors.warning,
												}}
											>
												{t('settings.general.shell.customPathRequired')}
											</span>
											<Check className="w-4 h-4" style={{ color: theme.colors.accent }} />
										</div>
									) : (
										<span
											className="text-xs px-2 py-0.5 rounded"
											style={{
												backgroundColor: theme.colors.warning + '20',
												color: theme.colors.warning,
											}}
										>
											{t('settings.general.shell.notFound')}
										</span>
									)}
								</div>
							</button>
						))
					) : (
						<div className="space-y-2">
							<button
								className="w-full text-left p-3 rounded border ring-2"
								style={
									{
										borderColor: theme.colors.border,
										backgroundColor: theme.colors.accentDim,
										'--tw-ring-color': theme.colors.accent,
										color: theme.colors.textMain,
									} as CSSProperties
								}
							>
								<div className="flex items-center justify-between">
									<div>
										<div className="font-medium">
											{defaultShell.charAt(0).toUpperCase() + defaultShell.slice(1)}
										</div>
										<div className="text-xs opacity-70 font-mono mt-1">
											{t('settings.general.shell.currentDefault')}
										</div>
									</div>
									<Check className="w-4 h-4" style={{ color: theme.colors.accent }} />
								</div>
							</button>
							<button
								onClick={handleShellInteraction}
								className="w-full text-left p-3 rounded border hover:bg-white/5 transition-colors"
								style={{
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.bgMain,
									color: theme.colors.textDim,
								}}
							>
								<div className="flex items-center gap-2">
									<Terminal className="w-4 h-4" />
									<span>{t('settings.general.shell.detectOthers')}</span>
								</div>
							</button>
						</div>
					)}
				</div>
			)}

			<button
				onClick={() => setShellConfigExpanded(!shellConfigExpanded)}
				className="w-full flex items-center justify-between p-3 rounded border mt-3 hover:bg-white/5 transition-colors"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					{t('settings.general.shell.config')}
				</span>
				<ChevronDown
					className={`w-4 h-4 transition-transform ${shellConfigExpanded ? 'rotate-180' : ''}`}
					style={{ color: theme.colors.textDim }}
				/>
			</button>

			{shellConfigExpanded && (
				<div
					className="mt-2 space-y-3 p-3 rounded border"
					style={{
						borderColor: theme.colors.border,
						backgroundColor: theme.colors.bgMain,
					}}
				>
					<div>
						<div className="block text-xs opacity-70 mb-1">
							{t('settings.general.customPathOptional')}
						</div>
						<div className="flex gap-2">
							<input
								type="text"
								value={customShellPath}
								onChange={(e) => setCustomShellPath(e.target.value)}
								placeholder="/path/to/shell"
								className="flex-1 p-2 rounded border bg-transparent outline-none text-sm font-mono"
								style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
							/>
							{customShellPath && (
								<button
									onClick={() => setCustomShellPath('')}
									className="px-2 py-1.5 rounded text-xs"
									style={{
										backgroundColor: theme.colors.bgMain,
										color: theme.colors.textDim,
									}}
								>
									{t('common.clear')}
								</button>
							)}
						</div>
						<p className="text-xs opacity-70 mt-1">{t('settings.general.shell.customPathHelp')}</p>
					</div>

					<div>
						<div className="block text-xs opacity-70 mb-1">
							{t('settings.general.shell.argsLabel')}
						</div>
						<div className="flex gap-2">
							<input
								type="text"
								value={shellArgs}
								onChange={(e) => setShellArgs(e.target.value)}
								placeholder="--flag value"
								className="flex-1 p-2 rounded border bg-transparent outline-none text-sm font-mono"
								style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
							/>
							{shellArgs && (
								<button
									onClick={() => setShellArgs('')}
									className="px-2 py-1.5 rounded text-xs"
									style={{
										backgroundColor: theme.colors.bgMain,
										color: theme.colors.textDim,
									}}
								>
									{t('common.clear')}
								</button>
							)}
						</div>
						<p className="text-xs opacity-70 mt-1">{t('settings.general.shell.argsHelp')}</p>
					</div>
				</div>
			)}
		</div>
	);
}
