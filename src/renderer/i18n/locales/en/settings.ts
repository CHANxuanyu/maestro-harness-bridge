/**
 * Settings modal chrome, settings search, and the General tab. Each other
 * Settings tab lives in its own `settings*.ts` file and is spread in here, so
 * the whole Settings surface stays one catalog area with one key prefix.
 */
import { settingsDisplay } from './settingsDisplay';

export const settings = {
	...settingsDisplay,
	// Modal chrome
	'settings.title': 'Settings',
	'settings.tabsAria': 'Settings tabs',
	'settings.closeAria': 'Close settings',
	'settings.tab.about': 'About',
	'settings.tab.aicommands': 'AI Commands',
	'settings.tab.display': 'Display',
	'settings.tab.environment': 'Environment',
	'settings.tab.general': 'General',
	'settings.tab.prompts': 'Maestro Prompts',
	'settings.tab.notifications': 'Notifications',
	'settings.tab.encore': 'Plugins',
	'settings.tab.shortcuts': 'Shortcuts',
	'settings.tab.ssh': 'SSH Hosts',
	'settings.tab.theme': 'Themes',

	// Search
	'settings.search.placeholder': 'Search settings...',
	'settings.search.aria': 'Search settings',
	'settings.search.clear': 'Clear search',
	'settings.search.noResults': 'No settings found for “{query}”',

	// Language
	'settings.language.heading': 'Language',
	'settings.language.description':
		'The language of menus, buttons, and messages in Maestro. Conversations, agent output, and prompts sent to agents are never translated.',
	'settings.language.systemResolved': 'Following the system language: {language}.',
	'settings.language.system': 'System',

	// Shared bits used by several General sections
	'settings.general.customPathOptional': 'Custom Path (optional)',
	'settings.general.unlimited': 'Unlimited',
	'settings.general.endOfList': 'End of list',
	'settings.general.afterCurrentTab': 'After current tab',
	'settings.general.readOnly': 'Read-Only',
	'settings.general.readWrite': 'Read/Write',
	'settings.general.duration.min': '{count} min',
	'settings.general.duration.hr': '{count} hr',
	'settings.general.duration.sec': '{count}s',

	// Global hotkey
	'settings.general.hotkey.heading': 'Global Hotkey to Show Maestro',
	'settings.general.hotkey.description':
		'System-wide shortcut that brings Maestro to the foreground from any app. Works on macOS, Windows, and Linux. Leave blank to disable. (Tip: pick something with two modifiers, e.g. {example}, to avoid clashes.)',
	'settings.general.hotkey.empty': 'Click to set hotkey',

	// Conductor profile
	'settings.general.profile.heading': 'Conductor Profile (aka, About Me)',
	'settings.general.profile.description':
		'Tell us a little about yourself so that agents created under Maestro know how to work and communicate with you. As the conductor, you orchestrate the symphony of AI agents. (Optional, max 5000 characters)',
	'settings.general.profile.aria': 'Conductor Profile',
	'settings.general.profile.placeholder':
		"e.g., I'm a senior developer working on a React/TypeScript project. I prefer concise explanations and clean code patterns...",

	// Maestro CLI
	'settings.general.cli.description':
		'Check whether {command} is available in your PATH and whether its version matches Maestro v{version}.',
	'settings.general.cli.pathLabel': 'PATH:',
	'settings.general.cli.detected': 'Detected',
	'settings.general.cli.detectedShell': 'Detected (shell PATH)',
	'settings.general.cli.notDetected': 'Not detected',
	'settings.general.cli.installedVersion': 'Installed version:',
	'settings.general.cli.notInstalled': 'Not installed',
	'settings.general.cli.expectedVersion': 'Expected version:',
	'settings.general.cli.commandPath': 'Command path:',
	'settings.general.cli.mismatch':
		'Mismatch or missing CLI detected. Install/update to sync versions.',
	'settings.general.cli.checkingStatus': 'Checking Maestro CLI status...',
	'settings.general.cli.checking': 'Checking...',
	'settings.general.cli.checkNow': 'Check now',
	'settings.general.cli.installing': 'Installing...',
	'settings.general.cli.installUpdate': 'Install / Update CLI',
	'settings.general.cli.reinstall': 'Reinstall CLI',
	'settings.general.cli.installTarget': 'Install target: {path}',
	'settings.general.cli.checkFailed': 'Failed to check Maestro CLI status',
	'settings.general.cli.installFailed': 'Failed to install/update Maestro CLI',
	'settings.general.cli.installedRestart':
		'CLI installed. Open a new terminal for PATH changes to apply.',
	'settings.general.cli.installedOk': 'CLI is installed and matches this Maestro version.',
	'settings.general.cli.installedAttention':
		'CLI was installed but version/path check still needs attention.',

	// Shell
	'settings.general.shell.heading': 'Default Terminal Shell',
	'settings.general.shell.description':
		'Choose which shell to use for terminal sessions. Select any shell and configure a custom path if needed.',
	'settings.general.shell.loading': 'Loading shells...',
	'settings.general.shell.available': 'Available',
	'settings.general.shell.customPathRequired': 'Custom Path Required',
	'settings.general.shell.notFound': 'Not Found',
	'settings.general.shell.currentDefault': 'Current default',
	'settings.general.shell.detectOthers': 'Detect other available shells...',
	'settings.general.shell.config': 'Shell Configuration',
	'settings.general.shell.customPathHelp':
		'Override the auto-detected shell path. Leave empty to use the detected path.',
	'settings.general.shell.argsLabel': 'Additional Arguments (optional)',
	'settings.general.shell.argsHelp':
		'Additional CLI arguments passed to every shell session (e.g., --login, -c).',

	// Log level
	'settings.general.logLevel.heading': 'System Log Level',
	'settings.general.logLevel.debug': 'Debug',
	'settings.general.logLevel.info': 'Info',
	'settings.general.logLevel.warn': 'Warn',
	'settings.general.logLevel.error': 'Error',
	'settings.general.logLevel.description':
		'Higher levels show fewer logs. Debug shows all logs, Error shows only errors.',

	// GitHub CLI
	'settings.general.gh.heading': 'GitHub CLI (gh) Path',
	'settings.general.gh.description':
		"Specify the full path to the {binary} binary if it's not in your PATH. Used for Auto Run worktree features.",

	// Web interface
	'settings.general.web.heading': 'Web Interface',
	'settings.general.web.title': 'Turn on web interface at launch',
	'settings.general.web.description':
		"Automatically make Maestro's full UI available in a browser. Enabling this also turns it on now.",

	// Input behavior
	'settings.general.input.heading': 'Input Send Behavior',
	'settings.general.input.description':
		'Configure how to send messages. Choose between Enter or {meta}+Enter.',
	'settings.general.input.aiMode': 'AI Interaction Mode',
	'settings.general.input.enterSends': 'Press Enter to send. Use Shift+Enter for new line.',
	'settings.general.input.metaEnterSends': 'Press {meta}+Enter to send. Enter creates new line.',
	'settings.general.input.tabOverride':
		'Default for new tabs. Toggling the chip in an AI tab (or running "Toggle Enter to Send" from the command palette) overrides this for that tab only.',
	'settings.general.input.expandedMode': 'Expanded AI Interaction Mode',
	'settings.general.input.expandedEnterSends':
		'In the expanded Prompt Composer, press Enter to send. Use Shift+Enter for new line.',
	'settings.general.input.expandedMetaEnterSends':
		'In the expanded Prompt Composer, press {meta}+Enter to send. Enter creates new line.',
	'settings.general.input.forcedParallel': 'Forced Parallel Execution',
	'settings.general.input.alwaysNotNeeded': 'Not needed in Always mode - every send is forced',
	'settings.general.input.alwaysWarning':
		'{lead}, even while the agent is busy - no modifier needed. Parallel writes to the same files may cause one to overwrite the other.',
	'settings.general.input.alwaysWarningLead': 'Every message force-sends',
	'settings.general.input.modifierWarning':
		'When enabled, use {shortcut} to send messages even while the agent is busy. Parallel writes to the same files may cause one to overwrite the other.',
	'settings.general.input.sendTrigger': 'Send trigger',
	'settings.general.input.modifier': 'Modifier',
	'settings.general.input.always': 'Always',
	'settings.general.input.alwaysHelp':
		'Every send force-sends past a busy agent. No modifier required.',
	'settings.general.input.modifierHelp':
		'Use {shortcut} to force-send past a busy agent. A normal send queues as usual.',

	// Cross-agent mentions
	'settings.general.mentions.heading': 'Cross-Agent Mentions',
	'settings.general.mentions.description':
		'When you @-mention another agent, it answers from its own workspace. Read-Only makes that a {consult}: it reads and replies. Read/Write makes it a {delegation}: it can also change files. A {handoff} ("then send what you find to @agent") has its own switch below.',
	'settings.general.mentions.consult': 'consult',
	'settings.general.mentions.delegation': 'delegation',
	'settings.general.mentions.handoff': 'hand-off',
	'settings.general.mentions.consultOrDelegate': 'Consult or Delegate',
	'settings.general.mentions.delegateState':
		'Delegate: mentioned agents may modify files in their own workspace while answering.',
	'settings.general.mentions.consultState':
		'Consult: mentioned agents read to inform their answer but never modify files (the default and safest choice).',
	'settings.general.mentions.delegateWarning':
		'Every mention is now a delegation: the agent can change files on its own. Enable this only when you trust the mentioned agent to edit its workspace unattended.',
	'settings.general.mentions.handoffs': 'Hand-offs',
	'settings.general.mentions.handoffWriteState':
		'Read/Write: an agent handed a result ("then send what you find to @agent") may save it and change files in its own workspace (the default).',
	'settings.general.mentions.handoffReadState':
		'Read-Only: an agent handed a result reads it and replies, but never modifies files.',
	'settings.general.mentions.handoffWarning':
		"A hand-off forwards another agent's output, which can include text from the web. The receiving agent acts on it unattended.",

	// Auto Run limits
	'settings.general.autorun.inactivityHeading': 'Auto Run Inactivity Timeout',
	'settings.general.autorun.inactivityDescription':
		'Auto Run force-kills a task if the agent produces no output for this long. Increase for long refactors, heavy test runs, or web-research tasks driving a browser. Choose Unlimited to disable the inactivity watchdog; the Max Task Duration cap below still applies unless it is also set to Unlimited.',
	'settings.general.autorun.maxHeading': 'Auto Run Max Task Duration',
	'settings.general.autorun.maxDescription':
		'Absolute cap on how long a single task may run, regardless of output. Unlike the inactivity timeout, this also catches an agent that keeps emitting output but never finishes - which would otherwise hang the whole multi-document run. Choose Unlimited to disable the cap.',

	// Auto-resume
	'settings.general.resume.heading': 'Auto-Resume on Limit',
	'settings.general.resume.title': 'Resume paused sessions when token/API credits are available',
	'settings.general.resume.description':
		'Maestro probes every provider on a fixed interval and automatically resumes any queued work once the limit window reopens. Probing is cheap, so the give-up window is intentionally long.',
	'settings.general.resume.interval': 'Check for availability every (hours)',
	'settings.general.resume.giveUp': 'Give up after (days)',

	// History
	'settings.general.history.heading': 'Default History Toggle',
	'settings.general.history.title': 'Enable "History" by default for new tabs',
	'settings.general.history.description':
		'When enabled, new AI tabs will have the "History" toggle on by default, saving a synopsis after each completion',
	'settings.general.history.debounceHeading': 'Synopsis Debounce',
	'settings.general.history.debounceDescription':
		'Wait for the agent to be idle this long before generating a History synopsis. Rapid back-to-back completions are coalesced into a single synopsis once the conversation settles, and turns that did no real work (a plain question and answer with no tool use) are skipped entirely. Off generates a synopsis immediately after every completion.',
	'settings.general.history.cueHeading': 'Group Cue History Entries',
	'settings.general.history.cueTitle': 'Collapse repeated Cue runs into one History row',
	'settings.general.history.cueDescription':
		'A high-frequency trigger becomes a single row with its run count, the most recent run time, and a failure count. Expand the row to see the individual runs. Turn this off to list every Cue run separately.',

	// Thinking
	'settings.general.thinking.heading': 'Default Thinking Mode',
	'settings.general.thinking.title': 'Show AI thinking/reasoning content for new tabs',
	'settings.general.thinking.offState': 'Thinking hidden, only final responses shown',
	'settings.general.thinking.onState': 'Thinking streams live, clears on completion',
	'settings.general.thinking.stickyState': 'Thinking streams live and stays visible',
	'settings.general.thinking.sticky': 'Sticky',
	'settings.general.thinking.toolCalls': 'Show tool calls in responses',
	'settings.general.thinking.toolCallsDescription':
		'Display tool-call activity (tool badges and their input/output) in AI responses. Independent of the thinking mode above, so you can watch the reasoning chain without the tool noise. Agents still run tools normally either way.',
	'settings.general.thinking.toolCallsConversationsNote':
		'In the conversations view, tool calls are folded into the row above each answer, so this switch applies to the agents view only.',

	// Tab behavior
	'settings.general.tabs.heading': 'Tab Behavior',
	'settings.general.tabs.autoName': 'Automatically name tabs based on first message',
	'settings.general.tabs.autoNameDescription':
		'When you send your first message to a new tab, an AI will analyze it and generate a descriptive tab name. The naming request runs in parallel and leaves no history.',
	'settings.general.tabs.newTab': 'New tab placement',
	'settings.general.tabs.newTabDescription': 'Where new AI tabs appear in the tab bar.',
	'settings.general.tabs.newBrowserTab': 'New browser tab placement',
	'settings.general.tabs.newBrowserTabDescription': 'Where new browser tabs appear in the tab bar.',
	'settings.general.tabs.newTerminal': 'New terminal placement',
	'settings.general.tabs.newTerminalDescription': 'Where new terminal tabs appear in the tab bar.',
	'settings.general.tabs.openedFile': 'Opened file placement',
	'settings.general.tabs.openedFileDescription':
		'Where opened file preview tabs appear in the tab bar.',

	// Utility agent
	'settings.general.utility.heading': 'Utility Agent',
	'settings.general.utility.description':
		"Route auxiliary tasks (tab naming, context grooming) to a cheaper or faster agent instead of the session agent. Leave as Default to keep using each tab's own agent.",
	'settings.general.utility.agent': 'Agent',
	'settings.general.utility.defaultOption': 'Default (same as session)',
	'settings.general.utility.notInstalled': '(not installed)',
	'settings.general.utility.unverified': '(unverified)',
	'settings.general.utility.missing':
		'This agent is no longer available. Auxiliary tasks will fail until you pick another agent or return to Default.',
	'settings.general.utility.unverifiedNote':
		'Could not check installed agents. This selection is still in use.',
	'settings.general.utility.model': 'Model override',
	'settings.general.utility.modelPlaceholder':
		'e.g., haiku, gpt-4o-mini (leave empty for agent default)',

	// Spell check
	'settings.general.spell.heading': 'Spell Check',
	'settings.general.spell.title': 'Enable spell checking',
	'settings.general.spell.description':
		'Show spell check suggestions in input areas (prompt input, group chat, file editor). Disabled by default.',

	// Power
	'settings.general.power.heading': 'Power',
	'settings.general.power.preventSleep': 'Prevent sleep while working',
	'settings.general.power.preventSleepDescription':
		'Keeps your computer awake when AI agents are busy, Auto Run is active, or Cue pipelines are scheduled',
	'settings.general.power.display': 'Keep the display awake',
	'settings.general.power.displayDescription':
		'Also blocks the screen saver, the screen lock, and idle logout, so a long run stays on screen and you stay signed in',
	'settings.general.power.displayDisabledTitle':
		'Turn on "Prevent sleep while working" to use this',
	'settings.general.power.macWarning':
		'Warning: macOS reads a lit display as you sitting at the machine, so routine housekeeping stays parked while agents work - Spotlight indexing, Photos analysis, XProtect scans, Time Machine thinning, and background updates. In exchange the session stays active: no screen saver, no lock screen, no idle logout.',
	'settings.general.power.linuxNote':
		'Note: May have limited support on some Linux desktop environments.',

	// Rendering
	'settings.general.rendering.heading': 'Rendering Options',
	'settings.general.rendering.gpu': 'Disable GPU acceleration',
	'settings.general.rendering.gpuDescription':
		'Use software rendering instead of GPU. Requires restart to take effect.',
	'settings.general.rendering.confetti': 'Disable confetti animations',
	'settings.general.rendering.confettiDescription':
		'Skip celebratory confetti effects on achievements and milestones',

	// Updates
	'settings.general.updates.heading': 'Updates',
	'settings.general.updates.check': 'Check for updates automatically',
	'settings.general.updates.checkDescription':
		'Check for new Maestro versions on startup and once per day while the app is running. Also sends an anonymous check-in (a random install ID, app version, OS, and theme) so we can count active installs. Turning this off disables both.',
	'settings.general.updates.beta': 'Include beta and release candidate updates',
	'settings.general.updates.betaDescription':
		'Opt-in to receive pre-release versions (e.g., v0.11.1-rc, v0.12.0-beta). These may contain experimental features and bugs.',

	// Privacy
	'settings.general.privacy.heading': 'Privacy',
	'settings.general.privacy.title': 'Send anonymous crash reports',
	'settings.general.privacy.description':
		'Help improve Maestro by automatically sending crash reports. No personal data is collected. Changes take effect after restart.',

	// Browser
	'settings.general.browser.heading': 'Default Browser',
	'settings.general.browser.title': 'Use system browser for links',
	'settings.general.browser.description':
		'Controls the default browser for clicking links. Use {meta}+Click on URLs to get a context menu and choose the specific browser.',
	'settings.general.browser.htmlTitle': 'Open HTML files in Maestro Browser on double-click',
	'settings.general.browser.htmlDescription':
		'When enabled, double-clicking an HTML file in the file explorer opens it in the Maestro browser instead of the file preview. Right-click for the full menu either way.',
	'settings.general.browser.homeUrl': 'Browser Home URL',
	'settings.general.browser.homeUrlHelp':
		'The URL loaded when opening a new browser tab ({shortcut}). Blank by default, so a new tab opens ready for you to type an address instead of loading a page first.',
	'settings.general.browser.keepAlive': 'Background browser tabs',
	'settings.general.browser.keepAliveDescription':
		'An inactive browser tab is unloaded by default, so its page reloads and loses any in-memory state when you return. Keep recent or all tabs alive to preserve their state at the cost of memory (each live tab holds a full browser process).',
	'settings.general.browser.keepOff': 'Unload when inactive',
	'settings.general.browser.keepRecent': 'Keep recent alive',
	'settings.general.browser.keepAll': 'Keep all alive',
	'settings.general.browser.keepLimit': 'Keep this many recent tabs alive',

	// Storage
	'settings.general.storage.heading': 'Storage Location',
	'settings.general.storage.folder': 'Settings folder',
	'settings.general.storage.description':
		'Choose where Maestro stores settings, sessions, and groups (including global environment variables, agents, and configurations). Use a synced folder (iCloud Drive, Dropbox, OneDrive) to share across devices.',
	'settings.general.storage.note':
		'Note: Only run Maestro on one device at a time to avoid sync conflicts.',
	'settings.general.storage.defaultLocation': 'Default Location',
	'settings.general.storage.currentCustom': 'Current Location (Custom)',
	'settings.general.storage.migrating': 'Migrating...',
	'settings.general.storage.changeFolder': 'Change Folder...',
	'settings.general.storage.chooseFolder': 'Choose Folder...',
	'settings.general.storage.resetTitle': 'Reset to default location',
	'settings.general.storage.useDefault': 'Use Default',
	'settings.general.storage.migratedOne': 'Migrated {count} settings file',
	'settings.general.storage.migratedMany': 'Migrated {count} settings files',
	'settings.general.storage.restart': 'Restart Maestro for changes to take effect',
	'settings.general.storage.loadFailed': 'Failed to load storage settings',
	'settings.general.storage.changeFailed': 'Failed to change storage location',
	'settings.general.storage.resetFailed': 'Failed to reset storage location',
	'settings.ignore.errorEmpty': 'Pattern cannot be empty',
	'settings.ignore.errorExists': 'Pattern already exists',
	'settings.ignore.honorGitignore': 'Honor .gitignore',
	'settings.ignore.honorGitignoreDescription':
		'When enabled, patterns from .gitignore files will also be excluded from indexing.',
	'settings.ignore.active': 'Active patterns:',
	'settings.ignore.remove': 'Remove pattern',
	'settings.ignore.empty': 'No ignore patterns configured. All folders will be indexed.',
	'settings.ignore.placeholder': 'Enter glob pattern (e.g., node_modules, *.log)',
	'settings.ignore.reset': 'Reset to defaults ({defaults})',
	'settings.filePanel.title': 'File Panel Settings',
	'settings.filePanel.description':
		"Limits the indexer so huge directories don't blow up memory. Scans stop at the entry cap and the Files panel surfaces a warning with Load More / Load All.",
	'settings.filePanel.maxDepth': 'Max recursion depth',
	'settings.filePanel.maxDepthHelp':
		'Default {value}. Deeper scans see more but take longer and use more memory.',
	'settings.filePanel.maxEntries': 'Max file entries',
	'settings.filePanel.maxEntriesHelp':
		'Soft cap. Default {value}. Valid range {min} - {max}. The Files panel shows a Load More / Load All button when a scan hits this cap.',
	'settings.filePanel.sshReduce': 'Reduce entry cap on SSH remotes',
	'settings.filePanel.sshReduceDescription':
		'Apply a fraction of the cap to remote scans. Each directory walked over SSH is a separate round-trip, so a smaller cap returns sooner on large remote trees.',
	'settings.filePanel.sshFraction': 'SSH cap fraction',
	'settings.filePanel.sshFractionHelp':
		'{entries} × {percent} = {resolved} on SSH. Slider steps by 5%.',
	'settings.filePanel.reset': 'Reset to defaults (depth {depth}, {entries} entries)',
} as const;
