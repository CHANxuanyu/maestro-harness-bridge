import {
	getClaudeTokenMode,
	isMaestroPBinaryPath,
	type ClaudeTokenModeSource,
} from './claudeTokenMode';
import type { AgentCapabilities } from './types';

/** Prototype eligibility only; an already running exec turn never gains RPC controls. */
export function codexAppServerEnabled(
	capabilities: Pick<AgentCapabilities, 'supportsCodexAppServer'> | undefined,
	settings: { newShell?: boolean; codexAppServer?: boolean },
	remote = false
): boolean {
	return (
		capabilities?.supportsCodexAppServer === true &&
		settings.newShell === true &&
		settings.codexAppServer === true &&
		!remote
	);
}

/** Standard mode is available only when the chosen transport can relay approvals. */
export function effectiveStandardPermissionCapability(
	capabilities:
		| Pick<AgentCapabilities, 'supportsStandardPermissionMode' | 'supportsCodexAppServer'>
		| undefined,
	settings: { newShell?: boolean; codexAppServer?: boolean },
	remote = false,
	claudeTokenSource?: ClaudeTokenModeSource & { customPath?: string }
): boolean {
	if (
		settings.newShell &&
		capabilities?.supportsStandardPermissionMode &&
		(remote ||
			getClaudeTokenMode(claudeTokenSource) !== 'api' ||
			isMaestroPBinaryPath(claudeTokenSource?.customPath))
	)
		return false;
	return (
		capabilities?.supportsStandardPermissionMode === true ||
		codexAppServerEnabled(capabilities, settings, remote)
	);
}

/** Shared with the renderer catalogs because spawn refusals originate in main. */
export const CODEX_APP_SERVER_MESSAGES = {
	en: {
		'workflows.shell.codexAppServerApprovalUnavailable':
			'Codex approvals are unavailable for this caller. Use the owning desktop window or its trusted CLI.',
		'workflows.shell.codexAppServerStandardRequired':
			'Codex standard permission requires the local app-server prototype. Enable the new interface and prototype, or explicitly select read-only permission.',
		'workflows.shell.codexAppServerCustomArgsUnsupported':
			'The Codex app-server prototype does not support custom CLI arguments. Remove them before starting this turn.',
	},
	'zh-CN': {
		'workflows.shell.codexAppServerApprovalUnavailable':
			'此调用方不能处理 Codex 审批。请在所属桌面窗口或其可信 CLI 中操作。',
		'workflows.shell.codexAppServerStandardRequired':
			'Codex 标准权限需要开启本地交互通路原型。请开启新界面和原型开关，或明确改用只读权限。',
		'workflows.shell.codexAppServerCustomArgsUnsupported':
			'Codex 交互通路原型暂不支持自定义命令行参数，请清空后再发送。',
	},
} as const;
