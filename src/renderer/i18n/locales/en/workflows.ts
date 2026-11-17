/**
 * Daily workflow chrome: first launch, the main shell, agents, the composer,
 * tabs, history, and group chat. Split into one file per surface under
 * `./workflows/`; every key starts with `workflows.` so the whole set is one
 * catalog area.
 */

import { team } from './team';
import { dialogs } from './workflows/dialogs';
import { onboarding } from './workflows/onboarding';

export const workflows = {
	...team,
	...onboarding,
	...dialogs,
} as const;
