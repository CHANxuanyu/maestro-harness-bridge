/** Read-only summary of a project seen in local native history. */
export interface NativeProject {
	path: string;
	tools: string[];
	lastActivity: number;
	sessionCount: number;
}

export interface OpenProjectTarget {
	requesterWindowId?: number;
	path: string;
	sessionId?: string;
	toolType?: string;
	name?: string;
}

export type OpenProjectResult =
	| { success: true; sessionId: string }
	| { success: false; code: 'no-tools' | 'unavailable'; error: string };
