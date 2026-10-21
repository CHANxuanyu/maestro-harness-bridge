import type { MessageKey, TFunction } from './translate';

const HISTORY_LABELS: Readonly<Record<string, MessageKey>> = {
	'24 hours': 'workflows.sessions.history.lookback24',
	'72 hours': 'workflows.sessions.history.lookback72',
	'1 week': 'workflows.sessions.history.lookbackWeek',
	'2 weeks': 'workflows.sessions.history.lookback2Weeks',
	'1 month': 'workflows.sessions.history.lookbackMonth',
	'6 months': 'workflows.sessions.history.lookback6Months',
	'1 year': 'workflows.sessions.history.lookbackYear',
	'All time': 'workflows.sessions.history.allTime',
	AUTO: 'workflows.sessions.history.typeAUTO',
	USER: 'workflows.sessions.history.typeUSER',
	CUE: 'workflows.sessions.history.typeCUE',
	AGENT: 'workflows.sessions.history.typeAGENT',
};

/** Translate display labels only; history type identifiers stay unchanged. */
export function localizeHistoryLabel(text: string, t: TFunction): string {
	const key = HISTORY_LABELS[text];
	return key ? t(key) : text;
}
