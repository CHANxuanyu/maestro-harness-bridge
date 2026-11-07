import { invokeNativeHistory } from '../services/agent-sessions';
import { failCommand } from '../services/session-command';

export async function codexTurnSteer(
	processId: string,
	text: string,
	options: { json?: boolean }
): Promise<void> {
	try {
		const result = await invokeNativeHistory<{ success: boolean; turnId?: string; error?: string }>(
			'process:steer',
			[processId, text]
		);
		if (!result.success) throw new Error(result.error || 'Codex steering failed');
		console.log(JSON.stringify(result, null, options.json ? undefined : 2));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}

export async function codexTurnStop(processId: string, options: { json?: boolean }): Promise<void> {
	try {
		const stopped = await invokeNativeHistory<boolean>('process:codex-stop', [processId]);
		if (!stopped) throw new Error('No active Codex app-server turn');
		console.log(JSON.stringify({ success: true }, null, options.json ? undefined : 2));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}

export async function permissionRespond(
	requestId: string,
	behavior: string,
	options: { json?: boolean }
): Promise<void> {
	try {
		if (behavior !== 'allow' && behavior !== 'deny')
			throw new Error('Decision must be allow or deny');
		const result = await invokeNativeHistory<boolean>('permission:respond', [
			requestId,
			behavior === 'allow' ? { behavior } : { behavior, message: 'Denied by user.' },
		]);
		if (!result) throw new Error('Permission request is no longer pending');
		console.log(JSON.stringify({ success: true }, null, options.json ? undefined : 2));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}

export async function codexPermissions(options: { json?: boolean }): Promise<void> {
	try {
		const result = await invokeNativeHistory('process:codex-permissions', []);
		console.log(JSON.stringify(result, null, options.json ? undefined : 2));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
