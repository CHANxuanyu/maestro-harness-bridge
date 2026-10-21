/**
 * Display labels for enumerated values the daily workflow UI shows to users.
 *
 * The stored values (`'idle'`, `'busy'`, ...) stay as they are; only the text
 * rendered for them is localized. An unknown value renders verbatim, so a new
 * state shows up untranslated rather than blank.
 */

import type { MessageKey, TFunction } from '../i18n';
import type { SessionState } from '../types';

const AGENT_STATE_KEYS: Record<SessionState, MessageKey> = {
	idle: 'workflows.agentState.idle',
	busy: 'workflows.agentState.busy',
	waiting_input: 'workflows.agentState.waitingInput',
	connecting: 'workflows.agentState.connecting',
	error: 'workflows.agentState.error',
};

export function agentStateLabel(t: TFunction, state: string): string {
	const key = AGENT_STATE_KEYS[state as SessionState];
	return key ? t(key) : state;
}
