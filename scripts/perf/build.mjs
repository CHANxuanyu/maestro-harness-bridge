import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

/** Bundle real storage/conversion code, replacing only desktop and external boundaries. */
export async function buildVariant(repo, outfile, ref) {
	const exports = [
		['src/main/storage/native-projects.ts', 'createNativeProjectDiscovery'],
		[
			'src/main/storage/local-project-paths.ts',
			'localProjectPathCandidates, localProjectWorktrees',
		],
		['src/main/storage/project-history.ts', 'discoverProjectHistory'],
		['src/main/storage/codex-session-storage.ts', 'CodexSessionStorage'],
		['src/main/storage/claude-session-storage.ts', 'ClaudeSessionStorage'],
		[
			'src/renderer/utils/transcriptMessages.ts',
			'transcriptMessagesToLogEntries, reconcileTranscriptEntries, mergeNewerEntries',
		],
		['src/shared/performance-metrics.ts', 'PerformanceMetrics'],
	];
	await build({
		stdin: {
			contents: exports
				.map(([file, names]) => `export { ${names} } from ${JSON.stringify('./' + file)};`)
				.join('\n'),
			resolveDir: repo,
			loader: 'ts',
		},
		outfile,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		packages: 'external',
		logLevel: 'silent',
		plugins: [
			{
				name: 'isolated-perf',
				setup(builder) {
					builder.onResolve({ filter: /^(electron|electron-store)$/ }, (args) => ({
						path: args.path,
						namespace: 'perf',
					}));
					builder.onLoad({ filter: /.*/, namespace: 'perf' }, (args) => ({
						contents:
							args.path === 'electron'
								? `export const app = { getPath: () => globalThis.__perfData, getVersion: () => 'synthetic' };`
								: 'export default class Store { get(_key, fallback) { return fallback; } set() { throw Error("Unexpected metadata mutation"); } }',
					}));
					builder.onLoad({ filter: /src\/main\/utils\/(logger|sentry)\.ts$/ }, (args) => ({
						contents: args.path.endsWith('logger.ts')
							? 'export const logger = { info() {}, debug() {}, warn() {}, error() {} };'
							: 'export function captureException(error) { throw error; } export function captureMessage() {}',
					}));
					builder.onLoad({ filter: /src\/main\/agents\/provider-account-dirs\.ts$/ }, () => ({
						contents:
							'export async function getProviderAccountDirs() { throw Error("Explicit temporary account required"); }',
					}));
					builder.onLoad({ filter: /src\/main\/utils\/(remote-fs|remote-git)\.ts$/ }, (args) => ({
						contents: `const fail = () => { throw Error('Remote I/O is outside the Node benchmark'); }; export { ${(args.path.endsWith(
							'remote-git.ts'
						)
							? ['execGitReadOnly']
							: [
									'readFileRemote',
									'listDirWithStatsRemote',
									'readBinaryFileRemoteAsBase64',
									'deleteRemote',
									'readDirRemote',
									'statRemote',
								]
						)
							.map((name) => `fail as ${name}`)
							.join(', ')} };`,
					}));
					if (ref)
						builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (args) => {
							const relative = path.relative(repo, args.path);
							if (!relative.startsWith('src/')) return;
							return {
								contents: execFileSync('git', ['show', `${ref}:${relative}`], {
									cwd: repo,
									encoding: 'utf8',
									maxBuffer: 32 * 1024 * 1024,
								}),
								loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
							};
						});
				},
			},
		],
	});
}
