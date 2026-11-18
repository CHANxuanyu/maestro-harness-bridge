import { withMaestroClient } from '../services/maestro-client';
import { failCommand } from '../services/session-command';
import { getProviderProfileConfig } from '../../shared/providerProfiles';
import {
	visibleCatalogModels,
	type ModelCatalogRequest,
	type ProviderModelCatalog,
} from '../../shared/modelCatalog';

/** Read through the desktop's account resolution, file cache and quota stores. */
export async function modelsCommand(
	provider: string,
	options: { json?: boolean; agent?: string; accountDir?: string; sshRemote?: string }
): Promise<void> {
	try {
		if (provider !== 'codex' && provider !== 'claude-code')
			throw new Error('Provider must be codex or claude-code');
		if (options.agent && options.accountDir) throw new Error('Choose --agent or --account-dir');
		const request: ModelCatalogRequest = {
			provider,
			sessionId: options.agent,
			sshRemoteId: options.sshRemote,
			account: options.accountDir
				? { customEnvVars: { [getProviderProfileConfig(provider)!.envVar]: options.accountDir } }
				: undefined,
		};
		const catalog = await withMaestroClient(async (client) => {
			const response = await client.sendCommand<{
				ok: boolean;
				result: ProviderModelCatalog;
				error?: string;
			}>(
				{ type: 'bridge.invoke', channel: 'agents:getModelCatalog', args: [request] },
				'bridge.response'
			);
			if (!response.ok) throw new Error(response.error ?? 'Model catalog read failed');
			return response.result;
		});
		if (options.json) console.log(JSON.stringify(catalog));
		else {
			console.log(
				`Follow default: ${catalog.followDefault.modelId ?? 'unresolved'} (${catalog.followDefault.source})`
			);
			console.log(
				`Source: ${catalog.source.kind}${catalog.stale ? ' (stale)' : ''}${catalog.error ? `, ${catalog.error}` : ''}`
			);
			for (const model of visibleCatalogModels(catalog))
				console.log(
					`${model.id}\t${model.displayName}\t${model.description}\t${catalog.effortLabel}: ${model.efforts.map((effort) => effort.id).join(', ')}${model.defaultEffort ? ` (default: ${model.defaultEffort})` : ''}`
				);
			for (const window of catalog.quota?.windows ?? [])
				console.log(
					`${window.label ?? window.id}: ${window.remainingPercent}% remaining${window.resetsAt ? `, resets ${window.resetsAt}` : ''}${catalog.quota?.stale ? ' (stale)' : ''}`
				);
		}
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
