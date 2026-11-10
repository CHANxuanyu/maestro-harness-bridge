import type { AgentId } from './agentIds';
import type { AgentSshRemoteConfig } from './types';
import { normalizeWorktreePath } from './worktreePaths';
import type { ClaudeTokenSourceFields } from './claudeTokenMode';

/** Product choices; DeepSeek still runs on the Claude Code harness. */
export const HANDOFF_PROVIDERS = ['claude-code', 'codex', 'deepseek'] as const;
export type HandoffProvider = (typeof HANDOFF_PROVIDERS)[number];
export const DEFAULT_HANDOFF_BUDGET = 8000;

export interface ConversationOrigin {
	kind: 'handoff' | 'review' | 'subtask';
	sourceSessionId: string;
	sourceTabId: string;
	sourceProvider: string;
	/** Display title captured in the source window, retained after the source closes. */
	sourceTitle?: string;
	/** Source native ID, retained after its tab closes. */
	sourceNativeSessionId?: string;
	createdAt: number;
}

export interface HandoffDraft {
	text: string;
	estimatedTokens: number;
	budgetTokens: number;
	omittedEntries: number;
	omittedCharacters: number;
}

/**
 * What a draft tab remembers about its handoff, for the note above its
 * composer. Stamped when the draft tab is opened, so a draft made from the CLI
 * explains itself the same way as one made from the dialog. The draft text
 * itself lives only in the composer.
 */
export interface HandoffDraftNote extends Omit<HandoffDraft, 'text'> {
	sourceAgentId: string;
	/** Source agent's name and provider, when the opening window knows the agent. */
	sourceName?: string;
	sourceProvider?: string;
}

export interface HandoffRunnerConfig extends ClaudeTokenSourceFields {
	customPath?: string;
	customArgs?: string;
	customEnvVars?: Record<string, string>;
	customEnvVarsDisabled?: Record<string, string>;
	customModel?: string;
	customEffort?: string;
	customContextWindow?: number;
	contextWindowSource?: 'user-edited';
	customProviderPath?: string;
	nudgeMessage?: string;
	newSessionMessage?: string;
}

export interface HandoffRunner extends HandoffRunnerConfig {
	id: string;
	name: string;
	toolType: string;
	projectRoot: string;
	cwd: string;
	groupId?: string;
	sessionSshRemoteConfig?: AgentSshRemoteConfig;
}

export type HandoffMode = 'handoff' | 'review';

export interface HandoffRequest {
	mode?: HandoffMode;
	sourceAgentId: string;
	sourceTabId: string;
	targetProvider: HandoffProvider;
	budgetTokens?: number;
	instruction?: string;
	/** Only a literal true authorizes sending. Absent means draft. */
	send?: boolean;
	background?: boolean;
}

export interface HandoffReadRequest {
	/** Read live delegation identity with its permission, without transcript content. */
	delegation?: boolean;
	/** Read permission metadata only; an empty tab id selects the latest project conversation. */
	permissionOnly?: boolean;
	/** Read a draft for a tool change in the source owner. */
	emptyConversation?: boolean;
	mode?: HandoffMode;
	sourceAgentId: string;
	sourceTabId: string;
	provider: HandoffProvider;
	budgetTokens?: number;
	instruction?: string;
}

export interface HandoffSourceSnapshot {
	sourceProvider?: string;
	sourcePermission?: { permissionMode: 'full' | 'standard' | 'readonly'; readOnlyMode: boolean };
	sourceDefaults?: {
		customModel?: string;
		customEffort?: string;
		customEnvVars?: Record<string, string>;
	};
	emptyConversation?: { stagedImages?: string[]; commandMode?: 'off' | 'shell' | 'ai' };
	sourceTitle?: string;
	cwd: string;
	sessionSshRemoteConfig?: AgentSshRemoteConfig;
	sourceNativeSessionId?: string;
	sourceAgentId: string;
	sourceTabId: string;
	projectPath: string;
	groupId?: string;
	draft: HandoffDraft;
}

export interface HandoffOpenRequest {
	/** Captured in the source owner, including when the target lives in another window. */
	sourcePermission?: HandoffSourceSnapshot['sourcePermission'];
	sourceDefaults?: HandoffSourceSnapshot['sourceDefaults'];
	permissionCeiling?: HandoffSourceSnapshot['sourcePermission'];
	newConversation?: {
		origin?: ConversationOrigin;
		/** An explicit CLI prompt, delivered by the target owner after persistence. */
		prompt?: string;
		sourceTabId?: string;
		replaceTabId?: string;
		/** Supplied by the source owner across windows. The target must retain the source. */
		source?: NonNullable<HandoffSourceSnapshot['emptyConversation']>;
	};
	cwd: string;
	sessionSshRemoteConfig?: AgentSshRemoteConfig;
	mode: HandoffMode;
	origin: ConversationOrigin;
	sourceAgentId: string;
	provider: string;
	runnerId?: string;
	projectPath: string;
	groupId?: string;
	config: HandoffRunnerConfig & { toolType: AgentId };
	draft: HandoffDraft;
	send: boolean;
	background: boolean;
}

export interface HandoffResult {
	permissionMode?: 'full' | 'standard' | 'readonly';
	readOnlyMode?: boolean;
	mode?: HandoffMode;
	success: boolean;
	error?: string;
	code?: 'invalid-request' | 'unavailable' | 'persistence-failed' | 'queue-failed';
	/** Also returned on a failed save/send when a recoverable draft was created. */
	agentId?: string;
	tabId?: string;
	title?: string;
	createdAgent?: boolean;
	state?: 'draft' | 'queued';
	draft?: HandoffDraft;
}

export interface HandoffTargetsResult extends Pick<HandoffResult, 'success' | 'error' | 'code'> {
	targets?: Array<{ provider: HandoffProvider; runnerId?: string }>;
}

export type HandoffReadResult =
	| HandoffSourceSnapshot
	| Pick<HandoffResult, 'success' | 'error' | 'code'>
	| null;
export type HandoffCommand =
	| { action: 'targets'; sourceAgentId: string; includeCurrent?: boolean; localOnly?: boolean }
	| {
			action: 'new-conversation';
			origin?: ConversationOrigin;
			sourceAgentId: string;
			/** Omitted means the source tool resolved from its effective provider environment. */
			targetProvider?: string;
			replaceTabId?: string;
			sourceTabId?: string;
			prompt?: string;
			sourcePermission?: HandoffSourceSnapshot['sourcePermission'];
			background?: boolean;
	  }
	| ({ action: 'prepare' } & HandoffRequest);
export type HandoffCommandResult = HandoffResult | HandoffTargetsResult;
export type HandoffCommandCallback = (request: HandoffCommand) => Promise<HandoffCommandResult>;

export function isHandoffProvider(value: unknown): value is HandoffProvider {
	return (HANDOFF_PROVIDERS as readonly unknown[]).includes(value);
}

/** Validate at the IPC/CLI boundary, before extracting content or creating a tab. */
export function handoffRequestError(request: HandoffRequest): string | null {
	if (
		!request ||
		typeof request.sourceAgentId !== 'string' ||
		!request.sourceAgentId ||
		typeof request.sourceTabId !== 'string' ||
		!request.sourceTabId ||
		!isHandoffProvider(request.targetProvider)
	)
		return 'A source agent, source tab and supported target provider are required';
	if (
		request.budgetTokens !== undefined &&
		(!Number.isSafeInteger(request.budgetTokens) || request.budgetTokens <= 0)
	)
		return 'The handoff budget must be a positive integer';
	if (request.mode !== undefined && request.mode !== 'handoff' && request.mode !== 'review')
		return 'Mode must be handoff or review';
	if (request.instruction !== undefined && typeof request.instruction !== 'string')
		return 'The handoff instruction must be text';
	if (
		(request.send !== undefined && typeof request.send !== 'boolean') ||
		(request.background !== undefined && typeof request.background !== 'boolean')
	)
		return 'Send and background must be boolean values';
	return null;
}

/** Host and execution directory, never the sidebar project grouping. */
export function handoffLocation(runner: {
	cwd: string;
	sessionSshRemoteConfig?: AgentSshRemoteConfig;
}): { cwd: string; key: string } {
	const ssh = runner.sessionSshRemoteConfig;
	if (ssh?.enabled && !ssh.remoteId) throw new Error('SSH is enabled but no remote is configured');
	const cwd = ssh?.enabled ? ssh.workingDirOverride || runner.cwd : runner.cwd;
	if (!cwd?.trim()) throw new Error('The source working directory is missing');
	const posix = ssh?.enabled || cwd.startsWith('/');
	const normalized = normalizeWorktreePath(cwd, posix);
	return {
		cwd,
		key: `${ssh?.enabled ? `ssh:${ssh.remoteId}` : 'local'}\0${posix ? normalized : normalized.toLowerCase()}`,
	};
}
