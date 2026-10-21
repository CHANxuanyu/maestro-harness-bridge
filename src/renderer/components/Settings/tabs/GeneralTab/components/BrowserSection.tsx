import { ExternalLink } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { SettingCheckbox } from '../../../../SettingCheckbox';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import { ToggleSwitch } from '../../../../ui/ToggleSwitch';
import { DEFAULT_BROWSER_HOME_URL } from '../utils';
import { formatMetaKeyName, formatShortcutKeys } from '../../../../../utils/shortcutFormatter';
import { useT } from '../../../../../i18n';

type BrowserKeepAliveMode = 'off' | 'recent' | 'all';

interface BrowserSectionProps {
	theme: Theme;
	useSystemBrowser: boolean;
	setUseSystemBrowser: (enabled: boolean) => void;
	browserHomeUrl: string;
	setBrowserHomeUrl: (url: string) => void;
	htmlDoubleClickOpensInBrowser: boolean;
	setHtmlDoubleClickOpensInBrowser: (enabled: boolean) => void;
	browserTabKeepAlive: BrowserKeepAliveMode;
	setBrowserTabKeepAlive: (mode: BrowserKeepAliveMode) => void;
	browserTabKeepAliveLimit: number;
	setBrowserTabKeepAliveLimit: (limit: number) => void;
}

export function BrowserSection({
	theme,
	useSystemBrowser,
	setUseSystemBrowser,
	browserHomeUrl,
	setBrowserHomeUrl,
	htmlDoubleClickOpensInBrowser,
	setHtmlDoubleClickOpensInBrowser,
	browserTabKeepAlive,
	setBrowserTabKeepAlive,
	browserTabKeepAliveLimit,
	setBrowserTabKeepAliveLimit,
}: BrowserSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="general-browser">
			<SettingCheckbox
				icon={ExternalLink}
				sectionLabel={t('settings.general.browser.heading')}
				title={t('settings.general.browser.title')}
				description={t('settings.general.browser.description', { meta: formatMetaKeyName() })}
				checked={useSystemBrowser}
				onChange={setUseSystemBrowser}
				theme={theme}
			/>
			<div
				data-setting-id="general-html-double-click"
				className="mt-3 flex items-center justify-between p-3 rounded border cursor-pointer row-hover"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				onClick={() => setHtmlDoubleClickOpensInBrowser(!htmlDoubleClickOpensInBrowser)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setHtmlDoubleClickOpensInBrowser(!htmlDoubleClickOpensInBrowser);
					}
				}}
			>
				<div className="flex-1 pr-3">
					<div className="font-medium" style={{ color: theme.colors.textMain }}>
						{t('settings.general.browser.htmlTitle')}
					</div>
					<div className="text-xs opacity-70 mt-0.5">
						{t('settings.general.browser.htmlDescription')}
					</div>
				</div>
				<ToggleSwitch
					checked={htmlDoubleClickOpensInBrowser}
					onChange={setHtmlDoubleClickOpensInBrowser}
					theme={theme}
					ariaLabel={t('settings.general.browser.htmlTitle')}
				/>
			</div>
			<div
				className="mt-3 p-3 rounded border"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div className="block text-xs opacity-70 mb-1">{t('settings.general.browser.homeUrl')}</div>
				<div className="flex gap-2">
					<input
						type="text"
						value={browserHomeUrl}
						onChange={(e) => setBrowserHomeUrl(e.target.value)}
						placeholder={DEFAULT_BROWSER_HOME_URL}
						className="flex-1 p-1.5 rounded border bg-transparent outline-none text-xs font-mono"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					/>
					{browserHomeUrl !== DEFAULT_BROWSER_HOME_URL && (
						<button
							onClick={() => setBrowserHomeUrl(DEFAULT_BROWSER_HOME_URL)}
							className="px-2 py-1 rounded text-xs"
							style={{
								backgroundColor: theme.colors.bgActivity,
								color: theme.colors.textDim,
							}}
						>
							{t('common.reset')}
						</button>
					)}
				</div>
				<p className="text-xs opacity-70 mt-2">
					{t('settings.general.browser.homeUrlHelp', {
						shortcut: formatShortcutKeys(['Meta', 'b']),
					})}
				</p>
			</div>
			<div
				data-setting-id="general-browser-keepalive"
				className="mt-3 p-3 rounded border"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div className="font-medium" style={{ color: theme.colors.textMain }}>
					{t('settings.general.browser.keepAlive')}
				</div>
				<div className="text-xs opacity-70 mt-0.5 mb-2">
					{t('settings.general.browser.keepAliveDescription')}
				</div>
				<ToggleButtonGroup
					options={[
						{ value: 'off' as const, label: t('settings.general.browser.keepOff') },
						{ value: 'recent' as const, label: t('settings.general.browser.keepRecent') },
						{ value: 'all' as const, label: t('settings.general.browser.keepAll') },
					]}
					value={browserTabKeepAlive}
					onChange={setBrowserTabKeepAlive}
					theme={theme}
				/>
				{browserTabKeepAlive === 'recent' && (
					<div className="mt-3 flex items-center gap-2">
						<label className="text-xs opacity-70">{t('settings.general.browser.keepLimit')}</label>
						<input
							type="number"
							min={1}
							max={100}
							value={browserTabKeepAliveLimit}
							onChange={(e) =>
								setBrowserTabKeepAliveLimit(
									Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1))
								)
							}
							className="w-20 p-1.5 rounded border bg-transparent outline-none text-xs"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
