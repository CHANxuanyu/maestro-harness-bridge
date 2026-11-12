import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	parseBaselineArgs,
	parseReadyTiming,
	summarizeStartup,
	bundleBytes,
	baselineEnvironment,
} from './hb-baseline.mjs';

test('parses app or zip paths with bounded positive run counts', () => {
	assert.deepEqual(parseBaselineArgs(['Some App.app', '--runs', '4']), {
		artifact: path.resolve('Some App.app'),
		runs: 4,
		timeoutMs: 60000,
	});
	assert.equal(parseBaselineArgs(['candidate.zip']).runs, 5);
	for (const args of [
		[],
		['x'],
		['x.app', '--runs', '0'],
		['x.zip', '--runs', '1.5'],
		['x.app', '--runs', 'NaN'],
		['x.app', '--runs'],
		['x.app', '--runs', '101'],
		['x.app', '--unknown'],
		['x.app', '--timeout-ms', '-1'],
	]) {
		assert.throws(() => parseBaselineArgs(args));
	}
});

test('uses the renderer ready timestamp, not the later polling receipt', () => {
	assert.equal(parseReadyTiming({ timeOrigin: 1200, ready: 123.5 }, 1000), 323.5);
	for (const value of [
		null,
		{},
		{ timeOrigin: 1200, ready: -1 },
		{ timeOrigin: 0, ready: 1 },
		{ timeOrigin: 1200, ready: '2' },
		{ timeOrigin: Infinity, ready: 1 },
	]) {
		assert.throws(() => parseReadyTiming(value, 1000));
	}
});

test('median covers odd and even samples without sorting the source', () => {
	const samples = [30, 10, 20];
	assert.equal(summarizeStartup(samples).median, 20);
	assert.deepEqual(samples, [30, 10, 20]);
	assert.equal(summarizeStartup([50, 10, 30, 20]).median, 25);
	assert.equal(summarizeStartup([12]).median, 12);
	for (const values of [[], [NaN], [Infinity], [-1]]) assert.throws(() => summarizeStartup(values));
});

test('bundle size counts regular bytes once and never follows symlinks', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-baseline-size-'));
	try {
		fs.mkdirSync(path.join(root, 'bundle'));
		fs.writeFileSync(path.join(root, 'bundle', 'app.asar'), '12345');
		fs.writeFileSync(path.join(root, 'outside'), 'should not be counted');
		fs.symlinkSync('../outside', path.join(root, 'bundle', 'link'));
		assert.equal(bundleBytes(path.join(root, 'bundle')), 5);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('launch environment contains only isolated account paths and no inherited secrets', () => {
	const env = baselineEnvironment('/tmp/hb-baseline-test');
	assert.equal(env.MAESTRO_DEMO_DIR, '/tmp/hb-baseline-test/data');
	assert.equal(env.HOME, '/tmp/hb-baseline-test/home');
	assert.equal(env.CODEX_HOME, '/tmp/hb-baseline-test/codex');
	assert.equal(env.CLAUDE_CONFIG_DIR, '/tmp/hb-baseline-test/claude');
	assert.equal(env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
	assert.equal(env.NODE_OPTIONS, undefined);
	assert.equal(env.ANTHROPIC_API_KEY, undefined);
});
