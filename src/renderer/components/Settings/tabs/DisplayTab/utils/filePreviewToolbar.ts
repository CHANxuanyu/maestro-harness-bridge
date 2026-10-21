import type { FilePreviewToolbarButton } from '../../../../../stores/settingsStore';
import type { MessageKey } from '../../../../../i18n';

/** English labels, kept as the readable reference for each toolbar button. */
export const TOOLBAR_BUTTON_LABELS: Record<FilePreviewToolbarButton, string> = {
	save: 'Save',
	wordWrap: 'Word wrap',
	remoteImages: 'Show remote images',
	htmlRender: 'Render HTML',
	openInBrowser: 'Open in Maestro browser',
	previewTier: 'Preview tier chip',
	editToggle: 'Edit / preview toggle',
	editImage: 'Edit image',
	copyContent: 'Copy content',
	publishGist: 'Publish as gist',
	documentGraph: 'Document graph',
	openInDefault: 'Open in default app',
	// Platform-dependent wording ("Reveal in Finder" / "Explorer" / "File Manager")
	// is resolved at render time.
	revealInFolder: 'Reveal in Finder',
	copyPath: 'Copy file path',
	delete: 'Delete file',
};

/** Catalog keys for the rendered (localized) toolbar button labels. */
export const TOOLBAR_BUTTON_LABEL_KEYS: Record<FilePreviewToolbarButton, MessageKey> = {
	save: 'settings.display.toolbar.save',
	wordWrap: 'settings.display.toolbar.wordWrap',
	remoteImages: 'settings.display.toolbar.remoteImages',
	htmlRender: 'settings.display.toolbar.htmlRender',
	openInBrowser: 'settings.display.toolbar.openInBrowser',
	previewTier: 'settings.display.toolbar.previewTier',
	editToggle: 'settings.display.toolbar.editToggle',
	editImage: 'settings.display.toolbar.editImage',
	copyContent: 'settings.display.toolbar.copyContent',
	publishGist: 'settings.display.toolbar.publishGist',
	documentGraph: 'settings.display.toolbar.documentGraph',
	openInDefault: 'settings.display.toolbar.openInDefault',
	revealInFolder: 'settings.display.toolbar.revealInFolder',
	copyPath: 'settings.display.toolbar.copyPath',
	delete: 'settings.display.toolbar.delete',
};
