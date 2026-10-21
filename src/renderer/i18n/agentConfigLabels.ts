import type { MessageKey, TFunction } from './translate';

// These are Maestro-owned provider setting descriptions. Unknown extension text
// stays as supplied; model ids, option values and native commands never enter this map.
const AGENT_CONFIG_LABELS: Readonly<Record<string, MessageKey>> = {
	Model: 'workflows.sessions.agentConfig.modelLabel',
	'Model override (e.g., "sonnet", "opus", "haiku", or full name like "claude-sonnet-4-6"). Leave empty to use the default.':
		'workflows.sessions.agentConfig.claudeModelHelp',
	Effort: 'workflows.sessions.agentConfig.effortLabel',
	'How much effort the model should put into its response.':
		'workflows.sessions.agentConfig.effortHelp',
	'Model override (e.g., gpt-5.3-codex, o3). Leave empty to use the default from ~/.codex/config.toml.':
		'workflows.sessions.agentConfig.codexModelHelp',
	'Reasoning Effort': 'workflows.sessions.agentConfig.reasoningEffortLabel',
	'How much the model should reason before responding.':
		'workflows.sessions.agentConfig.reasoningEffortHelp',
	'Reasoning Summary': 'workflows.sessions.agentConfig.reasoningSummaryLabel',
	'Request readable Codex reasoning summaries for the Thinking display. Default follows the Codex CLI and model; some providers do not support summaries.':
		'workflows.sessions.agentConfig.reasoningSummaryHelp',
	'Model to use. Auto lets Gemini route between Pro and Flash based on task complexity.':
		'workflows.sessions.agentConfig.geminiModelHelp',
	'Context Window Size': 'workflows.sessions.agentConfig.contextWindowLabel',
	'Maximum context window size in tokens. Common values: 1048576 (Gemini 2.5 Pro), 32767 (Gemini 2.5 Flash).':
		'workflows.sessions.agentConfig.geminiContextHelp',
	'Model slug override (e.g., gemini-3.6-flash-high). Leave empty to use the CLI default. Run `agy --help` for the slugs your account can reach.':
		'workflows.sessions.agentConfig.antigravityModelHelp',
	'Headless Timeout': 'workflows.sessions.agentConfig.headlessTimeoutLabel',
	'Maximum time a single headless run may take (Go duration, e.g. 30m, 2h). The CLI default of 5m cuts off longer agent runs.':
		'workflows.sessions.agentConfig.headlessTimeoutHelp',
	'Maximum context window size in tokens. Gemini 3.x models expose a 1M window.':
		'workflows.sessions.agentConfig.antigravityContextHelp',
	'Model passed to -m. Qwen Code is multi-provider, so any model id works (e.g. coder-model, qwen3-coder-plus, qwen3.5-plus, or an OpenAI-compatible id like openai/gpt-4o). Leave blank for the account/plan default.':
		'workflows.sessions.agentConfig.qwenModelHelp',
	'Maximum context window size in tokens. Qwen3-Coder supports a native 256K (262144) context window.':
		'workflows.sessions.agentConfig.qwenContextHelp',
	'Documented Hermes model override (for example, anthropic/claude-sonnet-4-20250514). Leave empty for the CLI default.':
		'workflows.sessions.agentConfig.hermesModelHelp',
	'Fallback context window size in tokens until Hermes reports a runtime-specific value.':
		'workflows.sessions.agentConfig.hermesContextHelp',
	'Documented Pi model override (for example, claude-sonnet-4.5). Leave empty for the CLI default.':
		'workflows.sessions.agentConfig.piModelHelp',
	'Fallback context window size in tokens until Pi reports a runtime-specific value.':
		'workflows.sessions.agentConfig.piContextHelp',
	'Fuzzy model override passed to --model (for example, opus, gpt-5.2, or openai/gpt-5.2). Multi-provider; leave empty for the CLI default.':
		'workflows.sessions.agentConfig.ompModelHelp',
	'Fallback context window size in tokens until Oh My Pi reports a runtime-specific value.':
		'workflows.sessions.agentConfig.ompContextHelp',
	'Model to use (e.g., "ollama/qwen3:8b", "anthropic/claude-sonnet-4-20250514"). Leave empty for default.':
		'workflows.sessions.agentConfig.opencodeModelHelp',
	'Maximum context window size in tokens. Required for context usage display. Varies by model (e.g., 400000 for Claude/GPT-5.2, 128000 for GPT-4o).':
		'workflows.sessions.agentConfig.opencodeContextHelp',
	'Model to use for Factory Droid': 'workflows.sessions.agentConfig.factoryModelHelp',
	'How much the model should reason before responding':
		'workflows.sessions.agentConfig.factoryEffortHelp',
	'Maximum context window in tokens (for UI display)':
		'workflows.sessions.agentConfig.factoryContextHelp',
	'Model to use. Pickable from models.dev catalog or type a custom model name. Leave empty for default.':
		'workflows.sessions.agentConfig.copilotModelHelp',
	'Maximum context window size in tokens. Required for context usage display. Varies by model.':
		'workflows.sessions.agentConfig.copilotContextHelp',
	'Reasoning budget for models that support it (GPT-5 Codex, o-series). Leave empty to use the model default. Non-reasoning models ignore this flag.':
		'workflows.sessions.agentConfig.copilotEffortHelp',
	'Model to use (see `grok models`). Leave empty for the default model (grok-4.5).':
		'workflows.sessions.agentConfig.grokModelHelp',
	"How much the model should reason before responding. Leave empty for the model default (high). Note: 'none' is model-dependent - the default model (grok-4.5) rejects it; grok-composer-2.5-fast accepts it.":
		'workflows.sessions.agentConfig.grokEffortHelp',
	'Maximum context window size in tokens. 500000 for grok-4.5, 200000 for grok-composer-2.5-fast.':
		'workflows.sessions.agentConfig.grokContextHelp',
};

export function localizeAgentConfigLabel(text: string, t: TFunction): string {
	const key = AGENT_CONFIG_LABELS[text];
	return key ? t(key) : text;
}
