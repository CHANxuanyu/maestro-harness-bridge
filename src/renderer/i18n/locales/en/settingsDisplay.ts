/** Settings: Display tab. Spread into the `settings` area by ./settings.ts. */
export const settingsDisplay = {
	// Typography reset
	'settings.display.reset.heading': 'Factory Reset Fonts',
	'settings.display.reset.description':
		'Set every font and size below at once. Default is proportional to read and monospace to work; Hacker is monospace everywhere.',
	'settings.display.reset.active': "You're on {preset}.",
	'settings.display.reset.customized': "You've customized these, so neither preset is active.",
	'settings.display.reset.confirmButton': 'Reset to {preset}?',
	'settings.display.reset.confirmHint':
		'Click again to overwrite all six fonts and all six sizes. Your zoom level is kept.',
	'settings.display.preset.default': 'Default',
	'settings.display.preset.hacker': 'Hacker',

	// Saved typography
	'settings.display.snapshot.heading': 'Save & Restore Customizations',
	'settings.display.snapshot.description':
		'Keep the fonts and sizes you like as your own setup, then try a preset above or keep tinkering below and put yours back in one click. One slot, overwritten each time you save. Your zoom level is not part of it.',
	'settings.display.snapshot.label': 'Your saved fonts',
	'settings.display.snapshot.none': 'Nothing saved yet.',
	'settings.display.snapshot.active': 'Your saved fonts are active. Saved {when}.',
	'settings.display.snapshot.inactive': 'Saved {when}. The fonts below are not it.',
	'settings.display.snapshot.confirmSave': 'Replace your saved fonts?',
	'settings.display.snapshot.save': 'Save Customizations',
	'settings.display.snapshot.restore': 'Restore Customizations',
	'settings.display.snapshot.saveFirst': 'Save your fonts first.',
	'settings.display.snapshot.alreadyActive': 'Your saved fonts are already active.',
	'settings.display.snapshot.confirmHint':
		'Click again to replace the setup you saved earlier. This cannot be undone.',

	// Fonts
	'settings.display.customFonts.heading': 'Custom Fonts',
	'settings.display.customFonts.description':
		"Names of fonts installed on this machine that aren't in the lists below. Added once here, then offered in every picker.",
	'settings.display.customFonts.placeholder': 'Add custom font name...',
	'settings.display.customFonts.aria': 'Add custom font name',
	'settings.display.customFonts.remove': 'Remove {font}',
	'settings.display.fonts.heading': 'Fonts',
	'settings.display.fonts.description':
		'Interface is the proportional face and Terminal the fixed-width one. Everything else can follow either, or carry a font of its own. Press Up/Down on any picker to preview.',
	'settings.display.surface.interface': 'Interface',
	'settings.display.surface.interface.description':
		'The whole app, and the proportional face other surfaces can follow.',
	'settings.display.surface.chat': 'AI Chat',
	'settings.display.surface.chat.description':
		'The AI transcript, in the main panel and in tiled panes.',
	'settings.display.surface.terminal': 'Terminal',
	'settings.display.surface.terminal.description':
		'The command terminal, and the fixed-width face other surfaces can follow. A Nerd Font here gets shell prompt glyphs.',
	'settings.display.surface.filePreview': 'File Preview',
	'settings.display.surface.filePreview.description': 'A file being read.',
	'settings.display.surface.documentGraph': 'Document Graph',
	'settings.display.surface.documentGraph.description':
		'Node titles and previews in the document graph.',
	'settings.display.surface.fileEditor': 'File Editor',
	'settings.display.surface.fileEditor.description':
		'A file being edited. Monospace keeps the gutter aligned with the text.',

	// Zoom
	'settings.display.zoom.heading': 'Zoom',
	'settings.display.zoom.description':
		'Scales every surface above by the same amount, so the sizes you set relative to each other stay that way. {zoomIn} / {zoomOut} to adjust, {zoomReset} to reset.',

	// Log buffer / output lines
	'settings.display.logBuffer.heading': 'Maximum Log Buffer',
	'settings.display.logBuffer.description':
		'Maximum number of entries to retain for history and system log viewer. Older entries are automatically discarded as new ones arrive.',
	'settings.display.outputLines.heading': 'Max Output Lines per Response',
	'settings.display.outputLines.all': 'All',
	'settings.display.outputLines.description':
		'Long outputs will be collapsed into a scrollable window. Set to "All" to always show full output.',

	// Message alignment
	'settings.display.alignment.heading': 'User Message Alignment',
	'settings.display.alignment.left': 'Left',
	'settings.display.alignment.right': 'Right',
	'settings.display.alignment.description':
		'Position your messages on the left or right side of the chat. AI responses appear on the opposite side.',

	// Group chats
	'settings.display.groupChat.heading': 'Group Chats',
	'settings.display.groupChat.title': 'Auto-scroll to newest message',
	'settings.display.groupChat.description':
		'Automatically scroll a group chat to the bottom when new messages arrive. Turn off to keep your scroll position while reading earlier messages.',
	'settings.display.groupChat.aria': 'Auto-scroll group chats to newest message',

	// Accessibility
	'settings.display.a11y.heading': 'Accessibility',
	'settings.display.a11y.description':
		'Visual options that adapt the interface for color vision deficiencies and long-form reading.',
	'settings.display.a11y.colorBlind': 'Color Blind Mode',
	'settings.display.a11y.colorBlindDescription':
		"Swap red/green/yellow semantics for Wong's colorblind-safe palette across agent status dots, diff add/remove, git status, the activity graph, Usage Dashboard charts, and file extension badges.",
	'settings.display.a11y.colorBlindAria': 'Color blind mode',
	'settings.display.a11y.bionify': 'Bionify Emphasis',
	'settings.display.a11y.bionifyInfoAria': 'Info',
	'settings.display.a11y.bionifyInfoTitle': 'Bionify algorithm info',
	'settings.display.a11y.bionifyAria': 'Bionify reading mode',
	'settings.display.a11y.intensity': 'Intensity',
	'settings.display.a11y.soft': 'Soft',
	'settings.display.a11y.strong': 'Strong',
	'settings.display.a11y.intensityDescription':
		'Controls how hard the emphasis hits. Strong increases emphasis weight and fades the remaining characters more aggressively.',
	'settings.display.a11y.algorithm': 'Bionify Algorithm',
	'settings.display.a11y.algorithmAria': 'Bionify algorithm',
	'settings.display.a11y.algorithmFormat':
		'Format: sign, four fixed word-length rules, then a fallback fraction. Example: {example}',
	'settings.display.a11y.algorithmInvalid': 'Enter {format}, for example {example}.',

	// Bionify reference modal
	'settings.display.bionify.title': 'Bionify Algorithm Reference',
	'settings.display.bionify.sign':
		'The first character is {minus} or {plus}. {minus} skips common english words like {a}, {and}, and {the}. {plus} highlights every word.',
	'settings.display.bionify.lengths':
		'The next four numbers control highlighted characters for words of length 1-4.',
	'settings.display.bionify.fraction':
		"The final value is a fraction of each word's characters to emphasize (for example, {example} highlights the first 40% of characters in words longer than 4 letters).",
	'settings.display.bionify.default':
		'Current default: {example}, which skips common words and highlights the first 40% of longer words.',

	// Icon theme / tree lines
	'settings.display.iconTheme.heading': 'Files Pane Icon Theme',
	'settings.display.iconTheme.flat': 'Flat',
	'settings.display.iconTheme.rich': 'Rich',
	'settings.display.iconTheme.description':
		"Rich uses Material Icon Theme style file and folder SVGs in the Files pane. Flat uses Maestro's simpler monochrome icons.",
	'settings.display.treeLines.heading': 'Files Pane Tree Lines',
	'settings.display.treeLines.title': 'Show branch connectors',
	'settings.display.treeLines.description':
		"Hang each row off its folder with an elbow connector, and stop a folder's guide line at its last item. Off by default, which draws plain full-height indent guides.",
	'settings.display.treeLines.aria': 'Show file tree branch connectors',

	// Provider mode pill
	'settings.display.providerPill.heading': 'Provider Mode Pill',
	'settings.display.providerPill.title': 'Show provider mode',
	'settings.display.providerPill.description':
		'Display which Claude interface produced a turn ("claude -p" or "TUI Wrapper") as a pill under chat responses and on History entries.',
	'settings.display.providerPill.aria': 'Show provider mode pill',

	// Window chrome
	'settings.display.chrome.heading': 'Window Chrome',
	'settings.display.chrome.nativeTitleBar': 'Use native title bar',
	'settings.display.chrome.nativeTitleBarDescription':
		"Use the OS native title bar instead of Maestro's custom title bar. Requires restart.",
	'settings.display.chrome.autoHideMenu': 'Auto-hide menu bar',
	'settings.display.chrome.autoHideMenuDescription':
		'Hide the application menu bar. Press Alt to toggle visibility. Applies to Windows and Linux. Requires restart.',

	// Main header
	'settings.display.header.heading': 'Main Header Panel',
	'settings.display.header.agentName': 'Show agent name',
	'settings.display.header.agentNameDescription': 'Display the agent name in the main header.',
	'settings.display.header.sessionId': 'Show session ID pill',
	'settings.display.header.sessionIdDescription':
		'Display the provider session ID pill (short hash, e.g. "B778BF42") in the main header. Click the pill to copy the full ID.',
	'settings.display.header.cost': 'Show session cost pill',
	'settings.display.header.costDescription':
		'Display the per-session running cost (e.g. "$21.33") in the main header, and the total cost in the group chat header.',

	// Left side panel
	'settings.display.left.heading': 'Left Side Panel',
	'settings.display.left.starred': 'Show Starred Sessions section',
	'settings.display.left.starredDescription':
		'Display a Starred Sessions section at the top of the left side bar listing every starred AI tab across all agents.',
	'settings.display.left.starredAria': 'Show Starred Sessions section in left side bar',
	'settings.display.left.memberCount': 'Show group member count',
	'settings.display.left.memberCountDescription':
		'Display the number of agents in parentheses after each group name in the left side bar (e.g. "UNGROUPED AGENTS (24)").',
	'settings.display.left.memberCountAria': 'Show group member count in left side bar',
	'settings.display.left.initials': 'Show agent initials when collapsed',
	'settings.display.left.initialsDescription':
		'When the left side bar is collapsed, label each agent with two letters from its name (e.g. {example} for Maestro RC), tinted with its status color. Letters are picked so no two agents share a label. Turn off to show a plain status dot.',
	'settings.display.left.initialsAria': 'Show agent initials in collapsed left side bar',
	'settings.display.left.pillsPerRow': 'Collapsed group pills per row',
	'settings.display.left.pillsPerRowDescription':
		'When a group is collapsed, its agents render as a row of activity pills. Pills wrap to a new row once this many are shown, so large groups stay readable instead of condensing into invisible slivers.',
	'settings.display.left.locationPills': 'Show location pills',
	'settings.display.left.locationPillsDescription':
		'Display the REMOTE / LOCAL / GIT badges next to each agent in the left side bar. Turn off to simplify the agent rows.',
	'settings.display.left.locationPillsAria': 'Show location pills in left side bar',
	'settings.display.left.git': 'Show git change indicator',
	'settings.display.left.gitDescription':
		'Display the branch icon and dirty file count next to git repository agents.',
	'settings.display.left.gitAria': 'Show git change indicator in left side bar',
	'settings.display.left.cue': 'Show Cue indicator',
	'settings.display.left.cueDescription':
		'Display the lightning-bolt indicator next to agents with active Maestro Cue subscriptions.',
	'settings.display.left.cueAria': 'Show Cue indicator in left side bar',
	'settings.display.left.startup': 'Show terminal startup-command indicator',
	'settings.display.left.startupDescription':
		'Display the {glyph} glyph next to agents that have at least one terminal tab with a saved startup command.',
	'settings.display.left.startupAria': 'Show terminal startup-command indicator in left side bar',
	'settings.display.left.groupLabel': 'Show group label on bookmarked agents',
	'settings.display.left.groupLabelDescription':
		'Display the group badge (e.g. {example}) next to bookmarked agents. Turn off to hide the group pill entirely.',
	'settings.display.left.groupLabelAria': 'Show group label on bookmarked agents in left side bar',
	'settings.display.left.fullGroupLabel': 'Show full group label on bookmarked agents',
	'settings.display.left.fullGroupLabelDescription':
		'Display the full group name (e.g. {full}) instead of the abbreviated badge (e.g. {short}) next to bookmarked agents. Long names are truncated with the full value on hover.',
	'settings.display.left.fullGroupLabelAria':
		'Show full group label on bookmarked agents in left side bar',
	'settings.display.left.worktreePill': 'Show {pill} pill in subagent list',
	'settings.display.left.worktreePillDescription':
		'Display the worktree badge next to worktree child agents in the left panel.',
	'settings.display.left.worktreePillAria': 'Show worktree pill in left panel agent list',
	'settings.display.left.branchName': 'Show worktree branch name in subagent list',
	'settings.display.left.branchNameDescription':
		'Display the worktree branch name beneath the agent name in the left panel.',
	'settings.display.left.branchNameAria': 'Show branch name in left panel agent list',

	// Modal layout
	'settings.display.modal.heading': 'Modal Layout',
	'settings.display.modal.title': 'Saved modal sizes',
	'settings.display.modal.description': 'Clear custom dialog dimensions.',

	// File edit & preview
	'settings.display.fileEdit.heading': 'File Edit & Preview',
	'settings.display.fileEdit.lineNumbers': 'Show line numbers in the editor',
	'settings.display.fileEdit.lineNumbersDescription':
		'Render a line-number gutter on the left edge of the file editor. Right-clicking a line copies a maestro:// deep link to that line.',
	'settings.display.fileEdit.wrap': 'Wrap long lines in the editor',
	'settings.display.fileEdit.wrapDescription':
		'When on, long lines wrap at whitespace. When off, the editor scrolls horizontally. Toggle live from the editor toolbar.',
	'settings.display.fileEdit.toolbar': 'Toolbar buttons',
	'settings.display.fileEdit.toolbarDescription':
		'Hide buttons you never use. Hidden actions stay reachable via command palette and keyboard shortcuts.',
	'settings.display.fileEdit.showButton': 'Show {label} button',
	'settings.display.toolbar.save': 'Save',
	'settings.display.toolbar.wordWrap': 'Word wrap',
	'settings.display.toolbar.remoteImages': 'Show remote images',
	'settings.display.toolbar.htmlRender': 'Render HTML',
	'settings.display.toolbar.openInBrowser': 'Open in Maestro browser',
	'settings.display.toolbar.previewTier': 'Preview tier chip',
	'settings.display.toolbar.editToggle': 'Edit / preview toggle',
	'settings.display.toolbar.editImage': 'Edit image',
	'settings.display.toolbar.copyContent': 'Copy content',
	'settings.display.toolbar.publishGist': 'Publish as gist',
	'settings.display.toolbar.documentGraph': 'Document graph',
	'settings.display.toolbar.openInDefault': 'Open in default app',
	'settings.display.toolbar.revealInFolder': 'Reveal in {manager}',
	'settings.display.toolbar.copyPath': 'Copy file path',
	'settings.display.toolbar.delete': 'Delete file',

	// Tab options
	'settings.display.tabs.heading': 'Tab Options',
	'settings.display.tabs.starred': 'Show starred tabs when filtering by unread',
	'settings.display.tabs.starredDescription':
		'When the unread filter is active, starred tabs remain visible even if they have no unread messages.',
	'settings.display.tabs.filePreviews': 'Show file preview tabs when filtering by unread',
	'settings.display.tabs.filePreviewsDescription':
		'When the unread filter is active, file preview tabs remain visible instead of being hidden.',
	'settings.display.tabs.terminals': 'Show terminal tabs when filtering by unread',
	'settings.display.tabs.terminalsDescription':
		'When the unread filter is active, terminal tabs remain visible instead of being hidden.',
	'settings.display.tabs.browsers': 'Show browser tabs when filtering by unread',
	'settings.display.tabs.browsersDescription':
		'When the unread filter is active, browser tabs remain visible instead of being hidden.',
	'settings.display.tabs.lastTab': 'Treat {meta}+0 as the last tab',
	'settings.display.tabs.lastTabDescription':
		'Maestro-style: {meta}+1-9 jump to tabs 1-9, and {meta}+0 jumps to the last tab. Disable to use browser-style: {meta}+1-8 jump to tabs 1-8, and {meta}+9 jumps to the last tab.',
	'settings.display.tabs.domain': 'Show domain on browser tabs',
	'settings.display.tabs.domainDescription':
		'Display a small domain pill (e.g. www.google.com) next to the page title on browser tabs. Disable to hide it.',
	'settings.display.tabs.countBadge': 'Show tab count on the search icon',
	'settings.display.tabs.countBadgeDescription':
		'Display the number of open tabs as a small badge on the tab bar search (magnifier) icon. When off, the count is still shown next to "Search Tabs" in the popover that opens when you click the icon.',
	'settings.display.tabs.wheel': 'Scroll tabs with the mouse wheel',
	'settings.display.tabs.wheelDescription':
		'When the tab strip overflows, hover over it and scroll the mouse wheel to pan the tabs left and right. Disable to stop translating vertical wheel movement into tab scrolling; native horizontal gestures like trackpad swipes are unaffected.',

	// Document graph
	'settings.display.graph.heading': 'Document Graph',
	'settings.display.graph.externalLinks': 'Show external links by default',
	'settings.display.graph.externalLinksDescription':
		'Display external website links as nodes. Can be toggled in the graph view.',
	'settings.display.graph.confirmClose': 'Confirm before closing',
	'settings.display.graph.confirmCloseDescription':
		'Ask before Escape discards the layout, depth, and node positions you set up. A graph opened from the Memories viewer never asks, since closing returns there.',
	'settings.display.graph.maxNodes': 'Maximum nodes to display',
	'settings.display.graph.maxNodesDescription':
		'Limits initial graph size for performance. Use "Load more" to show additional nodes.',

	// Context warnings
	'settings.display.context.heading': 'Context Window Warnings',
	'settings.display.context.title': 'Show context consumption warnings',
	'settings.display.context.description':
		'Display warning banners when context window usage reaches configurable thresholds',
	'settings.display.context.yellow': 'Yellow warning threshold',
	'settings.display.context.red': 'Red warning threshold',

	// File indexing
	'settings.display.indexing.heading': 'File Indexing',
	'settings.display.indexing.localTitle': 'Local Ignore Patterns',
	'settings.display.indexing.localDescription':
		'Configure glob patterns for folders to exclude when indexing local files in the file explorer. Excluding large directories (like .git) reduces memory usage and speeds up file tree loading.',
} as const;
