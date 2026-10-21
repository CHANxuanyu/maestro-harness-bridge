import { Terminal } from 'lucide-react';
import type { Theme } from '../../../../../types';
import type { MaestroCliState } from '../types';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useI18n } from '../../../../../i18n';

interface MaestroCliSectionProps {
	theme: Theme;
	appVersion: string;
	maestroCli: MaestroCliState;
}

export function MaestroCliSection({ theme, appVersion, maestroCli }: MaestroCliSectionProps) {
	const {
		status,
		statusError,
		checking,
		installing,
		installMessage,
		checkStatus,
		installOrUpdate,
	} = maestroCli;
	const { t, tRich } = useI18n();

	return (
		<div data-setting-id="general-maestro-cli">
			<SettingsSectionHeading icon={Terminal}>Maestro CLI</SettingsSectionHeading>
			<div
				className="p-3 rounded border space-y-2"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div className="text-xs opacity-70">
					{tRich('settings.general.cli.description', {
						command: <code>maestro-cli</code>,
						version: status?.expectedVersion || appVersion,
					})}
				</div>

				{status && !checking && (
					<div className="text-xs space-y-1">
						<div>
							<span style={{ color: theme.colors.textDim }}>
								{t('settings.general.cli.pathLabel')}
							</span>{' '}
							<span
								style={{
									color:
										status.inPath || status.inShellPath
											? theme.colors.success
											: theme.colors.warning,
								}}
							>
								{status.inPath
									? t('settings.general.cli.detected')
									: status.inShellPath
										? t('settings.general.cli.detectedShell')
										: t('settings.general.cli.notDetected')}
							</span>
						</div>
						<div>
							<span style={{ color: theme.colors.textDim }}>
								{t('settings.general.cli.installedVersion')}
							</span>{' '}
							<span style={{ color: theme.colors.textMain }}>
								{status.installedVersion || t('settings.general.cli.notInstalled')}
							</span>
						</div>
						<div>
							<span style={{ color: theme.colors.textDim }}>
								{t('settings.general.cli.expectedVersion')}
							</span>{' '}
							<span style={{ color: theme.colors.textMain }}>{status.expectedVersion}</span>
						</div>
						{status.commandPath && (
							<div className="break-all">
								<span style={{ color: theme.colors.textDim }}>
									{t('settings.general.cli.commandPath')}
								</span>{' '}
								<code>{status.commandPath}</code>
							</div>
						)}
						{status.needsInstallOrUpdate && (
							<div style={{ color: theme.colors.warning }}>
								{t('settings.general.cli.mismatch')}
							</div>
						)}
					</div>
				)}

				<div
					role={statusError ? 'alert' : 'status'}
					aria-live={statusError ? 'assertive' : 'polite'}
					aria-atomic="true"
					className="text-xs space-y-1"
				>
					{checking && <div className="opacity-70">{t('settings.general.cli.checkingStatus')}</div>}
					{statusError && <div style={{ color: theme.colors.warning }}>{statusError}</div>}
					{installMessage && (
						<div
							style={{
								color: installMessage.ok ? theme.colors.success : theme.colors.warning,
							}}
						>
							{installMessage.text}
						</div>
					)}
				</div>

				<div className="flex gap-2">
					<button
						onClick={() => void checkStatus()}
						disabled={checking || installing}
						className="px-2 py-1 rounded text-xs"
						style={{
							backgroundColor: theme.colors.bgActivity,
							color: theme.colors.textMain,
							opacity: checking || installing ? 0.6 : 1,
						}}
					>
						{checking ? t('settings.general.cli.checking') : t('settings.general.cli.checkNow')}
					</button>
					<button
						onClick={() => void installOrUpdate()}
						disabled={checking || installing}
						className="px-2 py-1 rounded text-xs"
						style={{
							backgroundColor: theme.colors.accentDim,
							color: theme.colors.textMain,
							opacity: checking || installing ? 0.6 : 1,
						}}
					>
						{installing
							? t('settings.general.cli.installing')
							: status?.needsInstallOrUpdate
								? t('settings.general.cli.installUpdate')
								: t('settings.general.cli.reinstall')}
					</button>
				</div>
				<div className="text-xs-plus opacity-55">
					{tRich('settings.general.cli.installTarget', {
						path: <code>{status?.installDir || '~/.local/bin'}</code>,
					})}
				</div>
			</div>
		</div>
	);
}
