import { useT, type MessageKey } from '../../../i18n';
import type { NativeCommandSnapshot } from '../../../../shared/nativeCommands';
import React, { memo } from 'react';
import type { MutableRefObject } from 'react';
import type { Theme } from '../../../types';
import { highlightSlashCommand } from '../../../utils/search';
import type { SlashCommand } from '../types';

interface SlashCommandPopoverProps {
	warning?: NativeCommandSnapshot['warning'];
	isOpen: boolean;
	commands: SlashCommand[];
	inputValueLower: string;
	selectedIndex: number;
	itemRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
	theme: Theme;
	setInputValue: (value: string) => void;
	setSlashCommandOpen: (open: boolean) => void;
	setSelectedSlashCommandIndex: (index: number) => void;
	inputRef: React.RefObject<HTMLTextAreaElement>;
}

export const SlashCommandPopover = memo(function SlashCommandPopover({
	warning,
	isOpen,
	commands,
	inputValueLower,
	selectedIndex,
	itemRefs,
	theme,
	setInputValue,
	setSlashCommandOpen,
	setSelectedSlashCommandIndex,
	inputRef,
}: SlashCommandPopoverProps) {
	const t = useT();
	if (!isOpen || (commands.length === 0 && !warning)) {
		return null;
	}

	return (
		<div
			className="absolute bottom-full left-0 right-0 mb-2 border rounded-lg shadow-2xl overflow-hidden"
			style={{ backgroundColor: theme.colors.bgSidebar, borderColor: theme.colors.border }}
		>
			{warning && (
				<div role="status" className="px-3 py-2 text-xs" style={{ color: theme.colors.textDim }}>
					{t(
						warning === 'remote-unavailable'
							? 'workflows.nativeCommands.remoteUnavailable'
							: 'workflows.nativeCommands.unavailable'
					)}
				</div>
			)}
			<div
				className="overflow-y-auto max-h-96 scrollbar-thin"
				style={{ overscrollBehavior: 'contain' }}
			>
				{commands.map((cmd, idx) => (
					<button
						type="button"
						key={cmd.command}
						ref={(el) => (itemRefs.current[idx] = el)}
						className={`w-full px-3 py-1 text-left transition-colors ${
							idx === selectedIndex ? 'font-semibold' : ''
						}`}
						style={{
							backgroundColor: idx === selectedIndex ? theme.colors.accent : 'transparent',
							color: idx === selectedIndex ? theme.colors.bgMain : theme.colors.textMain,
						}}
						onClick={() => {
							// A single click ACCEPTS, the way every other composer popover
							// behaves (`AtMentionPopover`, `CommandHistoryPopover`,
							// `TabCompletionPopover`). This used to only move the highlight
							// and leave acceptance to a double-click, which a touch screen
							// cannot produce: on a phone the menu opened, every tap did
							// nothing visible, and there was no keyboard to press Enter on.
							// The trailing space matches what Tab/Enter writes in
							// `useInputKeyDown`, so a tapped command and a typed one leave
							// the caret in the same place.
							setSelectedSlashCommandIndex(idx);
							setInputValue(cmd.command + ' ');
							setSlashCommandOpen(false);
							inputRef.current?.focus();
						}}
						onMouseEnter={() => setSelectedSlashCommandIndex(idx)}
					>
						<div className="font-mono text-sm leading-tight">
							{highlightSlashCommand(cmd.command, inputValueLower.replace(/^\//, ''))}
							{cmd.source && cmd.source !== 'builtin' && (
								<span className="ml-2 text-xs font-sans">
									{t(
										cmd.source === 'project'
											? 'workflows.nativeCommands.project'
											: cmd.source === 'reported'
												? 'workflows.nativeCommands.reported'
												: 'workflows.nativeCommands.user'
									)}
								</span>
							)}
						</div>
						<div className="text-xs-plus opacity-70 leading-tight">
							{cmd.source === 'builtin'
								? t(`workflows.nativeCommands.${cmd.command.slice(1)}` as MessageKey)
								: cmd.description}
						</div>
					</button>
				))}
			</div>
		</div>
	);
});
