import { useCallback, useEffect, useState } from 'react';
import { captureException } from '../../../../../utils/sentry';
import { logger } from '../../../../../utils/logger';
import type { SyncStorageState } from '../types';
import { syncResultErrorMessage } from '../utils';
import { useT, type MessageKey } from '../../../../../i18n';

interface UseSyncStorageStateArgs {
	isOpen: boolean;
}

export function useSyncStorageState({ isOpen }: UseSyncStorageStateArgs): SyncStorageState {
	const [defaultStoragePath, setDefaultStoragePath] = useState('');
	const [_currentStoragePath, setCurrentStoragePath] = useState('');
	const [customSyncPath, setCustomSyncPath] = useState<string | undefined>(undefined);
	const [syncRestartRequired, setSyncRestartRequired] = useState(false);
	const [syncMigrating, setSyncMigrating] = useState(false);
	const t = useT();
	const [syncError, setSyncError] = useState<
		{ key: MessageKey; result?: { errors?: string[]; error?: string } } | { text: string } | null
	>(null);
	const [syncMigratedCount, setSyncMigratedCount] = useState<number | null>(null);

	useEffect(() => {
		if (!isOpen) return;

		Promise.all([
			window.maestro.sync.getDefaultPath(),
			window.maestro.sync.getSettings(),
			window.maestro.sync.getCurrentStoragePath(),
		])
			.then(([defaultPath, settings, currentPath]) => {
				setDefaultStoragePath(defaultPath);
				setCustomSyncPath(settings.customSyncPath);
				setCurrentStoragePath(currentPath);
				setSyncRestartRequired(false);
				setSyncError(null);
				setSyncMigratedCount(null);
			})
			.catch((err) => {
				logger.error('Failed to load sync settings:', undefined, err);
				setSyncError({ key: 'settings.general.storage.loadFailed' });
				captureException(err instanceof Error ? err : new Error(String(err)), {
					extra: { context: 'GeneralTab: failed to load sync/storage settings' },
				});
			});
	}, [isOpen]);

	const chooseSyncFolder = useCallback(async () => {
		try {
			const folder = await window.maestro.sync.selectSyncFolder();
			if (!folder) return;

			setSyncMigrating(true);
			setSyncError(null);
			setSyncMigratedCount(null);
			try {
				const result = await window.maestro.sync.setCustomPath(folder);
				if (result.success) {
					setCustomSyncPath(folder);
					setCurrentStoragePath(folder);
					setSyncRestartRequired(true);
					if (result.migrated !== undefined) {
						setSyncMigratedCount(result.migrated);
					}
				} else {
					setSyncError({ key: 'settings.general.storage.changeFailed', result });
				}
			} catch (error) {
				setSyncError({ text: error instanceof Error ? error.message : String(error) });
			} finally {
				setSyncMigrating(false);
			}
		} catch (error) {
			setSyncError({ text: error instanceof Error ? error.message : String(error) });
		}
	}, []);

	const resetToDefault = useCallback(async () => {
		setSyncMigrating(true);
		setSyncError(null);
		setSyncMigratedCount(null);
		try {
			const result = await window.maestro.sync.setCustomPath(null);
			if (result.success) {
				setCustomSyncPath(undefined);
				setCurrentStoragePath(defaultStoragePath);
				setSyncRestartRequired(true);
				if (result.migrated !== undefined) {
					setSyncMigratedCount(result.migrated);
				}
			} else {
				setSyncError({ key: 'settings.general.storage.resetFailed', result });
			}
		} catch (error) {
			setSyncError({ text: error instanceof Error ? error.message : String(error) });
		} finally {
			setSyncMigrating(false);
		}
	}, [defaultStoragePath]);

	const openStorageFolder = useCallback(() => {
		const folderPath = customSyncPath || defaultStoragePath;
		if (folderPath) {
			window.maestro?.shell?.openPath(folderPath);
		}
	}, [customSyncPath, defaultStoragePath]);

	return {
		defaultStoragePath,
		customSyncPath,
		syncRestartRequired,
		syncMigrating,
		syncError:
			syncError &&
			('key' in syncError
				? syncResultErrorMessage(syncError.result ?? {}, t(syncError.key))
				: syncError.text),
		syncMigratedCount,
		chooseSyncFolder,
		resetToDefault,
		openStorageFolder,
	};
}
