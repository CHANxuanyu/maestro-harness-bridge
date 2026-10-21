import { useT } from '../../../i18n';
import type React from 'react';
import { Search } from 'lucide-react';
import type { Session, Theme } from '../../../types';
import type { QuickActionMode } from '../types';
import { EscCloseButton } from '../../ui/EscCloseButton';

interface QuickActionsSearchBarProps {
	theme: Theme;
	mode: QuickActionMode;
	activeSession: Session | undefined;
	/** True while an inline rename (session or window) is active - shows the rename input. */
	renaming: boolean;
	search: string;
	setSearch: (value: string) => void;
	renameValue: string;
	setRenameValue: (value: string) => void;
	inputRef: React.Ref<HTMLInputElement>;
	onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
	/** Same action as pressing Escape, for pointer-only surfaces. */
	onClose: () => void;
}

export function QuickActionsSearchBar({
	theme,
	mode,
	activeSession,
	renaming,
	search,
	setSearch,
	renameValue,
	setRenameValue,
	inputRef,
	onKeyDown,
	onClose,
}: QuickActionsSearchBarProps) {
	const t = useT();
	return (
		<div
			className="p-4 border-b flex items-center gap-3"
			style={{ borderColor: theme.colors.border }}
		>
			<Search className="w-5 h-5" style={{ color: theme.colors.textDim }} />
			{renaming ? (
				<input
					ref={inputRef}
					className="flex-1 bg-transparent outline-none text-lg"
					placeholder={t('workflows.shell.enterNewName')}
					style={{ color: theme.colors.textMain }}
					value={renameValue}
					onChange={(e) => setRenameValue(e.target.value)}
					onKeyDown={onKeyDown}
					autoFocus
				/>
			) : (
				<input
					ref={inputRef}
					className="flex-1 bg-transparent outline-none text-lg placeholder-opacity-50"
					placeholder={
						mode === 'move-to-group'
							? t('workflows.shell.moveValueTo', {
									p0: activeSession?.name || t('workflows.labels.session'),
								})
							: mode === 'agents'
								? t('workflows.shell.jumpToAgent')
								: t('workflows.shell.typeACommandOrJumpToAgent')
					}
					style={{ color: theme.colors.textMain }}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					onKeyDown={onKeyDown}
				/>
			)}
			<EscCloseButton theme={theme} onClose={onClose} />
		</div>
	);
}
