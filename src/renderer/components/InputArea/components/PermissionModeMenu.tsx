import { Fragment, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Shield } from 'lucide-react';
import type { Theme } from '../../../types';
import { useT, type MessageKey } from '../../../i18n';
import { selectNewShellEnabled, useSettingsStore } from '../../../stores/settingsStore';
import { useClickOutside } from '../../../hooks/ui/useClickOutside';
import { useListNavigation } from '../../../hooks/keyboard/useListNavigation';
import { permissionModes } from '../../../utils/tabHelpers';
import { permissionModeLabel, permissionModeTooltip } from '../utils/displayLabels';

interface PermissionModeMenuProps {
	theme: Theme;
	agentId: string;
	mode: 'full' | 'standard' | 'readonly';
	hasStandardCapability: boolean;
	standardUnavailableNotice?: MessageKey;
	onChange: (mode: 'full' | 'standard' | 'readonly') => void;
}

/** Desktop selection uses the same supported modes and field patches as the phone sheet. */
export function PermissionModeMenu({
	theme,
	agentId,
	mode,
	hasStandardCapability,
	standardUnavailableNotice = 'workflows.sessions.standardPrintNotice',
	onChange,
}: PermissionModeMenuProps) {
	const t = useT();
	const newShell = useSettingsStore(selectNewShellEnabled);
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const unavailableStandard = newShell && agentId === 'claude-code' && !hasStandardCapability;
	const modes = permissionModes(hasStandardCapability || unavailableStandard);
	const selectableModes = permissionModes(hasStandardCapability);
	useClickOutside(rootRef, () => setOpen(false), open);
	const select = (index: number) => {
		if (!selectableModes[index]) return;
		onChange(selectableModes[index]);
		setOpen(false);
		triggerRef.current?.focus();
	};
	const { selectedIndex, setSelectedIndex, handleKeyDown } = useListNavigation({
		listLength: selectableModes.length,
		initialIndex: Math.max(0, selectableModes.indexOf(mode)),
		onSelect: select,
		wrap: true,
		enablePageNavigation: true,
		enabled: open,
	});
	useEffect(() => {
		if (open)
			menuRef.current
				?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
				[selectedIndex]?.focus();
	}, [open, selectedIndex]);
	return (
		<div className="relative" ref={rootRef}>
			<button
				type="button"
				ref={triggerRef}
				onClick={() => {
					setSelectedIndex(Math.max(0, selectableModes.indexOf(mode)));
					setOpen(!open);
				}}
				aria-haspopup="menu"
				data-testid="composer-permission"
				aria-expanded={open}
				title={permissionModeTooltip(t, mode, agentId, newShell)}
				className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs whitespace-nowrap cursor-pointer transition-all opacity-80 hover:opacity-100 hover:bg-white/10"
				style={{ color: mode === 'readonly' ? theme.colors.warning : theme.colors.textDim }}
			>
				<Shield className="w-3.5 h-3.5" />
				<span>{permissionModeLabel(t, mode, agentId, newShell)}</span>
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
					{modes.map((option) => (
						<Fragment key={option}>
							<button
								type="button"
								role="menuitemradio"
								disabled={option === 'standard' && unavailableStandard}
								aria-disabled={option === 'standard' && unavailableStandard}
								aria-checked={option === mode}
								tabIndex={selectableModes.indexOf(option) === selectedIndex ? 0 : -1}
								onFocus={() => setSelectedIndex(selectableModes.indexOf(option))}
								onClick={() => select(selectableModes.indexOf(option))}
								className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs whitespace-nowrap enabled:hover:bg-white/10 focus:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed outline-none transition-colors"
								style={{ color: option === mode ? theme.colors.accent : theme.colors.textMain }}
							>
								<span className="flex-1">{permissionModeLabel(t, option, agentId, newShell)}</span>
								<Check
									aria-hidden
									className={`w-3.5 h-3.5 ${option === mode ? '' : 'invisible'}`}
								/>
							</button>
							{option === 'standard' && unavailableStandard && (
								<p
									className="w-64 px-3 pb-2 text-xs whitespace-normal"
									style={{ color: theme.colors.textDim }}
								>
									{t(standardUnavailableNotice)}
								</p>
							)}
						</Fragment>
					))}
				</div>
			)}
		</div>
	);
}
