import { Check, Cloud, ExternalLink, Folder, FolderSync, RotateCcw, X } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { localizedFileManagerName } from '../../../../../i18n/platformLabels';
import type { SyncStorageState } from '../types';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface StorageLocationSectionProps {
	theme: Theme;
	syncStorage: SyncStorageState;
}

export function StorageLocationSection({ theme, syncStorage }: StorageLocationSectionProps) {
	const {
		defaultStoragePath,
		customSyncPath,
		syncRestartRequired,
		syncMigrating,
		syncError,
		syncMigratedCount,
		chooseSyncFolder,
		resetToDefault,
		openStorageFolder,
	} = syncStorage;
	const t = useT();

	return (
		<div data-setting-id="general-storage">
			<SettingsSectionHeading icon={FolderSync}>
				{t('settings.general.storage.heading')}
			</SettingsSectionHeading>
			<div
				className="p-3 rounded border space-y-3"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div>
					<p className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
						{t('settings.general.storage.folder')}
					</p>
					<p className="text-xs opacity-70 mt-0.5">{t('settings.general.storage.description')}</p>
					<p className="text-xs opacity-70 mt-1 italic">{t('settings.general.storage.note')}</p>
				</div>

				<div>
					<div className="block text-xs opacity-70 mb-1">
						{t('settings.general.storage.defaultLocation')}
					</div>
					<div
						className="text-xs p-2 rounded font-mono truncate"
						style={{ backgroundColor: theme.colors.bgActivity }}
						title={defaultStoragePath}
					>
						{defaultStoragePath || t('common.loading')}
					</div>
				</div>

				{customSyncPath && (
					<div>
						<div className="block text-xs opacity-70 mb-1">
							{t('settings.general.storage.currentCustom')}
						</div>
						<div
							className="text-xs p-2 rounded font-mono truncate flex items-center gap-2"
							style={{
								backgroundColor: theme.colors.accent + '15',
								border: `1px solid ${theme.colors.accent}40`,
							}}
							title={customSyncPath}
						>
							<Cloud className="w-3 h-3 flex-shrink-0" style={{ color: theme.colors.accent }} />
							<span className="truncate">{customSyncPath}</span>
						</div>
					</div>
				)}

				<div className="flex items-center gap-2 flex-wrap">
					<button
						onClick={() => void chooseSyncFolder()}
						disabled={syncMigrating}
						className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.bgMain,
						}}
					>
						<Folder className="w-3 h-3" />
						{syncMigrating
							? t('settings.general.storage.migrating')
							: customSyncPath
								? t('settings.general.storage.changeFolder')
								: t('settings.general.storage.chooseFolder')}
					</button>

					{customSyncPath && (
						<button
							onClick={() => void resetToDefault()}
							disabled={syncMigrating}
							className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
							style={{
								backgroundColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
							title={t('settings.general.storage.resetTitle')}
						>
							<RotateCcw className="w-3 h-3" />
							{t('settings.general.storage.useDefault')}
						</button>
					)}
				</div>

				{syncMigratedCount !== null && syncMigratedCount > 0 && !syncError && (
					<div
						className="p-2 rounded text-xs flex items-center gap-2"
						style={{
							backgroundColor: theme.colors.success + '20',
							color: theme.colors.success,
						}}
					>
						<Check className="w-3 h-3" />
						{t(
							syncMigratedCount === 1
								? 'settings.general.storage.migratedOne'
								: 'settings.general.storage.migratedMany',
							{ count: syncMigratedCount }
						)}
					</div>
				)}

				{syncError && (
					<div
						className="p-2 rounded text-xs flex items-start gap-2"
						style={{
							backgroundColor: theme.colors.error + '20',
							color: theme.colors.error,
						}}
					>
						<X className="w-3 h-3 flex-shrink-0 mt-0.5" />
						<span>{syncError}</span>
					</div>
				)}

				{syncRestartRequired && !syncError && (
					<div
						className="p-2 rounded text-xs flex items-center gap-2"
						style={{
							backgroundColor: theme.colors.warning + '20',
							color: theme.colors.warning,
						}}
					>
						<RotateCcw className="w-3 h-3" />
						{t('settings.general.storage.restart')}
					</div>
				)}

				<div className="flex justify-end">
					<button
						onClick={openStorageFolder}
						disabled={!defaultStoragePath && !customSyncPath}
						className="flex items-center gap-1.5 text-xs-plus opacity-55 hover:opacity-100 transition-opacity disabled:opacity-30"
						style={{ color: theme.colors.textMain }}
						title={customSyncPath || defaultStoragePath}
					>
						<ExternalLink className="w-3 h-3" />
						{t('common.openInFileManager', {
							manager: localizedFileManagerName(t, window.maestro?.platform || 'darwin'),
						})}
					</button>
				</div>
			</div>
		</div>
	);
}
