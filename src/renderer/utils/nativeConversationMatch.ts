/**
 * Which native history record an open tab IS, and which runner may open a record.
 *
 * One rule set, shared by the Left Bar tree (merging an open tab into its
 * history row), the open service (reusing a runner) and the sidebar's
 * remembered rows, so the three cannot disagree about identity.
 *
 * A native conversation is identified by main's `record.key`: provider + host +
 * transcript POOL (account) + native id. The same native id can exist in two
 * account pools, so provider + host + id is NOT an identity. The renderer
 * cannot always tell which pool a runner reads (a runner on the default
 * account sets no env var), so evidence is graded:
 *
 *  - main's `ownerId` naming this runner, or the runner's own explicit account
 *    env var equal to the record's `accountDir`, is proof;
 *  - an explicit env var naming a DIFFERENT dir is a contradiction;
 *  - anything else is unknown. Unknown merges only when exactly one record
 *    could be meant; with several candidates it merges nothing (no false merge).
 */

import type { Session } from '../types';
import type { ProjectHistoryConversation } from '../../shared/projectHistory';
import { getProviderProfileConfig } from '../../shared/providerProfiles';

export type AccountEvidence = 'same' | 'different' | 'unknown';

/** What the renderer knows about one runner's account. */
export interface RunnerAccount {
	id: string;
	provider: string;
	/** SSH remote id, or undefined for local. */
	host?: string;
	/** The runner's own explicit env vars (its account override, if any). */
	env?: Record<string, string>;
}

export function sessionHost(session: Session): string | undefined {
	const ssh = session.sessionSshRemoteConfig;
	return ssh?.enabled ? ssh.remoteId || session.sshRemoteId || undefined : undefined;
}

export function runnerAccount(session: Session): RunnerAccount {
	return {
		id: session.id,
		provider: session.toolType,
		host: sessionHost(session),
		env: session.customEnvVars,
	};
}

function normalizeDir(value: string): string {
	const trimmed = value.trim().replace(/[\\/]+$/, '');
	return trimmed || value.trim();
}

/** The env var that selects this provider's account home. */
export function accountEnvVarFor(
	provider: string,
	record?: { accountEnvVar?: string }
): string | undefined {
	return record?.accountEnvVar || getProviderProfileConfig(provider)?.envVar;
}

/** Whether a runner reads the record's transcript pool, as far as the renderer can tell. */
export function accountEvidence(
	runner: RunnerAccount,
	record: Pick<ProjectHistoryConversation, 'provider' | 'accountDir' | 'accountEnvVar' | 'ownerId'>
): AccountEvidence {
	// The runner's own explicit account wins, even over main's hint.
	const explicit = explicitAccountEvidence(runner, record);
	if (explicit !== 'unknown') return explicit;
	if (record.ownerId && record.ownerId === runner.id) return 'same';
	return 'unknown';
}

function explicitAccountEvidence(
	runner: RunnerAccount,
	record: Pick<ProjectHistoryConversation, 'provider' | 'accountDir' | 'accountEnvVar'>
): AccountEvidence {
	if (!record.accountDir) return 'unknown';
	const envVar = accountEnvVarFor(record.provider, record);
	const raw = envVar ? runner.env?.[envVar] : undefined;
	// No override: default account or a provider-level setting. Not knowable here.
	if (!raw || !raw.trim()) return 'unknown';
	const value = normalizeDir(raw);
	const dir = normalizeDir(record.accountDir);
	if (value === dir) return 'same';
	// `~/x` can only be checked against the tail of an absolute dir.
	if (value.startsWith('~')) return dir.endsWith(value.slice(1)) ? 'same' : 'unknown';
	return 'different';
}

function sameHost(a?: string | null, b?: string | null): boolean {
	return (a || null) === (b || null);
}

/**
 * The history record an open tab on `nativeSessionId` corresponds to, or null
 * when none can be named without guessing between account pools.
 */
export function matchRecordForTab(
	runner: RunnerAccount,
	nativeSessionId: string,
	records: readonly ProjectHistoryConversation[]
): ProjectHistoryConversation | null {
	const candidates = records.filter(
		(record) =>
			record.provider === runner.provider &&
			record.nativeSessionId === nativeSessionId &&
			sameHost(record.sshRemoteId, runner.host)
	);
	if (candidates.length === 0) return null;
	const evidence = candidates.map((record) => accountEvidence(runner, record));
	const proven = candidates.filter((_, index) => evidence[index] === 'same');
	if (proven.length >= 1) return proven[0];
	if (candidates.length === 1 && evidence[0] === 'unknown') return candidates[0];
	return null;
}

/**
 * Identity for an open tab that matched no record: same provider, host,
 * explicit account (or "unspecified") and native id is one conversation.
 */
export function openTabIdentity(runner: RunnerAccount, nativeSessionId: string): string {
	const envVar = accountEnvVarFor(runner.provider);
	const raw = envVar ? runner.env?.[envVar] : undefined;
	const account = raw && raw.trim() ? normalizeDir(raw) : '';
	return JSON.stringify(['open', runner.provider, runner.host ?? '', account, nativeSessionId]);
}

/**
 * Whether a runner may open this record: same provider and host, and no
 * explicit account contradicting the record's pool. `requireProof` is for a
 * runner main did NOT name, where "unknown" is not good enough.
 */
export function runnerCanOpenRecord(
	runner: RunnerAccount,
	record: ProjectHistoryConversation,
	requireProof: boolean
): boolean {
	if (runner.provider !== record.provider || !sameHost(runner.host, record.sshRemoteId))
		return false;
	const evidence = accountEvidence(runner, record);
	if (evidence === 'different') return false;
	if (requireProof && record.accountDir) return evidence === 'same';
	return true;
}
