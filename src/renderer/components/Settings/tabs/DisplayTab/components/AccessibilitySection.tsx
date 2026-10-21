import { Accessibility, Eye, HelpCircle } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import type { Theme } from '../../../../../types';
import { DEFAULT_BIONIFY_ALGORITHM } from '../../../../../utils/bionifyReadingMode';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';
import type { BionifyAlgorithmState } from '../types';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface AccessibilitySectionProps {
	theme: Theme;
	colorBlindMode: boolean;
	setColorBlindMode: (enabled: boolean) => void;
	bionifyReadingMode: boolean;
	setBionifyReadingMode: (enabled: boolean) => void;
	bionifyIntensity: number;
	setBionifyIntensity: (value: number) => void;
	bionifyAlgorithmState: BionifyAlgorithmState;
}

export function AccessibilitySection({
	theme,
	colorBlindMode,
	setColorBlindMode,
	bionifyReadingMode,
	setBionifyReadingMode,
	bionifyIntensity,
	setBionifyIntensity,
	bionifyAlgorithmState,
}: AccessibilitySectionProps) {
	const handleAlgorithmKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter') {
			event.currentTarget.blur();
		}
	};

	const t = useT();
	const algorithmExample = '`- 0 1 1 2 0.4`';

	return (
		<div>
			<SettingsSectionHeading icon={Accessibility}>
				{t('settings.display.a11y.heading')}
			</SettingsSectionHeading>
			<p className="text-xs opacity-70 mb-2">{t('settings.display.a11y.description')}</p>

			<div data-setting-id="display-colorblind-mode" className="mb-3">
				<SectionCard theme={theme}>
					<ToggleSettingRow
						theme={theme}
						title={
							<span className="font-medium flex items-center gap-2">
								<Eye className="w-4 h-4" />
								<span>{t('settings.display.a11y.colorBlind')}</span>
							</span>
						}
						description={
							<span style={{ color: theme.colors.textDim }}>
								{t('settings.display.a11y.colorBlindDescription')}
							</span>
						}
						checked={colorBlindMode}
						onChange={setColorBlindMode}
						ariaLabel={t('settings.display.a11y.colorBlindAria')}
						clickableRow
					/>
				</SectionCard>
			</div>

			<div data-setting-id="display-bionify-reading-mode">
				<SectionCard theme={theme}>
					<ToggleSettingRow
						theme={theme}
						title={
							<span className="font-medium flex items-center gap-2">
								<span>{t('settings.display.a11y.bionify')}</span>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										bionifyAlgorithmState.openInfoModal();
									}}
									className="inline-flex items-center justify-center rounded transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
									style={{ width: '20px', height: '20px', color: theme.colors.textDim }}
									aria-label={t('settings.display.a11y.bionifyInfoAria')}
									title={t('settings.display.a11y.bionifyInfoTitle')}
								>
									<HelpCircle className="w-3.5 h-3.5" />
								</button>
							</span>
						}
						checked={bionifyReadingMode}
						onChange={setBionifyReadingMode}
						ariaLabel={t('settings.display.a11y.bionifyAria')}
						clickableRow
					/>

					<div
						className="space-y-4 pt-3 border-t"
						style={{
							borderColor: theme.colors.border,
							opacity: bionifyReadingMode ? 1 : 0.4,
							pointerEvents: bionifyReadingMode ? 'auto' : 'none',
						}}
					>
						<div>
							<div className="block text-xs font-bold opacity-70 uppercase mb-2">
								{t('settings.display.a11y.intensity')}
							</div>
							<ToggleButtonGroup
								options={[
									{ value: 0.85, label: t('settings.display.a11y.soft') },
									{ value: 1, label: t('common.default') },
									{ value: 1.35, label: t('settings.display.a11y.strong') },
								]}
								value={bionifyIntensity}
								onChange={setBionifyIntensity}
								theme={theme}
								disabled={!bionifyReadingMode}
							/>
							<p className="text-xs opacity-70 mt-2">
								{t('settings.display.a11y.intensityDescription')}
							</p>
						</div>

						<div>
							<label
								htmlFor="bionify-algorithm-input"
								className="block text-xs font-bold opacity-70 uppercase mb-2"
							>
								{t('settings.display.a11y.algorithm')}
							</label>
							<input
								id="bionify-algorithm-input"
								aria-label={t('settings.display.a11y.algorithmAria')}
								type="text"
								value={bionifyAlgorithmState.algorithmDraft}
								onChange={(event) => bionifyAlgorithmState.setAlgorithmDraft(event.target.value)}
								onBlur={bionifyAlgorithmState.commitAlgorithmDraft}
								onKeyDown={handleAlgorithmKeyDown}
								className="w-full px-3 py-2 rounded text-sm outline-none focus-visible:ring-1 focus-visible:ring-white/30"
								style={{
									backgroundColor: theme.colors.bgMain,
									color: theme.colors.textMain,
									border: `1px solid ${
										bionifyAlgorithmState.isAlgorithmValid
											? theme.colors.border
											: theme.colors.warning
									}`,
								}}
								placeholder={DEFAULT_BIONIFY_ALGORITHM}
								spellCheck={false}
								disabled={!bionifyReadingMode}
							/>
							<p className="text-xs opacity-70 mt-2">
								{t('settings.display.a11y.algorithmFormat', { example: algorithmExample })}
							</p>
							{!bionifyAlgorithmState.isAlgorithmValid && (
								<p className="text-xs mt-2" style={{ color: theme.colors.warning }}>
									{t('settings.display.a11y.algorithmInvalid', {
										format: '`+|- len1 len2 len3 len4 fraction`',
										example: algorithmExample,
									})}
								</p>
							)}
						</div>
					</div>
				</SectionCard>
			</div>
		</div>
	);
}
