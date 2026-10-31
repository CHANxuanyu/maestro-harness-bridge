// Create agent command - create a new agent in the Maestro desktop app.
//
// Selects the new agent, as it always has. Pass --background to create it
// without moving the Left Bar selection; the agent is still created and listed.

import * as path from 'path';
import { readFileSync } from 'node:fs';
import { withMaestroClient } from '../services/maestro-client';
import { formatError, formatSuccess } from '../output/formatter';
import { AGENT_IDS } from '../../shared/agentIds';
import { parseCliBool } from '../utils/parse';
import { resolveBackgroundFlag } from '../../shared/focusPlacement';
import { validateDeepSeekPreset } from '../../shared/agentPresets';
import { failCommand } from '../services/session-command';

const VALID_TYPES: Set<string> = new Set(AGENT_IDS.filter((id) => id !== 'terminal'));

interface CreateAgentOptions {
	preset?: string;
	apiKeyEnv?: string;
	apiKeyStdin?: boolean;
	cwd: string;
	type: string;
	group?: string;
	nudge?: string;
	newSessionMessage?: string;
	customPath?: string;
	customArgs?: string;
	env?: string[];
	model?: string;
	effort?: string;
	contextWindow?: string;
	providerPath?: string;
	sshRemote?: string;
	sshCwd?: string;
	syncHistoryToRemote?: string;
	autoRunFolder?: string;
	background?: boolean;
	focus?: boolean;
	json?: boolean;
}

export async function createAgent(name: string, options: CreateAgentOptions): Promise<void> {
	if (!VALID_TYPES.has(options.type)) {
		const msg = `Invalid agent type "${options.type}". Must be one of: ${[...VALID_TYPES].join(', ')}`;
		if (options.json) {
			console.log(JSON.stringify({ success: false, error: msg }));
		} else {
			console.error(formatError(msg));
		}
		process.exit(1);
	}

	const cwd = path.resolve(options.cwd);

	// Parse --env KEY=VALUE pairs into a Record
	let customEnvVars: Record<string, string> | undefined;
	if (options.env && options.env.length > 0) {
		customEnvVars = {};
		for (const entry of options.env) {
			const eqIndex = entry.indexOf('=');
			if (eqIndex === -1) {
				if (options.preset)
					return failCommand('Invalid --env format. Expected KEY=VALUE', options.json);
				const msg = `Invalid --env format "${entry}". Expected KEY=VALUE`;
				if (options.json) {
					console.log(JSON.stringify({ success: false, error: msg }));
				} else {
					console.error(formatError(msg));
				}
				process.exit(1);
			}
			customEnvVars[entry.slice(0, eqIndex)] = entry.slice(eqIndex + 1);
		}
	}

	// Read preset credentials without putting their value into CLI arguments.
	let presetApiKey: string | undefined;
	if (options.preset !== undefined || options.apiKeyEnv !== undefined || options.apiKeyStdin) {
		try {
			if (
				options.preset !== 'deepseek' ||
				options.type !== 'claude-code' ||
				options.sshRemote ||
				options.customArgs
			) {
				throw new Error('The DeepSeek preset requires local Claude Code without custom arguments');
			}
			if (Boolean(options.apiKeyEnv) === Boolean(options.apiKeyStdin)) {
				throw new Error('Choose exactly one of --api-key-env or --api-key-stdin');
			}
			if (options.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.apiKeyEnv)) {
				throw new Error('--api-key-env takes an environment variable name, not a key');
			}
			presetApiKey = options.apiKeyStdin
				? readFileSync(0, 'utf8').trim()
				: (process.env[options.apiKeyEnv!] ?? '');
			validateDeepSeekPreset({ apiKey: presetApiKey, model: options.model, customEnvVars });
		} catch (error) {
			return failCommand(error instanceof Error ? error.message : String(error), options.json);
		}
	}

	// Parse context window
	let customContextWindow: number | undefined;
	if (options.contextWindow !== undefined) {
		customContextWindow = parseInt(options.contextWindow, 10);
		if (isNaN(customContextWindow) || customContextWindow < 1) {
			const msg = '--context-window must be a positive integer';
			if (options.json) {
				console.log(JSON.stringify({ success: false, error: msg }));
			} else {
				console.error(formatError(msg));
			}
			process.exit(1);
		}
	}

	// Parse --sync-history-to-remote (maps to sessionSshRemoteConfig.syncHistory,
	// the field behind the "Sync history to remote" checkbox in the UI).
	let syncHistory: boolean | undefined;
	if (options.syncHistoryToRemote !== undefined) {
		try {
			syncHistory = parseCliBool(options.syncHistoryToRemote, '--sync-history-to-remote');
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (options.json) {
				console.log(JSON.stringify({ success: false, error: msg }));
			} else {
				console.error(formatError(msg));
			}
			process.exit(1);
		}
	}

	// Build SSH config if provided. `--sync-history-to-remote` only takes effect
	// alongside an SSH remote (it syncs history to the remote host), so it is
	// folded into the config block rather than standing on its own.
	let sessionSshRemoteConfig:
		| {
				enabled: boolean;
				remoteId: string | null;
				workingDirOverride?: string;
				syncHistory?: boolean;
		  }
		| undefined;
	if (options.sshRemote) {
		sessionSshRemoteConfig = {
			enabled: true,
			remoteId: options.sshRemote,
			workingDirOverride: options.sshCwd,
			syncHistory,
		};
	} else if (syncHistory !== undefined) {
		const msg = '--sync-history-to-remote requires --ssh-remote';
		if (options.json) {
			console.log(JSON.stringify({ success: false, error: msg }));
		} else {
			console.error(formatError(msg));
		}
		process.exit(1);
	}

	// Build the WebSocket message payload
	const background = resolveBackgroundFlag(options, 'create-agent');
	const payload: Record<string, unknown> = {
		// An older desktop must reject an unknown preset command, rather than
		// silently dropping its fields and creating a regular Claude agent.
		type: options.preset ? 'create_preset_session' : 'create_session',
		name,
		toolType: options.type,
		cwd,
		groupId: options.group,
		background,
	};

	// Add optional config fields
	if (options.preset) {
		payload.preset = options.preset;
		payload.presetApiKey = presetApiKey;
	}
	if (options.nudge) payload.nudgeMessage = options.nudge;
	if (options.newSessionMessage) payload.newSessionMessage = options.newSessionMessage;
	if (options.customPath) payload.customPath = options.customPath;
	if (options.customArgs) payload.customArgs = options.customArgs;
	if (customEnvVars) payload.customEnvVars = customEnvVars;
	if (options.model) payload.customModel = options.model;
	if (options.effort) payload.customEffort = options.effort;
	if (customContextWindow !== undefined) {
		payload.customContextWindow = customContextWindow;
		// Typing `--context-window` is unambiguously a deliberate choice, exactly as
		// it is on `update-agent` (finding AD1, review of PR #1362). Without this the
		// same flag on the same CLI produced two different outcomes: a scripted
		// create with a lowered budget was silently overridden by the provider's
		// report and had to be re-applied with `update-agent` to stick.
		payload.contextWindowSource = 'user-edited';
	}
	if (options.providerPath) payload.customProviderPath = options.providerPath;
	if (sessionSshRemoteConfig) payload.sessionSshRemoteConfig = sessionSshRemoteConfig;
	if (options.autoRunFolder) payload.autoRunFolderPath = path.resolve(options.autoRunFolder);

	try {
		const result = await withMaestroClient(async (client) => {
			return client.sendCommand<{
				type: string;
				success: boolean;
				sessionId?: string;
				error?: string;
			}>(payload, 'create_session_result');
		});

		if (result.success) {
			if (options.json) {
				console.log(
					JSON.stringify({
						success: true,
						agentId: result.sessionId,
						name,
						type: options.type,
						background,
					})
				);
			} else {
				console.log(
					formatSuccess(
						`Created agent "${name}" (${options.type})${background ? ' in the background' : ''}`
					)
				);
				console.log(`  ID: ${result.sessionId}`);
				console.log(`  CWD: ${cwd}`);
			}
		} else {
			const msg = result.error || 'Failed to create agent';
			if (options.json) {
				console.log(JSON.stringify({ success: false, error: msg }));
			} else {
				console.error(formatError(msg));
			}
			process.exit(1);
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (options.json) {
			console.log(JSON.stringify({ success: false, error: msg }));
		} else {
			console.error(formatError(msg));
		}
		process.exit(1);
	}
}
