export default {
	'workflows.newShellCopy.composer.conversations': 'Conversations',
	'workflows.newShellCopy.composer.conversation': 'conversation',
	'workflows.newShellCopy.composer.conversationCountOne': 'conversation',
	'workflows.newShellCopy.composer.conversationsCount': 'conversations',
	'workflows.newShellCopy.composer.noConversations': 'No conversations available',
	'workflows.newShellCopy.composer.openConversation':
		'Open another conversation in the sidebar to consult it.',
	'workflows.newShellCopy.composer.onlyOne': '{names} answers. This conversation does not run.',
	'workflows.newShellCopy.composer.onlyMany': '{names} answer. This conversation does not run.',
	'workflows.newShellCopy.composer.onlyHint':
		'Move the mention later in the message to include this conversation.',
	'workflows.newShellCopy.composer.parallelOne':
		'{names} is consulted now. This conversation waits for the reply before finishing.',
	'workflows.newShellCopy.composer.parallelMany':
		'{names} are consulted now. This conversation waits for the replies before finishing.',
	'workflows.newShellCopy.composer.parallelHint':
		'Use "check with @Review first" to consult first, or "then send what you find to @Review" to pass on the answer. Replace @Review with a conversation name.',
	'workflows.newShellCopy.composer.firstOne':
		'{names} answers first. This conversation starts after the reply.',
	'workflows.newShellCopy.composer.firstMany':
		'{names} answer first. This conversation starts after the replies.',
	'workflows.newShellCopy.composer.firstHint':
		'Remove "first" or "based on what @Review says" to run both at once.',
	'workflows.newShellCopy.composer.handoff':
		'This conversation answers, then sends its answer to {names}.',
	'workflows.newShellCopy.composer.handoffHint':
		'The reply appears here without starting another turn. Remove "send it to" or "let @Review know" to run both at once.',
	'workflows.newShellCopy.composer.handoffLabel': 'Hand off',
	'workflows.newShellCopy.composer.fullHint':
		'Read, write, and run commands without confirmation. Questions from the tool are not shown in this mode.',
	'workflows.newShellCopy.composer.standardHint':
		'Use the tool’s default permissions. Approval requests and questions appear here. Unapproved edits and commands may be denied without a prompt.',
	'workflows.newShellCopy.composer.readonlyHint':
		'Explore and plan without writing files or running commands.',
	'workflows.newShellCopy.composer.planHint': 'Plan without changing files.',
	'workflows.newShellCopy.composer.toolReadonlyHint': 'Read files without changing them.',
	'workflows.newShellCopy.composer.plan': 'Plan mode',
	'workflows.newShellCopy.composer.readonly': 'Read only',
	'workflows.newShellCopy.composer.commandModeHint':
		'Run commands in the terminal without sending a message.',
	'workflows.newShellCopy.composer.commandPlaceholder':
		'Run a shell command. ! asks for a command. Esc returns to the conversation.',
	'workflows.newShellCopy.composer.draftTokens': 'About {tokens} tokens',
} as const;
