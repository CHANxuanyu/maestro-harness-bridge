/** Everyday confirm, rename, create and delete dialogs, plus shared modal chrome. */
export const dialogs = {
	'workflows.shared.closeModal': 'Close modal',

	'workflows.renameAgent.title': 'Rename Agent',
	'workflows.renameAgent.placeholder': 'Enter agent name...',

	'workflows.renameTab.title': 'Rename Tab',
	'workflows.renameTab.placeholder': 'Enter tab name...',
	'workflows.renameTab.placeholderWithId': 'Rename {id}...',
	'workflows.renameTab.auto': 'Auto',
	'workflows.renameTab.autoTitle': 'Auto-rename ({keys})',

	'workflows.group.renameTitle': 'Rename Group',
	'workflows.group.createTitle': 'Create New Group',
	'workflows.group.nameLabel': 'Group Name',
	'workflows.group.namePlaceholder': 'Enter group name...',
	'workflows.group.insideFolder': 'Inside folder',
	'workflows.group.topLevel': 'Top level',

	'workflows.deleteAgent.title': 'Confirm Delete',
	'workflows.deleteAgent.agentOnly': 'Agent Only',
	'workflows.deleteAgent.agentAndDirectory': 'Agent + Working Directory',
	'workflows.deleteAgent.danger': 'Danger:',
	'workflows.deleteAgent.warning':
		'You are about to delete the agent "{name}". This action cannot be undone.',
	'workflows.deleteAgent.directoryNote':
		'{option} will also move the working directory to the trash:',
	'workflows.deleteAgent.typeNamePrompt':
		'Enter agent name below to enable working directory deletion:',
	'workflows.deleteAgent.typeNameLabel': 'Confirm agent name',

	'workflows.deleteGroupChat.title': 'Delete Group Chat',
	'workflows.deleteGroupChat.question': 'Are you sure you want to delete "{name}"?',
	'workflows.deleteGroupChat.detail':
		'This will permanently delete the group chat and all its messages. Participant sessions will not be affected.',
	'workflows.renameGroupChat.title': 'Rename Group Chat',
	'workflows.renameGroupChat.label': 'Chat Name',
	'workflows.renameGroupChat.placeholder': 'Enter new name...',

	'workflows.newAgentChoice.title': 'New Agent',
	'workflows.newAgentChoice.manual': 'Manual Setup',
	'workflows.newAgentChoice.manualDescription':
		'Choose your agent, working directory, and configuration options directly.',
	'workflows.newAgentChoice.guided': 'Guided Setup',
	'workflows.newAgentChoice.guidedDescription':
		'Walk through an interactive wizard that analyzes your project and creates a tailored playbook.',
	'workflows.newAgentChoice.noteLabel': 'Note:',
	'workflows.newAgentChoice.note':
		'The guided wizard captures application inputs until complete. For a lighter touch, create an agent manually then run {command} or click the {icon} button in the Auto Run panel. The in-tab wizard runs alongside your other work.',
} as const;
