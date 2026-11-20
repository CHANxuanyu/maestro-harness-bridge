import type { Rectangle, WebContents } from 'electron';

/** Shared compositor capture for the window IPC and team output evidence. */
export async function captureWebContentsPage(
	contents: WebContents | undefined,
	rect?: Rectangle
): Promise<string | null> {
	if (!contents || contents.isDestroyed()) return null;
	let area: Rectangle | undefined;
	if (rect) {
		const x = Math.max(0, Math.floor(rect.x));
		const y = Math.max(0, Math.floor(rect.y));
		area = {
			x,
			y,
			width: Math.floor(rect.x + rect.width) - x,
			height: Math.floor(rect.y + rect.height) - y,
		};
		if (area.width <= 0 || area.height <= 0) return null;
	}
	const image = area ? await contents.capturePage(area) : await contents.capturePage();
	return image.isEmpty() ? null : image.toDataURL();
}
