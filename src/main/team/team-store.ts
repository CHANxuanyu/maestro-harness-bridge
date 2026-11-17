import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import path from 'path';
import type { LedgerEvent, TeamConfig } from '../../shared/team/types';
import { assertSerializedJsonIsSafe } from '../../shared/jsonUtils';
import { atomicWriteJson, createKeyedWriteQueue } from '../utils/atomic-json-store';
import { corruptStorePath } from '../stores/corrupt-store-recovery';
import { logger } from '../utils/logger';

export type NewLedgerEvent = LedgerEvent extends infer E
	? E extends LedgerEvent
		? Omit<E, 'seq'>
		: never
	: never;

export interface TeamStoreRecovery {
	file: string;
	sidecar: string;
	/** One-based line numbers, empty for an unreadable config. */
	lines: number[];
}

// Shared across service instances, including readers, so sequence assignment
// and the canonical atomic writer's fixed temporary name cannot race.
const writes = createKeyedWriteQueue();

export function createTeamStore(
	userData: string,
	onRecovery: (recovery: TeamStoreRecovery) => void = (recovery) =>
		logger.warn('Preserved corrupt team data', 'TeamStore', recovery)
) {
	const root = path.resolve(userData, 'teams');
	const listeners = new Set<(teamId: string, event: LedgerEvent) => void>();
	const reported = new Set<string>();
	const folder = (id: string) => {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('Invalid team id');
		return path.join(root, id);
	};
	const preserve = async (file: string, bytes: Buffer, lines: number[]) => {
		const digest = createHash('sha256').update(bytes).digest('hex');
		if (reported.has(`${file}:${digest}`)) return;
		const sidecar = `${corruptStorePath(file)}.${digest}`;
		await fs.writeFile(sidecar, bytes, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== 'EEXIST') throw error;
		});
		reported.add(`${file}:${digest}`);
		onRecovery({ file, sidecar, lines });
	};
	const readConfig = async (id: string): Promise<TeamConfig> => {
		const file = path.join(folder(id), 'config.json');
		const bytes = await fs.readFile(file);
		try {
			const config = JSON.parse(bytes.toString('utf8')) as TeamConfig;
			if (!config || config.id !== id || !config.seats || !config.projectRoot)
				throw new SyntaxError('Invalid team config');
			return config;
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			await preserve(file, bytes, []);
			throw error;
		}
	};
	const readLedger = async (id: string) => {
		const file = path.join(folder(id), 'ledger.jsonl');
		const bytes = await fs.readFile(file).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== 'ENOENT') throw error;
			return Buffer.alloc(0);
		});
		const events: LedgerEvent[] = [];
		const bad: number[] = [];
		let seq = 0;
		const lines = bytes.toString('utf8').split('\n');
		const torn = bytes.length > 0 && bytes[bytes.length - 1] !== 10;
		for (let i = 0; i < lines.length; i++) {
			if (i === lines.length - 1 && !torn) break;
			try {
				const event = JSON.parse(lines[i]) as LedgerEvent;
				const validSeq = Number.isSafeInteger(event?.seq) && event.seq > seq;
				// Reserve a sequence even if the rest of its envelope is corrupt.
				if (validSeq) seq = event.seq;
				if (
					!validSeq ||
					!event.id ||
					!Number.isFinite(event.at) ||
					!['app', 'owner', 'pm', 'dev', 'qa'].includes(event.actor) ||
					typeof event.kind !== 'string'
				)
					throw new SyntaxError('Invalid ledger record');
				events.push(event);
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
				bad.push(i + 1);
			}
		}
		if (bad.length) {
			// Preserve exact corrupt bytes, not a growing copy of the whole
			// ledger on every later append. Good records remain in place.
			const badLines = new Set(bad);
			const fragments: Buffer[] = [];
			let offset = 0;
			for (let line = 1; offset < bytes.length; line++) {
				const newline = bytes.indexOf(10, offset);
				const end = newline === -1 ? bytes.length : newline + 1;
				if (badLines.has(line)) fragments.push(bytes.subarray(offset, end));
				offset = end;
			}
			await preserve(file, Buffer.concat(fragments), bad);
		}
		return { events, seq, torn };
	};

	return {
		async createTeam(config: TeamConfig): Promise<TeamConfig> {
			const dir = folder(config.id);
			const snapshot = structuredClone(config);
			return writes.enqueue(dir, async () => {
				await fs.mkdir(root, { recursive: true });
				// Exclusive directory creation refuses accidental replacement.
				await fs.mkdir(dir);
				const ledger = await fs.open(path.join(dir, 'ledger.jsonl'), 'wx');
				try {
					await ledger.sync();
				} finally {
					await ledger.close();
				}
				await atomicWriteJson(path.join(dir, 'config.json'), snapshot);
				return snapshot;
			});
		},
		async listTeams(): Promise<TeamConfig[]> {
			const dirs = await fs
				.readdir(root, { withFileTypes: true })
				.catch((error: NodeJS.ErrnoException) => {
					if (error.code !== 'ENOENT') throw error;
					return [];
				});
			const configs: TeamConfig[] = [];
			for (const dir of dirs) {
				if (!dir.isDirectory()) continue;
				try {
					configs.push(await writes.enqueue(folder(dir.name), () => readConfig(dir.name)));
				} catch (error) {
					if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT')
						throw error;
				}
			}
			return configs;
		},
		loadTeam(id: string): Promise<{ config: TeamConfig; events: LedgerEvent[] }> {
			return writes.enqueue(folder(id), async () => ({
				config: await readConfig(id),
				events: (await readLedger(id)).events,
			}));
		},
		append(id: string, input: NewLedgerEvent): Promise<LedgerEvent> {
			const snapshot = structuredClone(input);
			return writes.enqueue(folder(id), async () => {
				await readConfig(id);
				const ledger = await readLedger(id);
				if (ledger.seq === Number.MAX_SAFE_INTEGER) throw new Error('Team sequence exhausted');
				const event = { ...snapshot, seq: ledger.seq + 1 } as LedgerEvent;
				const file = path.join(folder(id), 'ledger.jsonl');
				const serialized = JSON.stringify(event);
				assertSerializedJsonIsSafe(serialized, file);
				const handle = await fs.open(file, 'a');
				try {
					// Seal a torn fragment without modifying any existing ledger bytes.
					await handle.writeFile(`${ledger.torn ? '\n' : ''}${serialized}\n`);
					await handle.sync();
				} finally {
					await handle.close();
				}
				for (const listener of listeners) {
					try {
						listener(id, structuredClone(event));
					} catch (error) {
						logger.error('Team append listener failed', 'TeamStore', { error: String(error) });
					}
				}
				return event;
			});
		},
		subscribe(listener: (teamId: string, event: LedgerEvent) => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
