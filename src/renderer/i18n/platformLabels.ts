import { getFileManagerName } from '../utils/platformUtils';
import type { TFunction } from './translate';

/**
 * The OS file manager's name for UI copy. Finder and Explorer are product
 * names and stay as-is; only the generic Linux fallback is translated.
 */
export function localizedFileManagerName(t: TFunction, platform: string): string {
	const name = getFileManagerName(platform);
	return name === 'File Manager' ? t('common.fileManager') : name;
}
