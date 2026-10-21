/** First launch: welcome copy, the empty-state menu, and the onboarding series. */
export const onboarding = {
	// Welcome copy (empty state and tour intro)
	'workflows.welcome.title': 'Welcome to Maestro',
	'workflows.welcome.intro': 'Maestro is an orchestration tool designed to:',
	'workflows.welcome.goalParallelTitle': 'Manage multiple AI agents in parallel',
	'workflows.welcome.goalParallelBody':
		'Run several coding assistants simultaneously, each in their own session, switching between them effortlessly.',
	'workflows.welcome.goalAutoRunTitle': 'Enable unattended automation via Auto Run',
	'workflows.welcome.goalAutoRunBody':
		'Queue up task lists in markdown documents and let your agents execute them while you step away.',
	'workflows.welcome.howItWorksLabel': 'How it works:',
	'workflows.welcome.howItWorksBody':
		'Maestro is a pass-through to your AI provider. Your MCP tools, skills, and permissions work exactly as they do when running the provider directly.',
	'workflows.welcome.accessModes':
		'Agents default to Full Access mode with tool calls accepted automatically. Switch to Standard or Read Only mode via the toolbar for guardrails.',
	'workflows.welcome.getStarted':
		'To get started, create your first agent manually or with the help of the AI wizard.',
	'workflows.welcome.readMore': 'Read more at docs.runmaestro.ai/getting-started',

	// Empty state
	'workflows.emptyState.menu': 'Menu',
	'workflows.emptyState.wizard': 'New Agent Wizard',
	'workflows.emptyState.wizardHint': 'Get started with AI',
	'workflows.emptyState.tour': 'Take a Tour',
	'workflows.emptyState.tourHint': 'Learn the interface',
	'workflows.emptyState.shortcuts': 'Keyboard Shortcuts',
	'workflows.emptyState.checkUpdates': 'Check for Updates',
	'workflows.emptyState.checkUpdatesHint': 'Get the latest version',
	'workflows.emptyState.website': 'Maestro Website',
	'workflows.emptyState.websiteHint': 'Visit runmaestro.ai',
	'workflows.emptyState.docs': 'Documentation',
	'workflows.emptyState.docsHint': 'See usage docs on docs.runmaestro.ai',
	'workflows.emptyState.about': 'About Maestro',
	'workflows.emptyState.aboutHint': 'Version, Credits, Stats',
	'workflows.emptyState.createFirstAgent': 'Create your first agent',

	// Typography chooser
	'workflows.typography.titleReturning': 'Maestro has new typography',
	'workflows.typography.titleNew': 'Choose your typography',
	'workflows.typography.fineTune': 'Fine-tune in Settings',
	'workflows.typography.use': 'Use {name}',
	'workflows.typography.selected': 'Selected',
	'workflows.typography.monospace': 'Monospace',
	'workflows.typography.proportional': 'Proportional',
	'workflows.typography.introReturning':
		"We're changing the look of things a little bit. You've been using Hacker, which is monospace on every surface. The new Default keeps monospace where it earns its keep - the terminal, the file preview, and the editor - and uses a proportional face for the interface and the AI chat. Your current look is still here if you prefer it.",
	'workflows.typography.introNew':
		'Pick how Maestro should read. Default keeps monospace where it earns its keep - the terminal, the file preview, and the editor - and uses a proportional face for the interface and the AI chat. Hacker is monospace everywhere.',
	'workflows.typography.footnote':
		'This is a starting point, not a commitment. Settings → Display has a font picker for each surface on its own, plus font size, custom font names, and Up/Down to step through faces live.',
	'workflows.typography.preset.default': 'Default',
	'workflows.typography.preset.defaultTagline': 'Proportional to read, monospace to work.',
	'workflows.typography.preset.hacker': 'Hacker',
	'workflows.typography.preset.hackerTagline': 'Monospace everywhere. The original Maestro.',
	'workflows.typography.surface.interface': 'Interface',
	'workflows.typography.surface.aiChat': 'AI chat',
	'workflows.typography.surface.terminal': 'Terminal',
	'workflows.typography.surface.filePreview': 'File preview',
	'workflows.typography.surface.documentGraph': 'Document graph',
	'workflows.typography.surface.fileEditor': 'File editor',

	// Theme chooser
	'workflows.themeChoice.titleReturning': 'Make Maestro yours',
	'workflows.themeChoice.titleNew': 'Pick a theme',
	'workflows.themeChoice.customize': 'Customize in Settings',
	'workflows.themeChoice.choose': 'Choose {name}',
	'workflows.themeChoice.keep': 'Keep {name}',
	'workflows.themeChoice.switchTo': 'Switch to {name}',
	'workflows.themeChoice.thisTheme': 'this theme',
	'workflows.themeChoice.introReturning':
		"While we're here: you've been on the default theme since you installed Maestro. There are a few more, in dark and light. Click any of them to try it on - the whole app changes as you browse, and nothing is saved until you keep it.",
	'workflows.themeChoice.introNew':
		'Maestro ships with a set of themes, in dark and light. Click any of them to try it on - the whole app changes as you browse, and nothing is saved until you keep it.',
	'workflows.themeChoice.footnote':
		'You can change this whenever you like. Settings → Themes has every theme here, plus a Custom one you can set colour by colour.',
	'workflows.themeChoice.dark': 'Dark',
	'workflows.themeChoice.darkHint': 'Easy on the eyes for long sessions.',
	'workflows.themeChoice.light': 'Light',
	'workflows.themeChoice.lightHint': 'For bright rooms and shared screens.',
	'workflows.themeChoice.vibe': 'Vibe',
	'workflows.themeChoice.vibeHint': 'Louder palettes, for when the mood strikes.',

	// Updates chooser
	'workflows.updatesChoice.title': 'Stay on the Bleeding Edge',
	'workflows.updatesChoice.recommended': 'Recommended',
	'workflows.updatesChoice.intro':
		'If you want the most bleeding-edge features, we highly recommend opting into release candidates. And please leave crash reporting enabled: it helps us rapidly fix problems, automatically, as they are discovered.',
	'workflows.updatesChoice.autoCheck': 'Check for updates automatically',
	'workflows.updatesChoice.autoCheckDescription':
		'Check for new Maestro versions on startup and once per day while the app is running.',
	'workflows.updatesChoice.beta': 'Include beta and release candidate updates',
	'workflows.updatesChoice.betaDescription':
		'Get new features as soon as they ship, ahead of the stable release. Pre-releases can contain bugs.',
	'workflows.updatesChoice.crashReports': 'Send anonymous crash reports',
	'workflows.updatesChoice.crashReportsDescription':
		'Lets us find and fix problems as they happen. No personal data is collected. Takes effect after restart.',
	'workflows.updatesChoice.cliTitle': 'Maestro CLI',
	'workflows.updatesChoice.cliDescription':
		'The Maestro CLI can be used by humans, but it is really intended for your agents, so they can automate everything Maestro can do. We highly recommend installing it.',
	'workflows.updatesChoice.cliInstalled': 'Installed',
	'workflows.updatesChoice.cliInstalling': 'Installing...',
	'workflows.updatesChoice.cliChecking': 'Checking...',
	'workflows.updatesChoice.cliUpdate': 'Update Maestro CLI',
	'workflows.updatesChoice.cliInstall': 'Install Maestro CLI',
	'workflows.updatesChoice.footnote':
		'These are your current settings. You can change any of them later in Settings → General.',

	// Agent capabilities disclosure
	'workflows.agentPowers.title': 'Your Agents Can Drive Maestro',
	'workflows.agentPowers.confirm': 'Got it',
	'workflows.agentPowers.intro':
		'You just had the chance to set your typography and your theme by hand. Either way, anything you can do in Maestro, the agents inside it can do too - they reach the same controls the interface does, so you can simply ask.',
	'workflows.agentPowers.description':
		'Maestro is a power tool. If you are a hacker it will feel like home: keyboard shortcuts all the way down, dozens of agents conducted at once, hands never leaving the keys. You do not have to work that way to get the benefit. Every agent running in Maestro is handed the knowledge of how to drive Maestro, down to the advanced parts like Auto Run and Cue pipelines, so ask for what you want in plain language and let the agent find the way there.',
	'workflows.agentPowers.tryExample': 'Pick an example above to drop it into the composer.',
	'workflows.agentPowers.settings.label': 'Change Any Setting',
	'workflows.agentPowers.settings.prompt':
		'Set my AI chat font to Inter, switch me to a light theme, and turn on OS notifications.',
	'workflows.agentPowers.agents.label': 'Create Agents',
	'workflows.agentPowers.agents.prompt':
		'Create a new agent called Scratch pointed at my home directory.',
	'workflows.agentPowers.autoRun.label': 'Write an Auto Run Doc',
	'workflows.agentPowers.autoRun.prompt':
		'Write me an Auto Run document that reviews this repo for TODOs and lists them as tasks.',
	'workflows.agentPowers.schedule.label': 'Schedule a Task',
	'workflows.agentPowers.schedule.prompt':
		'Every weekday at 9am, summarize what changed in this repo overnight.',
	'workflows.agentPowers.pipeline.label': 'Build a Cue Pipeline',
	'workflows.agentPowers.pipeline.prompt':
		'Whenever a pull request opens on this repo, have an agent review it and report back.',
	'workflows.agentPowers.dashboard.label': 'Build Me a Dashboard',
	'workflows.agentPowers.dashboard.prompt':
		'Build me an HTML dashboard of this repo: commits per week, top contributors, open TODOs.',
} as const;
