import type { TFunction } from '../../../i18n';

const PROMPT_TEXT_KEYS = {
	'Agent preambles': 'settings.extra.maestroPromptsTab.agentPreambles',
	Preview: 'settings.extra.promptText.preview',
	'Rendered, with template variables resolved':
		'settings.extra.promptText.renderedWithTemplateVariablesResolved',
	Edit: 'settings.extra.promptText.edit',
	'Syntax-highlighted source': 'settings.extra.promptText.syntaxHighlightedSource',
	'Auto Run': 'settings.extra.promptText.autoRun',
	Commands: 'settings.extra.promptText.commands',
	Context: 'settings.extra.promptText.context',
	'Group Chat': 'settings.extra.promptText.groupChat',
	Includes: 'settings.extra.promptText.includes',
	'Inline Wizard': 'settings.extra.promptText.inlineWizard',
	'Plugin Prompts': 'settings.extra.promptText.pluginPrompts',
	System: 'settings.extra.promptText.system',
	Wizard: 'settings.extra.promptText.wizard',
	'Prompts used by the Wizard feature for AI-guided conversations, document generation, and continuation flows.':
		'settings.extra.promptText.promptsUsedByTheWizardFeatureForAi',
	'Prompts for the Inline Wizard that operates within the editor - new sessions, iterations, and generation.':
		'settings.extra.promptText.promptsForTheInlineWizardThatOperatesWithin',
	'Prompts controlling Auto Run behavior - the default execution prompt and synopsis generation for Auto Run documents.':
		'settings.extra.promptText.promptsControllingAutoRunBehaviorTheDefaultExecution',
	'Prompts for Group Chat sessions - moderator system/synthesis prompts, participant behavior, and participant request formatting.':
		'settings.extra.promptText.promptsForGroupChatSessionsModeratorSystemSynthesis',
	'Prompts for context management - grooming (trimming context), transferring context between sessions, summarization, and handing a cross-agent consult reply back to the agent that asked.':
		'settings.extra.promptText.promptsForContextManagementGroomingTrimmingContextTransferring',
	'Prompts for built-in commands - image-only message handling and git commit message generation.':
		'settings.extra.promptText.promptsForBuiltInCommandsImageOnlyMessage',
	'Reusable blocks referenced from other prompts. Two directives consume them: {{INCLUDE:name}} fully inlines the content at assembly time (use for foundational rules every agent must have); {{REF:name}} expands to a one-line pointer that tells the agent to fetch it on demand via `maestro-cli prompts get <name>` (use for heavy reference material only some sessions need). Keeps shared content (history format, Auto Run spec, CLI reference, Cue model, file-access rules) in one place so every agent that needs it gets the same wording.':
		'settings.extra.promptText.reusableBlocksReferencedFromOtherPromptsTwoDirectives',
	"System-level prompts - the Maestro system context injected into agents, tab naming, Director's Notes, and feedback.":
		'settings.extra.promptText.systemLevelPromptsTheMaestroSystemContextInjected',
	'Read-only prompts contributed by installed plugins. Their content is owned by the plugin and cannot be edited here.':
		'settings.extra.promptText.readOnlyPromptsContributedByInstalledPluginsTheir',
	General: 'settings.extra.promptText.general',
	'Auto Run Only': 'settings.extra.promptText.autoRunOnly',
	'Cue Automation Only': 'settings.extra.promptText.cueAutomationOnly',
} as const;
const PROMPT_DESCRIPTION_KEYS = {
	'wizard-system': 'settings.extra.promptDescription.wizard-system',
	'wizard-system-continuation': 'settings.extra.promptDescription.wizard-system-continuation',
	'wizard-document-generation': 'settings.extra.promptDescription.wizard-document-generation',
	'wizard-inline-system': 'settings.extra.promptDescription.wizard-inline-system',
	'wizard-inline-iterate': 'settings.extra.promptDescription.wizard-inline-iterate',
	'wizard-inline-new': 'settings.extra.promptDescription.wizard-inline-new',
	'wizard-inline-iterate-generation':
		'settings.extra.promptDescription.wizard-inline-iterate-generation',
	'autorun-default': 'settings.extra.promptDescription.autorun-default',
	'autorun-goal': 'settings.extra.promptDescription.autorun-goal',
	'autorun-synopsis': 'settings.extra.promptDescription.autorun-synopsis',
	'autorun-per-task': 'settings.extra.promptDescription.autorun-per-task',
	'autorun-per-document': 'settings.extra.promptDescription.autorun-per-document',
	'image-only-default': 'settings.extra.promptDescription.image-only-default',
	'commit-command': 'settings.extra.promptDescription.commit-command',
	'ai-command': 'settings.extra.promptDescription.ai-command',
	'copilot-preamble': 'settings.extra.promptDescription.copilot-preamble',
	'maestro-system-prompt': 'settings.extra.promptDescription.maestro-system-prompt',
	'pianola-system': 'settings.extra.promptDescription.pianola-system',
	'group-chat-moderator-system': 'settings.extra.promptDescription.group-chat-moderator-system',
	'group-chat-moderator-synthesis':
		'settings.extra.promptDescription.group-chat-moderator-synthesis',
	'group-chat-participant': 'settings.extra.promptDescription.group-chat-participant',
	'group-chat-participant-request':
		'settings.extra.promptDescription.group-chat-participant-request',
	'group-chat-participant-continuation':
		'settings.extra.promptDescription.group-chat-participant-continuation',
	'context-grooming': 'settings.extra.promptDescription.context-grooming',
	'context-transfer': 'settings.extra.promptDescription.context-transfer',
	'context-summarize': 'settings.extra.promptDescription.context-summarize',
	'cross-agent-consult-pending': 'settings.extra.promptDescription.cross-agent-consult-pending',
	'cross-agent-consult-reply': 'settings.extra.promptDescription.cross-agent-consult-reply',
	'cross-agent-consult-first': 'settings.extra.promptDescription.cross-agent-consult-first',
	'cross-agent-handoff-pending': 'settings.extra.promptDescription.cross-agent-handoff-pending',
	'tab-naming': 'settings.extra.promptDescription.tab-naming',
	'director-notes': 'settings.extra.promptDescription.director-notes',
	feedback: 'settings.extra.promptDescription.feedback',
	'feedback-conversation': 'settings.extra.promptDescription.feedback-conversation',
	_toc: 'settings.extra.promptDescription._toc',
	'_interface-primitives': 'settings.extra.promptDescription._interface-primitives',
	'_documentation-index': 'settings.extra.promptDescription._documentation-index',
	'_history-format': 'settings.extra.promptDescription._history-format',
	'_autorun-playbooks': 'settings.extra.promptDescription._autorun-playbooks',
	'_maestro-cli': 'settings.extra.promptDescription._maestro-cli',
	'_maestro-cue': 'settings.extra.promptDescription._maestro-cue',
	'_desktop-instrumentation': 'settings.extra.promptDescription._desktop-instrumentation',
	'_file-access-rules': 'settings.extra.promptDescription._file-access-rules',
	'_file-access-wizard': 'settings.extra.promptDescription._file-access-wizard',
} as const;

export function localizePromptText(text: string, t: TFunction): string {
	const key = PROMPT_TEXT_KEYS[text as keyof typeof PROMPT_TEXT_KEYS];
	return key ? t(key) : text;
}

/** Description only; prompt source and third-party plugin content remain untouched. */
export function localizePromptDescription(
	prompt: { id: string; category: string; description: string } | undefined | null,
	t: TFunction
): string | undefined {
	if (!prompt) return undefined;
	if (prompt.category === 'plugin') return prompt.description;
	const key = PROMPT_DESCRIPTION_KEYS[prompt.id as keyof typeof PROMPT_DESCRIPTION_KEYS];
	return key ? t(key) : prompt.description;
}
