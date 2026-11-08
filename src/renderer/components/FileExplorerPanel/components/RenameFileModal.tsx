import { useT } from '../../../i18n';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useEffect, useRef } from 'react';
import { Modal, ModalFooter } from '../../ui/Modal';
import { FormInput } from '../../ui/FormInput';
import { MODAL_PRIORITIES } from '../../../constants/modalPriorities';
import type { Theme } from '../../../types';
import type { FileNode } from '../../../types/fileTree';

interface RenameFileModalProps {
	theme: Theme;
	node: FileNode;
	value: string;
	setValue: (value: string) => void;
	error: string | null;
	onClose: () => void;
	onRename: () => void;
}

export function RenameFileModal({
	theme,
	node,
	value,
	setValue,
	error,
	onClose,
	onRename,
}: RenameFileModalProps) {
	const t = useT();
	const newShell = useSettingsStore((s) => s.newShell);
	const inputRef = useRef<HTMLInputElement>(null);
	const isFolder = node.type === 'folder';
	const title = newShell
		? t(
				isFolder
					? 'workflows.newShellCopy.panels.renameFolder'
					: 'workflows.newShellCopy.panels.renameFile'
			)
		: isFolder
			? 'Rename Folder'
			: 'Rename File';

	useEffect(() => {
		requestAnimationFrame(() => {
			if (inputRef.current) {
				const name = node.name;
				const dotIndex = !isFolder ? name.lastIndexOf('.') : -1;
				if (dotIndex > 0) {
					inputRef.current.setSelectionRange(0, dotIndex);
				} else {
					inputRef.current.select();
				}
			}
		});
	}, [node.name, isFolder]);

	return (
		<Modal
			theme={theme}
			title={title}
			priority={MODAL_PRIORITIES.RENAME_INSTANCE}
			onClose={onClose}
			initialFocusRef={inputRef}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={onRename}
					cancelLabel={newShell ? t('common.cancel') : undefined}
					confirmLabel={newShell ? t('workflows.newShellCopy.panels.rename') : 'Rename'}
					confirmDisabled={!value.trim() || value.trim() === node.name}
				/>
			}
		>
			<FormInput
				ref={inputRef}
				theme={theme}
				value={value}
				onChange={setValue}
				onSubmit={onRename}
				placeholder={
					newShell
						? t(
								isFolder
									? 'workflows.newShellCopy.panels.folderName'
									: 'workflows.newShellCopy.panels.fileName'
							)
						: isFolder
							? 'Enter folder name...'
							: 'Enter file name...'
				}
				error={error || undefined}
				submitEnabled={Boolean(value.trim() && value.trim() !== node.name)}
			/>
		</Modal>
	);
}
