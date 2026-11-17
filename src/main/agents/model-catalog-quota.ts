import { summarizeQuotaWindows, type QuotaSummary } from '../../shared/usageQuota';
import type { ModelCatalogProvider } from '../../shared/modelCatalog';
import { getRetainedSnapshots, SNAPSHOT_TTL_MS } from '../stores/claudeUsageStore';
import {
	getRetainedCodexUsageSnapshots,
	CODEX_USAGE_SNAPSHOT_TTL_MS,
} from '../stores/codexUsageStore';

/** Reads only existing samples. accountDir is the canonical effective account root. */
export function cachedModelCatalogQuota(
	provider: ModelCatalogProvider,
	accountDir: string,
	sshRemoteId?: string
): QuotaSummary | undefined {
	if (sshRemoteId) return undefined;
	if (provider === 'codex') {
		const snapshot = getRetainedCodexUsageSnapshots()[accountDir];
		if (!snapshot || snapshot.authState !== 'authenticated') return undefined;
		return summarizeQuotaWindows(
			snapshot.sampledAt,
			Date.now() - Date.parse(snapshot.sampledAt) > CODEX_USAGE_SNAPSHOT_TTL_MS,
			[
				{ id: 'session', window: snapshot.session },
				{ id: 'weekly', window: snapshot.weekly },
				...(snapshot.additionalLimits ?? []).map((window, index) => ({
					id: `additional:${index}`,
					label: window.name,
					window,
				})),
			]
		);
	}
	const snapshot = getRetainedSnapshots()[accountDir];
	if (!snapshot || snapshot.authState === 'unauthenticated') return undefined;
	return summarizeQuotaWindows(
		snapshot.sampledAt,
		Date.now() - Date.parse(snapshot.sampledAt) > SNAPSHOT_TTL_MS,
		[
			{ id: 'session', window: snapshot.session },
			{ id: 'weekAllModels', window: snapshot.weekAllModels },
			{
				id: 'weekSonnetOnly',
				label: snapshot.weekSonnetOnly?.label,
				window: snapshot.weekSonnetOnly,
			},
		]
	);
}
