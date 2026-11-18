import type { Command } from 'commander';
import { automationCommand, automationOptions } from './follow-up';
import { DURATION_MS } from '../../shared/duration';
import { failCommand } from '../services/session-command';
import { projectSettingsTranslator } from './project-settings';

export function registerChecksCommand(program: Command): void {
	const t = projectSettingsTranslator();
	const group = program.command('checks').description(t('workflows.automation.checks'));
	automationOptions(group.command('set').description(t('workflows.automation.saveChecks')))
		.option('--command <command...>', t('workflows.automation.commands'))
		.action((options) =>
			automationCommand({ action: 'checks-set', commands: options.command ?? [] }, options)
		);
	for (const action of ['run', 'status'] as const)
		automationOptions(
			group
				.command(action)
				.description(
					t(action === 'run' ? 'workflows.automation.runChecks' : 'workflows.automation.checks')
				)
		).action((options) =>
			automationCommand({ action: action === 'run' ? 'checks-run' : 'status' }, options)
		);
	automationOptions(
		group.command('authorize <choice>').description(t('workflows.automation.projectPermission'))
	)
		.option('--check <id>', t('workflows.automation.checkId'))
		.action((choice, options) => {
			if (!['project', 'once', 'reject'].includes(choice))
				return failCommand(t('workflows.automation.cliChoice'), options.json);
			return automationCommand({ action: 'authorize', choice, checkId: options.check }, options);
		});
	automationOptions(group.command('fix <mode>').description(t('workflows.automation.fixQuestion')))
		.option('--total-minutes <minutes>', t('workflows.automation.totalLimit'))
		.action((mode, options) => {
			if (!['auto', 'manual'].includes(mode))
				return failCommand(t('workflows.automation.cliChoice'), options.json);
			return automationCommand(
				{
					action: 'fix',
					mode,
					...(options.totalMinutes !== undefined
						? { totalMs: Number(options.totalMinutes) * DURATION_MS.minute }
						: {}),
				},
				options
			);
		});
	automationOptions(
		group.command('answer <option>').description(t('workflows.automation.answer'))
	).action((option, options) =>
		automationCommand({ action: 'answer', option: Number(option) }, options)
	);
	automationOptions(group.command('plan').description(t('workflows.automation.attemptLedger')))
		.requiredOption('--proposal <json>', t('workflows.automation.proposal'))
		.action((options) => {
			try {
				return automationCommand(
					{ action: 'plan', proposal: JSON.parse(options.proposal) },
					options
				);
			} catch {
				return failCommand(t('workflows.automation.cliJsonInvalid'), options.json);
			}
		});
}
