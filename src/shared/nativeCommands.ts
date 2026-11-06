import type { AgentSshRemoteConfig } from './types';

export interface NativeCommandContext {
	toolType: string;
	cwd: string;
	customEnvVars?: Record<string, string>;
	sessionSshRemoteConfig?: AgentSshRemoteConfig;
}
export type NativeCommandRequest = NativeCommandContext | { sessionId: string; tabId: string };

export interface NativeCommand {
	command: string;
	description: string;
	prompt?: string;
	source: 'builtin' | 'project' | 'user';
}
export interface NativeCommandSnapshot {
	commands: NativeCommand[];
	warning?: 'unavailable' | 'remote-unavailable';
}

export const CLAUDE_BUILTIN_COMMANDS: Record<string, string> = {
	compact: 'Summarize conversation to reduce context usage',
	context: 'Show current context window usage',
	cost: 'Show session cost and token usage',
	init: 'Initialize CLAUDE.md with codebase info',
	'pr-comments': 'Address PR review comments',
	'release-notes': 'Generate release notes from changes',
	todos: 'Find and list TODO comments in codebase',
	review: 'Review code changes',
	'security-review': 'Review code for security issues',
	plan: 'Create an implementation plan',
};

export function nativeBuiltinCommands(toolType: string): NativeCommand[] {
	return toolType === 'claude-code'
		? Object.entries({ help: 'Show available commands', ...CLAUDE_BUILTIN_COMMANDS }).map(
				([name, description]) => ({ command: `/${name}`, description, source: 'builtin' })
			)
		: [];
}
