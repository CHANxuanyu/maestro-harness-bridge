import React from 'react';
import { useT } from '../../i18n';
import { ThemedSelect } from '../shared/ThemedSelect';
import { DEEPSEEK_PRESET } from '../../../shared/agentPresets';
import type { Theme } from '../../types';

export interface DeepSeekPresetRowProps {
	theme: Theme;
	/** Claude Code is installed (or has a custom path): the preset runs on it. */
	available: boolean;
	/** The preset is local only; an active SSH remote makes it unusable. */
	blockedBySsh: boolean;
	selected: boolean;
	apiKey: string;
	model: string;
	/** Why the last Create failed, already free of the key. */
	error: string | null;
	onSelect: () => void;
	onApiKeyChange: (value: string) => void;
	onModelChange: (value: string) => void;
}

/**
 * DeepSeek in the provider picker. It is a Claude Code configuration rather
 * than a provider of its own (see `src/shared/agentPresets.ts`), so it has no
 * detection or config panel; selecting it asks only for what the preset needs.
 * The key is typed into a password field and leaves this component only on
 * Create, through `prepareDeepSeekPreset`.
 */
export function DeepSeekPresetRow({
	theme,
	available,
	blockedBySsh,
	selected,
	apiKey,
	model,
	error,
	onSelect,
	onApiKeyChange,
	onModelChange,
}: DeepSeekPresetRowProps) {
	const t = useT();
	const usable = available && !blockedBySsh;
	const activate = () => {
		if (usable) onSelect();
	};
	return (
		<div
			className={`rounded border transition-all overflow-hidden ${selected ? 'ring-2' : ''}`}
			style={
				{
					borderColor: theme.colors.border,
					backgroundColor: selected ? theme.colors.accentDim : 'transparent',
					'--tw-ring-color': theme.colors.accent,
				} as React.CSSProperties
			}
			data-testid="deepseek-preset-row"
		>
			<div
				onClick={activate}
				onKeyDown={(e) => {
					if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
						e.preventDefault();
						activate();
					}
				}}
				className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 ${
					usable ? 'hover:bg-white/5 cursor-pointer' : 'opacity-40 cursor-not-allowed'
				}`}
				style={{ color: theme.colors.textMain }}
				role="option"
				// Named by the provider alone; the note is a description, so a query
				// for "Claude Code" still finds exactly the Claude Code row.
				aria-label={DEEPSEEK_PRESET.name}
				aria-describedby="deepseek-preset-note"
				aria-selected={selected}
				aria-disabled={!usable}
				tabIndex={usable ? 0 : -1}
			>
				<div className="min-w-0">
					<span className="font-medium">{DEEPSEEK_PRESET.name}</span>
					<span
						id="deepseek-preset-note"
						className="ml-2 text-xs"
						style={{ color: theme.colors.textDim }}
					>
						{blockedBySsh
							? t('workflows.sessions.deepseek.localOnly')
							: t('workflows.sessions.deepseek.description')}
					</span>
				</div>
				{!available && (
					<span
						className="shrink-0 text-xs px-2 py-0.5 rounded"
						style={{ backgroundColor: theme.colors.error + '20', color: theme.colors.error }}
					>
						{t('workflows.sessions.deepseek.needsClaude')}
					</span>
				)}
			</div>
			{selected && (
				<div className="px-3 pb-3 pt-2 space-y-3">
					<div>
						<label
							htmlFor="deepseek-api-key"
							className="block text-xs font-bold opacity-70 uppercase mb-1"
							style={{ color: theme.colors.textMain }}
						>
							{t('workflows.sessions.deepseek.apiKey')}
						</label>
						<input
							id="deepseek-api-key"
							type="password"
							autoComplete="off"
							spellCheck={false}
							value={apiKey}
							onChange={(e) => onApiKeyChange(e.target.value)}
							className="w-full p-2 rounded border bg-transparent outline-none text-sm font-mono"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						/>
						<p className="mt-1 text-xs" style={{ color: theme.colors.textDim }}>
							{t('workflows.sessions.deepseek.apiKeyHint')}
						</p>
					</div>
					<div>
						<label
							htmlFor="deepseek-model"
							className="block text-xs font-bold opacity-70 uppercase mb-1"
							style={{ color: theme.colors.textMain }}
						>
							{t('workflows.sessions.deepseek.model')}
						</label>
						<ThemedSelect
							id="deepseek-model"
							theme={theme}
							value={model}
							onChange={onModelChange}
							aria-label={t('workflows.sessions.deepseek.model')}
							options={DEEPSEEK_PRESET.models.map((value) => ({ value, label: value }))}
						/>
					</div>
					{error && (
						<p role="alert" className="text-xs" style={{ color: theme.colors.error }}>
							{t('workflows.sessions.deepseek.createFailed', { error })}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
