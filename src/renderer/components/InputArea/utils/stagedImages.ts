import { getT } from '../../../i18n';
export function addStagedImageIfUnique(
	images: string[],
	imageData: string,
	showFlashNotification?: (message: string) => void
): string[] {
	const t = getT();
	if (images.includes(imageData)) {
		showFlashNotification?.(t('workflows.shell.extraDuplicateImageIgnored'));
		return images;
	}

	return [...images, imageData];
}
