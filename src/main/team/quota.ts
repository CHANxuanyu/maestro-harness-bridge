import { resolveAgentAccountDir } from '../../shared/agentAccountDir';
import {
	effectiveAgentCustomEnvVars,
	resolveAgentBillingCredential,
} from '../../shared/providerProfiles';
import type { SeatConfig } from '../../shared/team/types';
import { getAgentAccountDirLayers } from '../agents/provider-account-dirs';
import { getSnapshot } from '../stores/claudeUsageStore';
import { getAllCodexUsageSnapshots } from '../stores/codexUsageStore';

export interface TeamQuotaSample {
	sampledAt: number;
	exhausted: boolean;
	resetsAt?: number;
	login?: boolean;
	detail?: string;
}

/** Cached, account-specific observations only. Reading quota never spends a model turn. */
export function teamQuotaSample(
	config: SeatConfig,
	providerEnv: Record<string, string> | undefined,
	now: number
): TeamQuotaSample | undefined {
	const env = effectiveAgentCustomEnvVars(config.customEnv, providerEnv);
	if (resolveAgentBillingCredential(config.tool, env)) return;
	const dir = resolveAgentAccountDir(
		{ toolType: config.tool, customEnvVars: env },
		getAgentAccountDirLayers(config.tool)
	);
	if (!dir) return;
	const sample =
		config.tool === 'claude-code'
			? getSnapshot(dir)
			: config.tool === 'codex'
				? getAllCodexUsageSnapshots()[dir]
				: undefined;
	if (!sample) return;
	const sampledAt = Date.parse(sample.sampledAt);
	const login = sample.authState === 'unauthenticated' || sample.authState === 'missing_auth';
	const windows =
		'weekAllModels' in sample
			? [sample.session, sample.weekAllModels]
			: [sample.session, sample.weekly];
	const exhausted = windows.filter(
		(w) =>
			w &&
			w.percent >= 100 &&
			(!w.resetsAt || !Number.isFinite(Date.parse(w.resetsAt)) || Date.parse(w.resetsAt) > now)
	);
	const resets = exhausted.map((w) => (w?.resetsAt ? Date.parse(w.resetsAt) : NaN));
	return {
		sampledAt,
		exhausted: login || exhausted.length > 0,
		login,
		resetsAt: resets.length && resets.every(Number.isFinite) ? Math.max(...resets) : undefined,
		detail: login
			? `${config.tool} login expired for this seat account`
			: `${config.tool} quota sample reports an exhausted window`,
	};
}
