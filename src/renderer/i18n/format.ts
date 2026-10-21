/**
 * Locale-aware wrappers over the shared formatters, for chrome that prints a
 * time or date. English delegates to the shared formatter unchanged, so every
 * existing English string (and test) is byte-identical.
 */

import { useCallback } from 'react';
import type { AppLocale } from '../../shared/i18n';
import { formatRelativeTime } from '../../shared/formatters';
import { useAppLocale } from './useI18n';

type DateInput = Date | number | string;

function toTimestamp(value: DateInput): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return new Date(value).getTime();
	return value.getTime();
}

export function formatRelativeTimeFor(locale: AppLocale, value: DateInput): string {
	if (locale === 'en') return formatRelativeTime(value);
	const timestamp = toTimestamp(value);
	const diffMins = Math.floor((Date.now() - timestamp) / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);
	if (diffMins < 1) return '刚刚';
	if (diffMins < 60) return `${diffMins} 分钟前`;
	if (diffHours < 24) return `${diffHours} 小时前`;
	if (diffDays < 7) return `${diffDays} 天前`;
	return new Date(timestamp).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** `formatRelativeTime` bound to the current UI language. */
export function useFormatRelativeTime(): (value: DateInput) => string {
	const locale = useAppLocale();
	return useCallback((value: DateInput) => formatRelativeTimeFor(locale, value), [locale]);
}
