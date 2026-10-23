import { describe, it, expect } from 'vitest';
import { THEMES } from '../../../../shared/themes';
import { AA_CONTRAST, contrastRatio, readableTextOn } from '../../../../shared/colorContrast';

/**
 * The conversation feed draws its secondary labels and its tool status words
 * on the page background (no bubble behind them), in the colors TerminalOutput
 * and ToolStatusLabel derive: the theme color passed through `readableTextOn`
 * against `bgMain`, at full opacity. Every built-in palette must come out
 * readable as TEXT (4.5:1), since these carry state, not decoration.
 *
 * This measures the source colors the components compute. Rendered contrast
 * (font smoothing, what actually sits behind a row) is a GUI check.
 */
describe('conversation feed text colors on every built-in theme', () => {
	const themes = Object.values(THEMES);

	it('covers the built-in palettes', () => {
		expect(themes.length).toBeGreaterThan(0);
	});

	it.each(themes.map((theme) => [theme.id, theme] as const))(
		'%s: secondary text and status words clear AA on the page',
		(_id, theme) => {
			const bg = theme.colors.bgMain;
			const secondary = readableTextOn(theme.colors.textDim, [bg]);
			expect(contrastRatio(secondary, bg)).toBeGreaterThanOrEqual(AA_CONTRAST);
			for (const status of [theme.colors.warning, theme.colors.success, theme.colors.error]) {
				expect(contrastRatio(readableTextOn(status, [bg]), bg)).toBeGreaterThanOrEqual(AA_CONTRAST);
			}
			// Content and the "Stopped" word use textMain unchanged.
			expect(contrastRatio(theme.colors.textMain, bg)).toBeGreaterThanOrEqual(AA_CONTRAST);
		}
	);
});
