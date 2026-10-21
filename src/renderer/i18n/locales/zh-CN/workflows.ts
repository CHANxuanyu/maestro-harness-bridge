/** Simplified Chinese daily workflow chrome. Mirrors `../en/workflows.ts`. */

import type { workflows as en } from '../en/workflows';
import type { AreaTranslation } from '../types';
import { dialogs } from './workflows/dialogs';
import { onboarding } from './workflows/onboarding';

export const workflows: AreaTranslation<typeof en> = {
	...onboarding,
	...dialogs,
};
