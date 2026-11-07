import newShellPanelsCopy from './newShellPanelsCopy';
import newShellFeedbackCopy from './newShellFeedbackCopy';
import newShellNavigationCopy from './newShellNavigationCopy';
import newShellComposerCopy from './newShellComposerCopy';
import { workflowsFiles } from './workflowsFiles';
import { workflowsComposer } from './workflowsComposer';
/** Simplified Chinese. Mirrors the area files under `../en/`. */

import type { TranslationCatalog } from '../en';
import { common } from './common';
import { settings as baseSettings } from './settings';
import { settingsFinish } from './settingsFinish';
import { settingsExtras } from './settingsExtras';
import { workflows as baseWorkflows } from './workflows';
import { workflowsShell } from './workflowsShell';
import { workflowsSessions } from './workflowsSessions';

const settings = { ...baseSettings, ...settingsFinish, ...settingsExtras };
const workflows = {
	...newShellPanelsCopy,
	...newShellFeedbackCopy,
	...newShellNavigationCopy,
	...newShellComposerCopy,
	...baseWorkflows,
	...workflowsShell,
	...workflowsSessions,
	...workflowsFiles,
	...workflowsComposer,
};

export const zhCN: TranslationCatalog = {
	...common,
	...settings,
	...workflows,
};
