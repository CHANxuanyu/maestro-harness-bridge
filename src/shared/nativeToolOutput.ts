/** Only this bounded result crosses IPC. Native content never enters session state. */
export type NativeToolOutputResult =
	| { status: 'found'; text: string; totalBytes: number; omittedBytes: number }
	| { status: 'not-found' | 'too-large' | 'unavailable' | 'unsupported' | 'busy' };

export interface NativeToolOutputTarget {
	provider: string;
	projectPath: string;
	nativeSessionId: string;
	ownerAgentId: string;
	sshRemoteId?: string;
}
