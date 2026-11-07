import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createNativeTempDir } from '../../e2e/fixtures/native/temp-root.cjs';
import { createCorpus } from './fixtures.mjs';
import { buildVariant } from './build.mjs';
import { summarize } from './summary.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const rounds = Number(option('--rounds', '7'));
if (!Number.isInteger(rounds) || rounds < 3) throw Error('Use at least three rounds');
const before = option('--before');
const after = option('--after');
const output = path.resolve(option('--output', 'native-perf.json'));
const root = createNativeTempDir('maestro-perf-');
try {
	const corpus = await createCorpus(path.join(root, 'corpus'));
	const manifest = path.join(root, 'corpus.json');
	await fs.writeFile(manifest, JSON.stringify(corpus));
	const variants = before ? ['before', 'after'] : ['baseline'];
	for (const variant of variants)
		await buildVariant(
			repo,
			path.join(root, `${variant}.cjs`),
			variant === 'before' ? before : after
		);
	const bundleSha256 = Object.fromEntries(
		await Promise.all(
			variants.map(async (variant) => [
				variant,
				createHash('sha256')
					.update(await fs.readFile(path.join(root, `${variant}.cjs`)))
					.digest('hex'),
			])
		)
	);
	const samples = [];
	for (let round = 0; round < rounds; round++) {
		for (const variant of round % 2 ? [...variants].reverse() : variants) {
			const loadBefore = os.loadavg();
			const { stdout } = await promisify(execFile)(
				process.execPath,
				[
					'--expose-gc',
					fileURLToPath(new URL('./worker.mjs', import.meta.url)),
					path.join(root, `${variant}.cjs`),
					manifest,
					path.join(root, `${variant}-${round}`),
				],
				{ maxBuffer: 4 * 1024 * 1024 }
			);
			const sample = { round, variant, loadBefore, ...JSON.parse(stdout) };
			samples.push(sample);
			console.error(
				`Round ${round + 1}/${rounds} ${variant}: history ${sample.metrics['history.20projects'].ms.toFixed(1)}ms`
			);
		}
	}
	if (new Set(samples.map((s) => s.digest)).size !== 1)
		throw Error('Semantic outputs differ across variants or samples');
	const result = {
		schema: 1,
		date: new Date().toISOString(),
		sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: repo,
			encoding: 'utf8',
		}).trim(),
		bundleSha256,
		beforeRef: before ?? null,
		afterRef: after ?? null,
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		cpu: os.cpus()[0].model,
		cpuCount: os.cpus().length,
		totalMemBytes: os.totalmem(),
		corpus: {
			transcriptCount: corpus.transcriptCount,
			largestExpandedBytes: corpus.largestExpandedBytes,
			compressedCount: corpus.compressedCount,
			projectCount: corpus.projects.length,
		},
		methodology:
			'Fresh process and metadata cache each sample; OS page cache is not flushed. AB then BA in alternating rounds. Timings exclude fixture generation, bundling, GC and output hashing. RSS is end-of-operation; maxRSS is process-wide high water. p95 is nearest rank, not a latency guarantee. Local non-Git projects; no SSH or model invocation.',
		samples,
		summary: summarize(samples),
	};
	await fs.mkdir(path.dirname(output), { recursive: true });
	await fs.writeFile(output, JSON.stringify(result, null, '\t') + '\n');
} finally {
	await fs.rm(root, { recursive: true, force: true });
}
