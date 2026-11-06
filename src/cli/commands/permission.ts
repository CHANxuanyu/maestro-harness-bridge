import { withMaestroClient } from '../services/maestro-client';
import { failCommand } from '../services/session-command';
import type { PermissionRequest } from '../../main/permission-relay/types';

/** The desktop and CLI answer the same pending request through permission:respond. */
export async function permissionCommand(
	action: string,
	requestId: string | undefined,
	options: { json?: boolean }
): Promise<void> {
	try {
		if (
			!['list', 'allow', 'deny'].includes(action) ||
			(action === 'list' ? requestId !== undefined : !requestId?.trim())
		)
			throw new Error('Use permission list or permission allow|deny <request-id>');
		const result = await withMaestroClient(async (client) => {
			const response = await client.sendCommand<{
				ok: boolean;
				result: Omit<PermissionRequest, 'token'>[] | boolean;
				error?: string;
			}>(
				{
					type: 'bridge.invoke',
					channel: action === 'list' ? 'permission:list' : 'permission:respond',
					args:
						action === 'list'
							? []
							: [
									requestId,
									action === 'allow'
										? { behavior: 'allow' }
										: { behavior: 'deny', message: 'Denied by user.' },
								],
				},
				'bridge.response'
			);
			if (!response.ok) throw new Error(response.error ?? 'Permission request failed');
			return response.result;
		});
		if (result === false) throw new Error('Permission request is no longer pending');
		if (options.json) console.log(JSON.stringify(result));
		else if (Array.isArray(result)) {
			for (const request of result) console.log(JSON.stringify(request, null, 2));
			if (!result.length) console.log('No pending permission requests');
		} else console.log('Permission decision delivered');
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
