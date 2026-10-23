import type { Theme } from '../../../types';

/**
 * Prose overrides for the conversation feed, layered after
 * `generateTerminalProseStyles(theme, '.terminal-output')`.
 *
 * - Activity rows (progress notes, reasoning) read in their row's secondary
 *   color. The terminal prose pins `p`, lists and the container itself to
 *   `textMain`, so the row's color has to be passed down explicitly.
 * - Headings are plain bold text a step above body size, the way Codex and
 *   Claude Code set them, instead of the terminal's accent/green/yellow titles
 *   at up to twice the body size.
 */
export function feedProseStyles(theme: Theme): string {
	const feed = '.terminal-output [data-reading-column]';
	return `
    ${feed} [data-feed-row="activity"] .prose,
    ${feed} [data-feed-row="activity"] .prose :is(p, ul, ol, h1, h2, h3, h4, h5, h6) { color: inherit !important; }
    ${feed} .prose :is(h1, h2, h3, h4) { color: ${theme.colors.textMain}; font-weight: 600; line-height: 1.35; margin: 0.6em 0 0.25em !important; }
    ${feed} .prose h1 { font-size: 1.3em; }
    ${feed} .prose h2 { font-size: 1.18em; }
    ${feed} .prose h3 { font-size: 1.08em; }
    ${feed} .prose h4 { font-size: 1em; }
    ${feed} .prose > :is(h1, h2, h3, h4):first-child { margin-top: 0 !important; }
  `;
}
