import {
	resolveTabEntry,
	sendSimpleCommand,
	reportResult,
	failCommand,
} from '../services/session-command';
import { isHandoffProvider, type HandoffCommandResult } from '../../shared/aiHandoff';
import { resolveBackgroundFlag } from '../../shared/focusPlacement';

interface HandoffOptions {
	agent?: string;
	listTargets?: boolean;
	send?: boolean;
	maxTokens?: string;
	instruction?: string;
	background?: boolean;
	focus?: boolean;
	json?: boolean;
}

export async function handoff(
	tab: string,
	provider: string | undefined,
	options: HandoffOptions
): Promise<void> {
	if (options.listTargets && (provider !== undefined || options.send))
		return failCommand('--list-targets cannot be combined with a target or --send', options.json);
	if (!options.listTargets && !isHandoffProvider(provider))
		return failCommand(
			'Choose claude-code, codex or deepseek, or use --list-targets',
			options.json
		);
	const budgetTokens = options.maxTokens === undefined ? undefined : Number(options.maxTokens);
	if (budgetTokens !== undefined && (!Number.isSafeInteger(budgetTokens) || budgetTokens <= 0))
		return failCommand('--max-tokens must be a positive integer', options.json);
	try {
		const source = await resolveTabEntry(tab, options.agent);
		const payload = options.listTargets
			? {
					type: 'ai_handoff',
					action: 'targets',
					sourceAgentId: source.agentId,
				}
			: {
					type: 'ai_handoff',
					action: 'prepare',
					sourceAgentId: source.agentId,
					sourceTabId: source.tabId,
					targetProvider: provider,
					budgetTokens,
					instruction: options.instruction,
					send: options.send === true,
					background: resolveBackgroundFlag(options, 'handoff'),
				};
		const result = await sendSimpleCommand<HandoffCommandResult>(payload, 'ai_handoff_result');
		if (options.json) {
			reportResult({ ...result }, { json: true, successMessage: '', jsonResult: { ...result } });
			return;
		}
		if (!result.success) return failCommand(result.error ?? 'Handoff failed');
		if ('targets' in result) {
			for (const target of result.targets ?? [])
				console.log(`${target.provider}${target.runnerId ? `\t${target.runnerId}` : ''}`);
		} else if ('draft' in result) {
			console.log(
				`Agent: ${result.agentId}\nTab: ${result.tabId}\nState: ${result.state}\nEstimated tokens: ${result.draft?.estimatedTokens}\n\n${result.draft?.text}`
			);
		}
	} catch (error) {
		return failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
