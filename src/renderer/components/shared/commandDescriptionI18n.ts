import { translate, type MessageKey, type TFunction } from '../../i18n';

interface DescribedCommand {
	id: string;
	command: string;
	description: string;
	isBuiltIn?: boolean;
	isCustom?: boolean;
}

const APP_COMMAND_DESCRIPTIONS = {
	'/commit': {
		id: 'commit',
		owner: 'isBuiltIn',
		key: 'settings.extra.commandDescription.commit',
	},
	'/speckit.help': {
		id: 'help',
		owner: 'isCustom',
		key: 'settings.extra.commandDescription.specKitHelp',
	},
	'/speckit.implement': {
		id: 'implement',
		owner: 'isCustom',
		key: 'settings.extra.commandDescription.specKitImplement',
	},
	'/openspec.help': {
		id: 'help',
		owner: 'isCustom',
		key: 'settings.extra.commandDescription.openSpecHelp',
	},
	'/openspec.implement': {
		id: 'implement',
		owner: 'isCustom',
		key: 'settings.extra.commandDescription.openSpecImplement',
	},
} as const satisfies Record<
	string,
	{ id: string; owner: 'isBuiltIn' | 'isCustom'; key: MessageKey }
>;

/** Translate only unchanged Maestro defaults for display, preserving stored command content. */
export function localizeAppCommandDescription(command: DescribedCommand, t: TFunction): string {
	const definition =
		APP_COMMAND_DESCRIPTIONS[command.command as keyof typeof APP_COMMAND_DESCRIPTIONS];
	return definition &&
		command.id === definition.id &&
		command[definition.owner] === true &&
		command.description === translate('en', definition.key)
		? t(definition.key)
		: command.description;
}
