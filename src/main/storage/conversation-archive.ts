import type {
	ArchivedConversation,
	ConversationArchiveAction,
	ConversationArchiveTarget,
	ConversationLifecycleRequest,
	ConversationLifecycleResult,
} from '../../shared/conversationArchive';
import { createKeyedWriteQueue } from '../utils/atomic-json-store';
import { nativeHistoryPool } from './project-history';

interface ArchiveOwner {
	id: string;
	toolType: string;
	cwd: string;
	projectRoot?: string;
	sessionSshRemoteConfig?: { enabled?: boolean; remoteId?: string };
}
interface ArchiveDependencies {
	read: () => ArchivedConversation[];
	write: (records: ArchivedConversation[]) => void;
	owners: () => ArchiveOwner[];
	accountDir: (ownerId: string) => string | undefined;
	realpath?: (directory: string) => Promise<string>;
	lifecycle: (request: ConversationLifecycleRequest) => Promise<ConversationLifecycleResult>;
	deleteNative: (target: ConversationArchiveTarget) => Promise<{ success: boolean }>;
}

/** Maestro metadata only. Native removal remains the provider adapter's explicit operation. */
export function createConversationArchive(deps: ArchiveDependencies) {
	const queue = createKeyedWriteQueue();
	const host = (owner: ArchiveOwner) =>
		owner.sessionSshRemoteConfig?.enabled
			? owner.sessionSshRemoteConfig.remoteId || 'unavailable'
			: undefined;
	const identity = async (target: ConversationArchiveTarget) =>
		JSON.stringify([
			target.provider,
			target.sshRemoteId || 'local',
			await nativeHistoryPool(
				target.provider!,
				target.accountDir,
				target.sshRemoteId,
				deps.realpath
			),
			target.nativeSessionId,
		]);
	async function matchingOwners(target: ConversationArchiveTarget, key: string) {
		const matches: string[] = [];
		for (const owner of deps.owners()) {
			if (owner.toolType !== target.provider || host(owner) !== target.sshRemoteId) continue;
			if ((await identity({ ...target, accountDir: deps.accountDir(owner.id) })) === key)
				matches.push(owner.id);
		}
		return matches;
	}
	async function list(): Promise<ArchivedConversation[]> {
		return Promise.all(
			deps.read().map(async (record) => ({
				...record,
				ownerIds: await matchingOwners(record, record.key),
			}))
		);
	}
	async function change(input: ConversationArchiveTarget, action: ConversationArchiveAction) {
		return queue.enqueue('archives', async () => {
			if (!input || typeof input.nativeSessionId !== 'string' || !input.nativeSessionId.trim())
				throw new Error('conversation-native-required');
			if (!['archive', 'unarchive', 'delete'].includes(action))
				throw new Error('conversation-action-invalid');
			const owner = input.ownerId
				? deps.owners().find((item) => item.id === input.ownerId)
				: undefined;
			if (input.ownerId && !owner) throw new Error('conversation-owner-unavailable');
			const target: ConversationArchiveTarget = owner
				? {
						nativeSessionId: input.nativeSessionId,
						ownerId: owner.id,
						provider: owner.toolType,
						projectPath: owner.projectRoot || owner.cwd,
						accountDir: deps.accountDir(owner.id),
						sshRemoteId: host(owner),
						title: input.title,
					}
				: input;
			if (!target.provider || !target.projectPath) throw new Error('conversation-target-invalid');
			if (action === 'delete' && target.provider !== 'codex')
				throw new Error('conversation-delete-unsupported');
			const key = await identity(target);
			const before = deps.read();
			const existing = before.find((row) => row.key === key);
			const remaining = before.filter((row) => row.key !== key);
			if (action === 'unarchive') {
				deps.write(remaining);
				return { success: true };
			}
			const ownerIds = await matchingOwners(target, key);
			const request = { ownerIds, nativeSessionId: target.nativeSessionId, action };
			const checked = await deps.lifecycle({ ...request, phase: 'check' });
			if (checked.error) throw new Error(checked.error);
			const record: ArchivedConversation = {
				key,
				projectKey: '',
				projectPath: target.projectPath,
				worktree: target.worktree,
				provider: target.provider,
				nativeSessionId: target.nativeSessionId,
				title:
					checked.title || target.title || existing?.title || target.nativeSessionId.slice(0, 8),
				preview: '',
				createdAt: 0,
				modifiedAt: Date.now(),
				messageCount: 0,
				starred: false,
				accountDir: target.accountDir,
				sshRemoteId: target.sshRemoteId,
				permissionMode: checked.permissionMode ?? existing?.permissionMode ?? 'readonly',
				archivedAt: Date.now(),
				ownerIds,
			};
			// Persist before closing so a crash cannot make an archived row return.
			// A failed live recheck restores the prior metadata, never claims success.
			if (action === 'archive') deps.write([...remaining, record]);
			try {
				const closed = await deps.lifecycle({ ...request, phase: 'close' });
				if (closed.error) throw new Error(closed.error);
				if (action === 'archive') {
					const modes = [record.permissionMode, closed.permissionMode];
					record.permissionMode = modes.includes('readonly')
						? 'readonly'
						: modes.includes('standard')
							? 'standard'
							: 'full';
					deps.write([...remaining, record]);
				}
				if (action === 'delete') {
					const result = await deps.deleteNative(target);
					if (!result.success) throw new Error('conversation-delete-failed');
					deps.write(remaining);
				}
			} catch (error) {
				if (action === 'archive') deps.write(before);
				throw error;
			}
			return { success: true };
		});
	}
	return { list, change };
}
