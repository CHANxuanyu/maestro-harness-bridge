import type { AgentAccountDirInput } from './agentAccountDir';

/** Native instruction export contract; the Markdown lives in conductorProfile. */
export type AboutMeProvider = 'claude-code' | 'codex';
export interface AboutMeTarget {
	path: string;
	provider: AboutMeProvider;
	agentIds?: string[];
	deepseek?: true;
}
export interface AboutMeConfirmation {
	path: string;
	resolvedPath: string;
	block: string | null;
}
export interface AboutMeApplied {
	provider: AboutMeProvider;
	resolvedPath: string;
	block: string | null;
}
export type AboutMeFileState =
	| 'synced'
	| 'pending'
	| 'unconfirmed'
	| 'external-change'
	| 'missing-directory'
	| 'invalid-block'
	| 'error';
export interface AboutMeFileStatus {
	path: string;
	aliases: string[];
	providers: AboutMeProvider[];
	agentIds: string[];
	deepseek?: true;
	resolvedPath?: string;
	currentBlock?: string | null;
	state: AboutMeFileState;
	shadowedBy: string[];
	error?: string;
}
export interface AboutMeNativeStatus {
	loaded: boolean;
	provider?: AboutMeProvider;
	path?: string;
	resolvedPath?: string;
	state?: AboutMeFileState;
	shadowedBy?: string[];
}

/** Preserve the profile's authority without duplicating its native managed body. */
export function nativeAboutMePointer(provider: AboutMeProvider): string {
	const file = provider === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
	return `The conductor's profile is in your global ${file}, between the maestro:about-me markers. It is not repeated here and keeps the authority described below.`;
}
export type AboutMeCommand =
	| { action: 'show' }
	| { action: 'status' }
	| { action: 'native'; agent: AgentAccountDirInput }
	| { action: 'set'; content: string }
	| { action: 'apply'; content: string; confirmations?: AboutMeConfirmation[] };
export interface AboutMeResult {
	success: boolean;
	content: string;
	estimatedTokens: number;
	files: AboutMeFileStatus[];
	native?: AboutMeNativeStatus;
	/** Files physically written by this apply, including a later metadata failure. */
	written?: string[];
	code?:
		| 'invalid-request'
		| 'profile-changed'
		| 'confirmation-required'
		| 'file-error'
		| 'persistence-failed'
		| 'unavailable';
	error?: string;
}
export type AboutMeCommandCallback = (command: AboutMeCommand) => Promise<AboutMeResult>;
