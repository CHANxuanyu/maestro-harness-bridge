import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { TestInfo } from '@playwright/test';
import type Store from 'electron-store';
import type { Session } from '../../../src/renderer/types';
import type { MaestroSettings } from '../../../src/main/stores/types';
import type { ManagedProcess } from '../../../src/main/process-manager/types';
import type { DataBufferManager } from '../../../src/main/process-manager/handlers/DataBufferManager';

const declarations = vi.hoisted(
	() => new Map<string, (args: object, info: TestInfo) => Promise<void>>()
);
vi.mock('@playwright/test', async (original) => ({
	...(await original<typeof import('@playwright/test')>()),
	test: Object.assign(
		(name: string, body: (args: object, info: TestInfo) => Promise<void>) =>
			declarations.set(name, body),
		{ skip: vi.fn(), setTimeout: vi.fn(), extend: vi.fn() }
	),
}));
vi.mock('../electron-app', () => ({ launchElectronApp: vi.fn() }));
vi.mock('../../../src/main/stores/getters', () => ({ getSessionsStore: vi.fn() }));
vi.mock('../../../src/main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { NativeApp } from '../native-app';
import { getSessionsStore } from '../../../src/main/stores/getters';
import { migrateApiModeDefault } from '../../../src/main/stores/migrations/api-mode-default';
import { ClaudeOutputParser } from '../../../src/main/parsers/claude-output-parser';
import { StdoutHandler } from '../../../src/main/process-manager/handlers/StdoutHandler';
import { createNativeTempDir } from './temp-root.cjs';
import '../../native-project-tool-config.spec';
import '../../native-auto-handoff.spec';

const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// Execute the actual scenario's setup, stopping before Electron or any UI action.
async function captureSeed(prefix: string) {
	const stop = new Error('Seed captured before Electron');
	let seed!: { settings: Record<string, unknown>; sessions: Session[]; script?: string };
	vi.spyOn(NativeApp.prototype, 'start').mockImplementation(async function (this: NativeApp) {
		roots.push(this.root);
		seed = {
			settings: JSON.parse(fs.readFileSync(path.join(this.data, 'maestro-settings.json'), 'utf8')),
			sessions: JSON.parse(fs.readFileSync(path.join(this.data, 'maestro-sessions.json'), 'utf8'))
				.sessions,
			script: fs.existsSync(this.script) ? fs.readFileSync(this.script, 'utf8') : undefined,
		};
		throw stop;
	});
	const [title, body] = [...declarations].find(([name]) => name.startsWith(prefix))!;
	await expect(body({}, { title } as TestInfo)).rejects.toBe(stop);
	return seed;
}

it('project tool scenario retains both interactive configurations across startup migration', async () => {
	const seed = await captureSeed('project tool config:');
	const sessionsStore = {
		get: () => seed.sessions,
		set: (_key: string, sessions: Session[]) => {
			seed.sessions = sessions;
		},
	};
	vi.mocked(getSessionsStore).mockReturnValue(
		sessionsStore as unknown as ReturnType<typeof getSessionsStore>
	);
	migrateApiModeDefault({
		get: (key: string) => seed.settings[key],
		set: (key: string, value: unknown) => {
			seed.settings[key] = value;
		},
	} as unknown as Store<MaestroSettings>);
	expect(
		seed.sessions.map(({ id, enableMaestroP, maestroPMode }) => ({
			id,
			enableMaestroP,
			maestroPMode,
		}))
	).toEqual([
		{ id: 'project-config-claude', enableMaestroP: true, maestroPMode: 'interactive' },
		{ id: 'second-config', enableMaestroP: true, maestroPMode: 'interactive' },
	]);
});

it('auto handoff fixture leaves rate_limited as the final renderer event', async () => {
	const seed = await captureSeed('quota auto handoff defaults off');
	const root = createNativeTempDir('lane2-quota-contract-');
	roots.push(root);
	const script = path.join(root, 'scenario.json');
	fs.writeFileSync(script, seed.script!);
	const stdout = execFileSync(
		process.execPath,
		[
			path.resolve('e2e/fixtures/native/claude'),
			'--print',
			'--output-format',
			'stream-json',
			'--',
			'Synthetic quota request',
		],
		{
			cwd: root,
			env: {
				PATH: process.env.PATH,
				HOME: root,
				USERPROFILE: root,
				CLAUDE_CONFIG_DIR: root,
				MAESTRO_NATIVE_SCRIPT: script,
			},
			encoding: 'utf8',
			timeout: 10_000,
		}
	);
	const parser = new ClaudeOutputParser();
	const events = stdout
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	expect(
		events.filter((event) => parser.detectErrorFromParsed(event)?.type === 'rate_limited')
	).toHaveLength(2);
	expect(events.find((event) => event.type === 'assistant')).toMatchObject({
		error: 'rate_limit',
		is_api_error_message: true,
		message: { model: '<synthetic>' },
	});
	expect(events.find((event) => event.type === 'result')).toMatchObject({ is_error: true });
	const emitter = new EventEmitter();
	const delivered: string[] = [];
	emitter.on('agent-error', (_id, error) => delivered.push(error.type));
	const processState: ManagedProcess = {
		sessionId: 'claude-ai-claude-tab',
		toolType: 'claude-code',
		cwd: root,
		pid: 0,
		isTerminal: false,
		startTime: Date.now(),
		stdoutBuffer: '',
		jsonBuffer: '',
		isStreamJsonMode: true,
		outputParser: parser,
	};
	const handler = new StdoutHandler({
		processes: new Map([[processState.sessionId, processState]]),
		emitter,
		bufferManager: {
			emitDataBuffered: () => delivered.push('data'),
			flushDataBuffer: () => {},
		} as unknown as DataBufferManager,
	});
	handler.handleData(processState.sessionId, stdout);
	// Data after an error means recovery to useAgentDataListener and clears the error.
	expect(delivered).toEqual(['rate_limited']);
});
