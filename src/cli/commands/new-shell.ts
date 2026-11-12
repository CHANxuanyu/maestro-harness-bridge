import type { Command } from 'commander';
import { projectSettingsTranslator } from './project-settings';
import path from 'node:path';
import {
	sendSimpleCommand,
	failCommand,
	resolveAgentOrFail,
	resolveTabEntry,
	reportResult,
} from '../services/session-command';
import { readSessions } from '../services/storage';
import { PROJECT_CONVERSATION_TIMEOUT_MS } from '../../shared/projectSettings';

/** All new shell verbs use one owner-routed, acknowledged renderer command. */
export async function newShellCommand(
	sessionId: string,
	request: Record<string, unknown>,
	json?: boolean
): Promise<{ success: boolean } & Record<string, unknown>> {
	const result = await sendSimpleCommand<{
		success: boolean;
		error?: string;
		data?: Record<string, unknown>;
	}>(
		{ type: 'update_session_config', sessionId, configPatch: { newShellCommand: request } },
		'update_session_config_result',
		PROJECT_CONVERSATION_TIMEOUT_MS + 5000
	);
	if (!result.success)
		return failCommand(
			result.error || projectSettingsTranslator()('workflows.cliParity.commandFailed'),
			json
		);
	return { success: true, ...result.data };
}

export async function sidebarSearch(
	text: string | undefined,
	options: { clear?: boolean; agent?: string; json?: boolean }
) {
	try {
		if ((options.clear && text !== undefined) || (!options.clear && text === undefined))
			throw new Error(projectSettingsTranslator()('workflows.cliParity.searchUsage'));
		const result = await newShellCommand(
			options.agent ? resolveAgentOrFail(options.agent, options.json) : 'active',
			{ action: 'sidebar-search', text: options.clear ? '' : text },
			options.json
		);
		console.log(options.json ? JSON.stringify(result) : String(result.query));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}

export async function tabLiveRead(
	action: 'tasks' | 'refresh',
	tabId: string,
	options: { agent?: string; json?: boolean }
) {
	try {
		const tab = await resolveTabEntry(tabId, options.agent);
		const result = await newShellCommand(tab.agentId, { action, tabId: tab.tabId }, options.json);
		console.log(JSON.stringify(result, null, options.json ? undefined : 2));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}

export async function projectSettingsSurface(options: {
	path?: string;
	close?: boolean;
	agent?: string;
	json?: boolean;
}) {
	try {
		const projectPath = options.path ? path.resolve(options.path) : undefined;
		const owners = projectPath
			? readSessions().filter((s) => (s.projectRoot || s.cwd) === projectPath)
			: [];
		if (projectPath && !owners.length)
			throw new Error(projectSettingsTranslator()('workflows.cliParity.projectMissing'));
		const sessionId = options.agent
			? resolveAgentOrFail(options.agent, options.json)
			: (owners[0]?.id ?? 'active');
		const result = await newShellCommand(
			sessionId,
			{
				action: 'project-settings',
				...(projectPath ? { path: projectPath } : {}),
				...(options.close ? { close: true } : {}),
			},
			options.json
		);
		reportResult(result, {
			json: options.json,
			successMessage: projectSettingsTranslator()(
				options.close ? 'workflows.cliParity.closedSettings' : 'workflows.cliParity.openedSettings'
			),
			jsonResult: result,
		});
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}

export async function queueForceSend(itemId: string, options: { agent?: string; json?: boolean }) {
	try {
		const owner = options.agent ? resolveAgentOrFail(options.agent, options.json) : undefined;
		const result = await newShellCommand(
			owner ?? 'active',
			{ action: 'force-send', itemId },
			options.json
		);
		console.log(JSON.stringify(result));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}

/** Extend the existing Commander tree; tests exercise this same registration. */
export function registerNewShellCli(program: Command): void {
	const t = projectSettingsTranslator();
	const tab = program.commands.find((command) => command.name() === 'tab');
	const queue = program.commands.find((command) => command.name() === 'queue');
	const history = program.commands.find((command) => command.name() === 'native-history');
	const open = program.commands.find((command) => command.name() === 'open');
	const create = tab?.commands.find((command) => command.name() === 'new');
	if (!tab || !queue || !history || !open || !create) throw new Error('Missing CLI command group');
	history
		.description(t('workflows.cliParity.nativeHelp'))
		.option('--message <locator>', t('workflows.cliParity.messageHelp'));
	open
		.option('--path <project>', t('workflows.cliParity.pathHelp'))
		.option('--close', t('workflows.cliParity.closeHelp'))
		.option('-a, --agent <id>', t('workflows.cliParity.ownerHelp'));
	create
		.option('--split', t('workflows.cliParity.splitHelp'))
		.option('--ratio <fraction>', t('workflows.cliParity.ratioHelp'));
	for (const action of ['tasks', 'refresh'] as const) {
		tab
			.command(`${action} <tab-id>`)
			.description(t(`workflows.cliParity.${action}Help`))
			.option('-a, --agent <id>', t('workflows.cliParity.ownerHelp'))
			.option('--json', t('workflows.cliParity.jsonHelp'))
			.action((id, options) => tabLiveRead(action, id, options));
	}
	program
		.command('ui')
		.command('sidebar-search [text]')
		.description(t('workflows.cliParity.sidebarHelp'))
		.option('--clear', t('workflows.cliParity.clearHelp'))
		.option('-a, --agent <id>', t('workflows.cliParity.ownerHelp'))
		.option('--json', t('workflows.cliParity.jsonHelp'))
		.action(sidebarSearch);
	queue
		.command('force-send <item-id>')
		.description(t('workflows.cliParity.forceHelp'))
		.option('-a, --agent <id>', t('workflows.cliParity.ownerHelp'))
		.option('--json', t('workflows.cliParity.jsonHelp'))
		.action(queueForceSend);
}
