import type { Command } from 'commander';
import { readCallerIdentity } from '../../shared/agentDelegation';
import type {
	AutomationAction,
	ConversationAutomationState,
} from '../../shared/conversationAutomation';
import { DURATION_MS } from '../../shared/duration';
import { failCommand, sendSimpleCommand } from '../services/session-command';
import { projectSettingsTranslator } from './project-settings';

export interface AutomationOptions {
	agent?: string;
	tab?: string;
	json?: boolean;
	totalMinutes?: string;
	waitMinutes?: string;
	reason?: string;
	after?: string;
	process?: string;
	ci?: string;
	cwd?: string;
}

export async function automationCommand(
	action: AutomationAction,
	options: AutomationOptions
): Promise<void> {
	const t = projectSettingsTranslator();
	try {
		const caller = readCallerIdentity(process.env);
		const sessionId = options.agent ?? caller?.agentId;
		const tabId = options.tab ?? caller?.tabId;
		if (action.action === 'status' && !sessionId && !tabId) {
			const reply = await sendSimpleCommand<{
				ok: boolean;
				result: ConversationAutomationState[];
				error?: string;
			}>(
				{ type: 'bridge.invoke', channel: 'conversationAutomation:list', args: [] },
				'bridge.response'
			);
			if (!reply.ok) throw new Error(reply.error ?? t('workflows.automation.requestFailed'));
			console.log(JSON.stringify(reply.result, null, options.json ? undefined : 2));
			return;
		}
		if (!sessionId || !tabId) throw new Error(t('workflows.automation.cliTarget'));
		const reply = await sendSimpleCommand<{
			ok: boolean;
			result: ConversationAutomationState;
			error?: string;
		}>(
			{
				type: 'bridge.invoke',
				channel: 'conversationAutomation:execute',
				args: [{ ...action, target: { kind: 'conversation', sessionId, tabId }, caller }],
			},
			'bridge.response'
		);
		if (!reply.ok) throw new Error(reply.error ?? t('workflows.automation.requestFailed'));
		console.log(JSON.stringify(reply.result, null, options.json ? undefined : 2));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}

export function automationOptions(command: Command): Command {
	const t = projectSettingsTranslator();
	return command
		.option('--agent <id>', t('workflows.automation.cliAgent'))
		.option('--tab <id>', t('workflows.automation.cliTab'))
		.option('--json', t('workflows.automation.cliJson'));
}

export function registerFollowUpCommand(program: Command): void {
	const t = projectSettingsTranslator();
	const group = program.command('follow-up').description(t('workflows.automation.followUps'));
	automationOptions(group.command('add').description(t('workflows.automation.addFollowUp')))
		.requiredOption('--reason <text>', t('workflows.automation.reason'))
		.option('--after <seconds>', t('workflows.automation.after'))
		.option('--process <id>', t('workflows.automation.process'))
		.option('--ci <run-id>', t('workflows.automation.ci'))
		.option('--cwd <path>', t('workflows.automation.cwd'))
		.option('--total-minutes <minutes>', t('workflows.automation.totalLimit'))
		.option('--wait-minutes <minutes>', t('workflows.automation.singleWait'))
		.action(async (options: AutomationOptions) => {
			if (
				[options.after, options.process, options.ci].filter((value) => value !== undefined)
					.length !== 1
			)
				return failCommand(t('workflows.automation.cliCondition'), options.json);
			await automationCommand(
				{
					action: 'follow-add',
					reason: options.reason!,
					condition: options.process
						? { kind: 'command', processId: options.process }
						: options.ci
							? { kind: 'ci', runId: options.ci, cwd: options.cwd ?? process.cwd() }
							: { kind: 'time', at: Date.now() + Number(options.after) * DURATION_MS.second },
					...(options.totalMinutes !== undefined
						? { totalMs: Number(options.totalMinutes) * DURATION_MS.minute }
						: {}),
					...(options.waitMinutes !== undefined
						? { waitLimitMs: Number(options.waitMinutes) * DURATION_MS.minute }
						: {}),
				},
				options
			);
		});
	automationOptions(group.command('list').description(t('workflows.automation.followUps'))).action(
		(options) => automationCommand({ action: 'status' }, options)
	);
	automationOptions(
		group.command('cancel <id>').description(t('workflows.automation.cancel'))
	).action((id, options) => automationCommand({ action: 'follow-cancel', id }, options));
	automationOptions(group.command('extend').description(t('workflows.automation.extend'))).action(
		(options) => automationCommand({ action: 'extend' }, options)
	);
	automationOptions(group.command('stop').description(t('workflows.automation.stop'))).action(
		(options) => automationCommand({ action: 'stop' }, options)
	);
}
