import type { ClaudeTokenSourceFields } from './claudeTokenMode';

/** Product choices; DeepSeek still runs on the Claude Code harness. */
export const HANDOFF_PROVIDERS = ['claude-code', 'codex', 'deepseek'] as const;
export type HandoffProvider = (typeof HANDOFF_PROVIDERS)[number];
export const DEFAULT_HANDOFF_BUDGET = 8000;

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
	sessionSshRemoteConfig?: { enabled?: boolean };
}

export interface HandoffRequest {
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
	sourceAgentId: string;
	sourceTabId: string;
	provider: HandoffProvider;
	budgetTokens?: number;
	instruction?: string;
}

export interface HandoffSourceSnapshot {
	sourceAgentId: string;
	sourceTabId: string;
	projectPath: string;
	groupId?: string;
	draft: HandoffDraft;
}

export interface HandoffOpenRequest {
	sourceAgentId: string;
	provider: HandoffProvider;
	runnerId?: string;
	projectPath: string;
	groupId?: string;
	config: HandoffRunnerConfig & { toolType: 'claude-code' | 'codex' };
	draft: HandoffDraft;
	send: boolean;
	background: boolean;
}

export interface HandoffResult {
	success: boolean;
	error?: string;
	code?: 'invalid-request' | 'unavailable' | 'persistence-failed' | 'queue-failed';
	/** Also returned on a failed save/send when a recoverable draft was created. */
	agentId?: string;
	tabId?: string;
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
	| { action: 'targets'; sourceAgentId: string }
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
	if (request.instruction !== undefined && typeof request.instruction !== 'string')
		return 'The handoff instruction must be text';
	if (
		(request.send !== undefined && typeof request.send !== 'boolean') ||
		(request.background !== undefined && typeof request.background !== 'boolean')
	)
		return 'Send and background must be boolean values';
	return null;
}
