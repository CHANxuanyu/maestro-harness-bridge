import type { Theme } from '../../types';
import { useT } from '../../i18n';

/** Keeps a pane visible when its referenced tab no longer exists. */
export function PaneMissingTab({ theme }: { theme: Theme }) {
	const t = useT();
	return (
		<div
			className="flex-1 flex items-center justify-center select-none"
			style={{ backgroundColor: theme.colors.bgMain }}
		>
			<div
				className="text-xs text-center px-4 py-2 rounded"
				style={{
					color: theme.colors.textDim,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				{t('workflows.shell.thisTabIsNoLongerAvailable')}
			</div>
		</div>
	);
}
