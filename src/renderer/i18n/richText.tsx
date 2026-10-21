import { Fragment, type ReactNode } from 'react';
import { PLACEHOLDER_PATTERN } from './interpolate';

export type RichMessageParams = Readonly<Record<string, ReactNode>>;

/**
 * Like `interpolate`, but a parameter may be a React element (a `<kbd>`, a
 * link, an emphasized name). The template's own text is still rendered as
 * plain text, never parsed as markup, so a translation cannot inject elements.
 */
export function interpolateNodes(template: string, params: RichMessageParams): ReactNode {
	const parts: ReactNode[] = [];
	let last = 0;
	let index = 0;
	for (const m of template.matchAll(PLACEHOLDER_PATTERN)) {
		const start = m.index ?? 0;
		if (start > last) parts.push(template.slice(last, start));
		const value = params[m[1]];
		parts.push(value === undefined ? m[0] : <Fragment key={`p${index++}`}>{value}</Fragment>);
		last = start + m[0].length;
	}
	if (last < template.length) parts.push(template.slice(last));
	return parts.length === 1 ? parts[0] : <>{parts}</>;
}
