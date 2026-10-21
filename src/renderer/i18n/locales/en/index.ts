import { workflowsFiles } from './workflowsFiles';
import { workflowsComposer } from './workflowsComposer';
/**
 * The English catalog: the source of every message key and the runtime
 * fallback for any key another locale omits.
 *
 * Areas are split by surface so a file stays reviewable. Every key in an area
 * starts with that area's prefix, and no two areas may define the same key
 * (both enforced by the catalog test), so the spread below cannot silently
 * shadow an entry.
 */

import { common } from './common';
import { settings as baseSettings } from './settings';
import { settingsFinish } from './settingsFinish';
import { settingsExtras } from './settingsExtras';
import { workflows as baseWorkflows } from './workflows';
import { workflowsShell } from './workflowsShell';
import { workflowsSessions } from './workflowsSessions';

const settings = { ...baseSettings, ...settingsFinish, ...settingsExtras };
const workflows = {
	...baseWorkflows,
	...workflowsShell,
	...workflowsSessions,
	...workflowsFiles,
	...workflowsComposer,
};

export const EN_AREAS = {
	common,
	settings,
	workflows,
} as const;

export const en = {
	...common,
	...settings,
	...workflows,
};

export type MessageKey = keyof typeof en;
export type TranslationCatalog = Partial<Record<MessageKey, string>>;
