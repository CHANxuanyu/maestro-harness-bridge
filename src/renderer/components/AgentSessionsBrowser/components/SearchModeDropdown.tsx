import { useT } from '../../../i18n';
import React, { RefObject } from 'react';
import { Search, User, Bot, MessageSquare, ChevronDown } from 'lucide-react';
import type { Theme } from '../../../types';
import type { SearchMode } from '../types';

interface SearchModeDropdownProps {
	searchMode: SearchMode;
	isOpen: boolean;
	dropdownRef: RefObject<HTMLDivElement>;
	onToggle: () => void;
	onSelect: (mode: SearchMode) => void;
	theme: Theme;
}

const MODES = [
	{
		mode: 'title' as SearchMode,
		icon: Search,
		label: 'workflows.sessions.searchTitleOnly',
		desc: 'workflows.sessions.searchTitlesHelp',
	},
	{
		mode: 'user' as SearchMode,
		icon: User,
		label: 'workflows.sessions.searchMyMessages',
		desc: 'workflows.sessions.searchMyMessagesHelp',
	},
	{
		mode: 'assistant' as SearchMode,
		icon: Bot,
		label: 'workflows.sessions.searchAiResponses',
		desc: 'workflows.sessions.searchAiResponsesHelp',
	},
	{
		mode: 'all' as SearchMode,
		icon: MessageSquare,
		label: 'workflows.sessions.searchAllContent',
		desc: 'workflows.sessions.searchEverything',
	},
] as const;

function getModeIcon(mode: SearchMode) {
	return MODES.find((m) => m.mode === mode)?.icon ?? MessageSquare;
}

export const SearchModeDropdown = React.memo(function SearchModeDropdown({
	searchMode,
	isOpen,
	dropdownRef,
	onToggle,
	onSelect,
	theme,
}: SearchModeDropdownProps) {
	const uiText = useT();
	const ActiveIcon = getModeIcon(searchMode);

	return (
		<div className="relative shrink-0" ref={dropdownRef}>
			<button
				onClick={onToggle}
				className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium hover:bg-white/10 transition-colors"
				style={{ color: theme.colors.textDim, border: `1px solid ${theme.colors.border}` }}
			>
				<ActiveIcon className="w-3 h-3" />
				<span className="capitalize">
					{uiText(
						(
							{
								all: 'workflows.sessions.all',
								title: 'workflows.sessions.searchModeTitle',
								user: 'workflows.sessions.searchModeUser',
								assistant: 'workflows.sessions.searchModeAssistant',
							} as const
						)[searchMode]
					)}
				</span>
				<ChevronDown className="w-3 h-3" />
			</button>
			{isOpen && (
				<div
					className="absolute right-0 top-full mt-1 w-48 rounded-lg shadow-lg border overflow-hidden z-50"
					style={{ backgroundColor: theme.colors.bgSidebar, borderColor: theme.colors.border }}
				>
					{MODES.map(({ mode, icon: Icon, label, desc }) => (
						<button
							key={mode}
							onClick={() => onSelect(mode)}
							className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-white/5 transition-colors ${searchMode === mode ? 'bg-white/10' : ''}`}
						>
							<Icon
								className="w-4 h-4 mt-0.5"
								style={{ color: searchMode === mode ? theme.colors.accent : theme.colors.textDim }}
							/>
							<div>
								<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
									{uiText(label)}
								</div>
								<div className="text-xs" style={{ color: theme.colors.textDim }}>
									{uiText(desc)}
								</div>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
});
