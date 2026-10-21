import { useT } from '../../../../../i18n';
import { Lock, Plus, X } from 'lucide-react';
import { SYMPHONY_REGISTRY_URL } from '../../../../../../shared/symphony-constants';
import type { Theme } from '../../../../../types';
import type { SymphonyRegistryState } from '../types';

interface SymphonyRegistrySectionProps {
	theme: Theme;
	symphonyRegistryUrls: string[];
	registryState: SymphonyRegistryState;
}

/**
 * Symphony config BODY (rendered in the extension detail pane's Settings tab).
 * No card chrome / enable toggle - the detail-pane header owns those; this is
 * pure configuration. The data-setting-id stays for settings-search jumps.
 */
export function SymphonyRegistrySection({
	theme,
	symphonyRegistryUrls,
	registryState,
}: SymphonyRegistrySectionProps) {
	const tExtra = useT();
	const registryErrorKeys = {
		'URL cannot be empty': 'settings.extra.symphonyRegistrySection.error1',
		'URL must use HTTP or HTTPS': 'settings.extra.symphonyRegistrySection.error2',
		'Invalid URL format': 'settings.extra.symphonyRegistrySection.error3',
		'This is the default registry URL': 'settings.extra.symphonyRegistrySection.error4',
		'URL already added': 'settings.extra.symphonyRegistrySection.error5',
	} as const;
	const registryErrorKey = registryState.registryUrlError
		? registryErrorKeys[registryState.registryUrlError as keyof typeof registryErrorKeys]
		: undefined;
	return (
		<div data-setting-id="encore-symphony">
			<label
				className="block text-xs font-bold opacity-70 uppercase mb-2"
				style={{ color: theme.colors.textMain }}
			>
				{tExtra('settings.extra.symphonyRegistrySection.registrySources')}
			</label>
			<p className="text-xs mb-3" style={{ color: theme.colors.textDim }}>
				{tExtra(
					'settings.extra.symphonyRegistrySection.repositoriesAreLoadedFromAllConfiguredRegistry'
				)}
			</p>

			<div
				className="flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono mb-2"
				style={{
					backgroundColor: theme.colors.bgActivity,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				<Lock className="w-3 h-3 flex-shrink-0" style={{ color: theme.colors.textDim }} />
				<span className="truncate flex-1" style={{ color: theme.colors.textMain }}>
					{SYMPHONY_REGISTRY_URL}
				</span>
				<span
					className="text-2xs px-1.5 py-0.5 rounded flex-shrink-0"
					style={{ color: theme.colors.textDim, backgroundColor: theme.colors.border }}
				>
					{tExtra('settings.extra.symphonyRegistrySection.default')}
				</span>
			</div>

			{symphonyRegistryUrls.map((url) => (
				<div
					key={url}
					className="flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono mb-1"
					style={{
						backgroundColor: theme.colors.bgActivity,
						border: `1px solid ${theme.colors.border}`,
					}}
				>
					<span className="truncate flex-1" style={{ color: theme.colors.textMain }}>
						{url}
					</span>
					<button
						type="button"
						onClick={() => registryState.removeRegistryUrl(url)}
						className="p-0.5 rounded hover:bg-white/10 transition-colors flex-shrink-0"
						style={{ color: theme.colors.error }}
						title={tExtra('settings.extra.symphonyRegistrySection.removeRegistryUrl')}
					>
						<X className="w-3 h-3" />
					</button>
				</div>
			))}

			<div className="flex items-center gap-2 mt-3">
				<div className="flex-1 relative">
					<input
						type="text"
						value={registryState.newRegistryUrl}
						onChange={(event) => registryState.setNewRegistryUrl(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								registryState.addRegistryUrl();
							}
						}}
						placeholder="https://example.com/registry.json"
						className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
						style={{
							backgroundColor: theme.colors.bgActivity,
							borderColor: registryState.registryUrlError
								? theme.colors.error
								: theme.colors.border,
							border: '1px solid',
							color: theme.colors.textMain,
						}}
					/>
					{registryState.registryUrlError && (
						<p className="absolute -bottom-4 left-0 text-2xs" style={{ color: theme.colors.error }}>
							{registryErrorKey ? tExtra(registryErrorKey) : registryState.registryUrlError}
						</p>
					)}
				</div>
				<button
					type="button"
					onClick={registryState.addRegistryUrl}
					disabled={!registryState.newRegistryUrl.trim()}
					className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
					style={{ backgroundColor: theme.colors.accent, color: theme.colors.bgMain }}
				>
					<Plus className="w-4 h-4" /> {tExtra('settings.extra.symphonyRegistrySection.add')}
				</button>
			</div>
		</div>
	);
}
