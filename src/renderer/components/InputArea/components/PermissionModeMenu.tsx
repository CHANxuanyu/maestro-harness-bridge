import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Shield } from 'lucide-react';
import type { Theme } from '../../../types';
import { useT } from '../../../i18n';
import { useClickOutside } from '../../../hooks/ui/useClickOutside';
import { useListNavigation } from '../../../hooks/keyboard/useListNavigation';
import { permissionModes } from '../../../utils/tabHelpers';
import { permissionModeLabel, permissionModeTooltip } from '../utils/displayLabels';

interface PermissionModeMenuProps {
	theme: Theme;
	agentId: string;
	mode: 'full' | 'standard' | 'readonly';
	hasStandardCapability: boolean;
	onChange: (mode: 'full' | 'standard' | 'readonly') => void;
}

/** Desktop selection uses the same supported modes and field patches as the phone sheet. */
export function PermissionModeMenu({
	theme,
	agentId,
	mode,
	hasStandardCapability,
	onChange,
}: PermissionModeMenuProps) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const modes = permissionModes(hasStandardCapability);
	useClickOutside(rootRef, () => setOpen(false), open);
	const select = (index: number) => {
		onChange(modes[index]);
		setOpen(false);
		triggerRef.current?.focus();
	};
	const { selectedIndex, setSelectedIndex, handleKeyDown } = useListNavigation({
		listLength: modes.length,
		initialIndex: modes.indexOf(mode),
		onSelect: select,
		wrap: true,
		enablePageNavigation: true,
		enabled: open,
	});
	useEffect(() => {
		if (open)
			menuRef.current?.querySelectorAll<HTMLButtonElement>('button')[selectedIndex]?.focus();
	}, [open, selectedIndex]);
	return (
		<div className="relative" ref={rootRef}>
			<button
				type="button"
				ref={triggerRef}
				onClick={() => {
					setSelectedIndex(modes.indexOf(mode));
					setOpen(!open);
				}}
				aria-haspopup="menu"
				aria-expanded={open}
				title={permissionModeTooltip(t, mode, agentId)}
				className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs whitespace-nowrap cursor-pointer transition-all opacity-80 hover:opacity-100 hover:bg-white/10"
				style={{ color: mode === 'readonly' ? theme.colors.warning : theme.colors.textDim }}
			>
				<Shield className="w-3.5 h-3.5" />
				<span>{permissionModeLabel(t, mode, agentId)}</span>
				<ChevronDown className="w-3 h-3 opacity-70" />
			</button>
			{open && (
				<div
					ref={menuRef}
					role="menu"
					aria-label={t('workflows.shell.access')}
					className="absolute bottom-full left-0 mb-1 rounded border shadow-lg z-50 py-1"
					style={{ backgroundColor: theme.colors.bgMain, borderColor: theme.colors.border }}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key === 'Escape') {
							event.preventDefault();
							setOpen(false);
							triggerRef.current?.focus();
						} else if (event.key === 'Tab') setOpen(false);
						else handleKeyDown(event);
					}}
				>
					{modes.map((option, index) => (
						<button
							key={option}
							type="button"
							role="menuitemradio"
							aria-checked={option === mode}
							tabIndex={index === selectedIndex ? 0 : -1}
							onFocus={() => setSelectedIndex(index)}
							onClick={() => select(index)}
							className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs whitespace-nowrap hover:bg-white/10 focus:bg-white/10 outline-none transition-colors"
							style={{ color: option === mode ? theme.colors.accent : theme.colors.textMain }}
						>
							<span className="flex-1">{permissionModeLabel(t, option, agentId)}</span>
							<Check aria-hidden className={`w-3.5 h-3.5 ${option === mode ? '' : 'invisible'}`} />
						</button>
					))}
				</div>
			)}
		</div>
	);
}
