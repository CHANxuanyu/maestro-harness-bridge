import { useT } from '../../../i18n';
import { useSettingsStore } from '../../../stores/settingsStore';
import { Spinner } from '../../ui/Spinner';
import type { Theme } from '../../../types';

interface FileTreeLoadingProgressProps {
	theme: Theme;
	progress?: {
		directoriesScanned: number;
		filesFound: number;
		currentDirectory: string;
	};
	isRemote: boolean;
	onCancel?: () => void;
}

export function FileTreeLoadingProgress({
	theme,
	progress,
	isRemote,
	onCancel,
}: FileTreeLoadingProgressProps) {
	const t = useT();
	const newShell = useSettingsStore((s) => s.newShell);
	const currentFolder = progress?.currentDirectory
		? progress.currentDirectory.split('/').pop() || progress.currentDirectory
		: '';

	return (
		<div className="flex flex-col items-center justify-center gap-3 py-8">
			<Spinner size={24} color={theme.colors.accent} />

			<div className="text-center">
				<div className="text-xs" style={{ color: theme.colors.textMain }}>
					{newShell
						? t(
								isRemote
									? 'workflows.newShellCopy.panels.loadingRemote'
									: 'workflows.newShellCopy.panels.loadingFiles'
							)
						: isRemote
							? 'Loading remote files...'
							: 'Loading files...'}
				</div>

				{progress && (progress.directoriesScanned > 0 || progress.filesFound > 0) && (
					<div className="text-xs mt-2 font-mono" style={{ color: theme.colors.textDim }}>
						{newShell ? (
							t('workflows.newShellCopy.panels.scanProgress', {
								files: progress.filesFound.toLocaleString(),
								folders: progress.directoriesScanned.toLocaleString(),
							})
						) : (
							<>
								<span style={{ color: theme.colors.accent }}>
									{progress.filesFound.toLocaleString()}
								</span>
								{' files in '}
								<span style={{ color: theme.colors.accent }}>
									{progress.directoriesScanned.toLocaleString()}
								</span>
								{' folders'}
							</>
						)}
					</div>
				)}

				{currentFolder && (
					<div
						className="text-2xs mt-1.5 max-w-[200px] truncate opacity-60"
						style={{ color: theme.colors.textDim }}
						title={progress?.currentDirectory}
					>
						{newShell ? (
							t('workflows.newShellCopy.panels.scanning', { folder: currentFolder })
						) : (
							<>scanning: {currentFolder}/</>
						)}
					</div>
				)}

				{onCancel && (
					<button
						type="button"
						onClick={onCancel}
						className="text-xs-plus mt-3 underline-offset-2 hover:underline transition-opacity"
						style={{ color: theme.colors.textDim }}
					>
						{newShell ? t('workflows.newShellCopy.panels.stopLoading') : <>Stop loading</>}{' '}
					</button>
				)}
			</div>
		</div>
	);
}
