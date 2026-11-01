/** Native instruction export contract; the Markdown lives in conductorProfile. */
export type AboutMeProvider = 'claude-code' | 'codex';
export interface AboutMeTarget {
	path: string;
	provider: AboutMeProvider;
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
	resolvedPath?: string;
	currentBlock?: string | null;
	state: AboutMeFileState;
	shadowedBy: string[];
	error?: string;
}
export type AboutMeCommand =
	| { action: 'show' }
	| { action: 'status' }
	| { action: 'set'; content: string }
	| { action: 'apply'; content: string; confirmations?: AboutMeConfirmation[] };
export interface AboutMeResult {
	success: boolean;
	content: string;
	estimatedTokens: number;
	files: AboutMeFileStatus[];
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
