import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { longMessages } from './fixtures.mjs';

const [bundle, manifest, data] = process.argv.slice(2);
globalThis.__perfData = data;
await fs.mkdir(data, { recursive: true });
const api = createRequire(import.meta.url)(bundle);
const corpus = JSON.parse(await fs.readFile(manifest, 'utf8'));
const metrics = {};
const perf = new api.PerformanceMetrics('native-perf');
async function measure(name, work) {
	global.gc();
	const before = process.memoryUsage();
	const cpu = process.cpuUsage();
	let maxDelayMs = 0;
	let previous = performance.now();
	const timer = setInterval(() => {
		const now = performance.now();
		maxDelayMs = Math.max(maxDelayMs, now - previous - 5);
		previous = now;
	}, 5);
	const start = perf.start();
	const result = await work();
	const ms = perf.end(start, name);
	const used = process.cpuUsage(cpu);
	const after = process.memoryUsage();
	maxDelayMs = Math.max(maxDelayMs, performance.now() - previous - 5);
	await new Promise((resolve) => setImmediate(resolve));
	clearInterval(timer);
	metrics[name] = {
		ms,
		cpuMs: (used.user + used.system) / 1000,
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssBytes: after.rss,
		maxDelayMs,
		count: Array.isArray(result)
			? result.length
			: (result?.total ?? result?.conversations?.length ?? 0),
	};
	return result;
}

const coldProjects = await measure('projects.bounded.cold', () =>
	api.createNativeProjectDiscovery({ accountDirs: async (p) => [corpus.accounts[p]] })()
);
const discover = api.createNativeProjectDiscovery({
	accountDirs: async (p) => [corpus.accounts[p]],
	maxFiles: 2500,
	maxMs: 60000,
});
await measure('projects.full.cold', discover);
await measure('projects.full.warm', discover);
const codex = new api.CodexSessionStorage();
const claude = new api.ClaudeSessionStorage();
const project = corpus.projects[0];
await measure('codex.list.cold', () =>
	codex.listSessions(project, undefined, corpus.accounts.codex)
);
const codexList = await measure('codex.list.warm', () =>
	codex.listSessions(project, undefined, corpus.accounts.codex)
);
await measure('claude.list.cold', () =>
	claude.listSessions(project, undefined, corpus.accounts['claude-code'])
);
await measure('claude.list.warm', () =>
	claude.listSessions(project, undefined, corpus.accounts['claude-code'])
);
await measure('paths.local.2000', async () => {
	for (const file of corpus.files) {
		api.localProjectPathCandidates(file.cwd);
		await api.localProjectWorktrees(file.cwd);
	}
});
const scopes = corpus.projects.map((projectPath, i) => ({
	projectKey: `p${i}`,
	projectPath,
	ownerIds: [`c${i}`, `a${i}`],
}));
const owners = scopes.flatMap((scope, i) =>
	['codex', 'claude-code'].map((toolType, j) => ({
		id: `${j ? 'a' : 'c'}${i}`,
		toolType,
		cwd: scope.projectPath,
	}))
);
const history = await measure('history.20projects', () =>
	api.discoverProjectHistory(scopes, {
		owners,
		storages: [codex, claude],
		accountDirs: async (p) => [corpus.accounts[p]],
		ownerAccountDir: (id) => corpus.accounts[id.startsWith('c') ? 'codex' : 'claude-code'],
		remote: () => undefined,
		onError: (error) => {
			throw error;
		},
	})
);
const lists = new Map();
for (const storage of [codex, claude])
	for (const scope of scopes) {
		lists.set(
			`${storage.agentId}:${scope.projectPath}`,
			await storage.listSessions(scope.projectPath, undefined, corpus.accounts[storage.agentId])
		);
	}
await measure('history.joinOnly.2000', () =>
	api.discoverProjectHistory(scopes, {
		owners,
		storages: [codex, claude].map((storage) => ({
			agentId: storage.agentId,
			listSessions: async (cwd) => lists.get(`${storage.agentId}:${cwd}`),
		})),
		accountDirs: async (p) => [corpus.accounts[p]],
		ownerAccountDir: (id) => corpus.accounts[id.startsWith('c') ? 'codex' : 'claude-code'],
		remote: () => undefined,
		onError: (error) => {
			throw error;
		},
	})
);
const plain = corpus.files[0],
	archive = corpus.files[1];
const options = { configDir: corpus.accounts.codex, readOnly: true, limit: 500 };
const opened = await measure('open.plain50MiB.cold', () =>
	codex.readSessionMessages(project, plain.id, options)
);
await measure('open.plain50MiB.warm', () => codex.readSessionMessages(project, plain.id, options));
await measure('open.zstd50MiB', () => codex.readSessionMessages(archive.cwd, archive.id, options));
const messages = longMessages();
const entries = await measure('convert.5000', () => api.transcriptMessagesToLogEntries(messages));
await measure('reconcile.5000', () => api.reconcileTranscriptEntries(entries, entries));
// Hash outside timing; a speedup must preserve complete semantic output.
const digest = createHash('sha256')
	.update(JSON.stringify({ coldProjects, codexList, history, opened, entries }))
	.digest('hex');
process.stdout.write(
	JSON.stringify({
		metrics,
		digest,
		loadAvg: os.loadavg(),
		freeMemBytes: os.freemem(),
		resourceUsage: process.resourceUsage(),
	})
);
