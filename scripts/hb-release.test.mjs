import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	assetNames,
	checkCi,
	checkEvidence,
	checkSource,
	checkTagReuse,
	policy,
	versionFromTag,
} from './hb-release.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const version = '1.0.1-hb.5';
const sourceCommit = 'a'.repeat(40);
function evidence(change = () => {}) {
	const appName = `Maestro-I18n-${version}-mac-arm64.zip`;
	const connectorName = `Maestro-Codex-Shared-${version}.zip`;
	const files = {
		[appName]: Buffer.from('synthetic app'),
		[connectorName]: Buffer.from('synthetic connector'),
	};
	const artifact = (name) => ({ name, bytes: files[name].length, sha256: hash(files[name]) });
	const build = {
		version,
		sourceCommit,
		repository: `https://github.com/${policy.repository}`,
		artifact: artifact(appName),
		sharedConnector: { version, sourceCommit, artifact: artifact(connectorName) },
		nativeModuleSmoke: { arch: 'arm64', ptyExecution: true, sqlite: 42 },
	};
	const verification = {
		version,
		sourceCommit,
		local: { unitTests: { passed: 10, skipped: 1, failed: 0 } },
		github: { headSha: sourceCommit, conclusion: 'success', runId: 123 },
		privacy: {
			sourcePrivateMatches: 0,
			newCredentialMatches: 0,
			appPrivateMatches: 0,
			privateTranscriptsOrScreenshotsIncluded: false,
			accountFilesIncluded: false,
			rawLocalLogsIncluded: false,
		},
		gui: { fullOriginalCrossAppWriteSequenceRepeated: false },
		limits: ['Synthetic fixture, not real GUI evidence.'],
	};
	change(build, verification);
	files['BUILD-MANIFEST.json'] = Buffer.from(JSON.stringify(build));
	files['VERIFICATION.json'] = Buffer.from(JSON.stringify(verification));
	files['SHA256SUMS.txt'] = Buffer.from(
		Object.entries(files)
			.map(([name, data]) => `${hash(data)}  ${name}`)
			.join('\n') + '\n'
	);
	const inventory = Object.fromEntries(
		Object.entries(files).map(([name, data]) => [name, { bytes: data.length, sha256: hash(data) }])
	);
	return { files, inventory };
}
const verify = ({ files, inventory }) => checkEvidence(`v${version}`, files, inventory);

test('coherent package evidence with explicit limited GUI scope passes', () => {
	assert.equal(verify(evidence()).sourceCommit, sourceCommit);
	assert.equal(assetNames(version).length, 5);
});
test('rejects upstream, development and reserved failed-candidate tags', () => {
	for (const tag of ['v1.0.1', 'v1.0.1-hb.5-dev.1', 'v1.0.1-hb.1', 'v1.0.1-hb.05']) {
		assert.throws(() => versionFromTag(tag));
	}
});
test('rejects extra private files, missing files and tampered JSON', () => {
	const extra = evidence();
	extra.inventory['transcript.jsonl'] = { bytes: 1, sha256: 'b'.repeat(64) };
	assert.throws(() => verify(extra), /five public assets/);
	const missing = evidence();
	delete missing.inventory['VERIFICATION.json'];
	assert.throws(() => verify(missing));
	const corrupt = evidence();
	corrupt.files['VERIFICATION.json'] = Buffer.from('{}');
	assert.throws(() => verify(corrupt), /Hash mismatch/);
});
test('rejects checksum duplicates even when the uploaded checksum file itself matches', () => {
	const e = evidence();
	e.files['SHA256SUMS.txt'] = Buffer.concat([e.files['SHA256SUMS.txt'], e.files['SHA256SUMS.txt']]);
	e.inventory['SHA256SUMS.txt'] = {
		bytes: e.files['SHA256SUMS.txt'].length,
		sha256: hash(e.files['SHA256SUMS.txt']),
	};
	assert.throws(() => verify(e), /duplicate checksum/);
});
test('rejects versions or source commits from a different build', () => {
	assert.throws(() =>
		verify(
			evidence((build) => {
				build.sharedConnector.sourceCommit = 'b'.repeat(40);
			})
		)
	);
	assert.throws(() =>
		verify(
			evidence((_build, v) => {
				v.github.headSha = 'b'.repeat(40);
			})
		)
	);
	assert.throws(() =>
		verify(
			evidence((build) => {
				build.version = '1.0.1-hb.6';
			})
		)
	);
});
test('rejects failed tests, missing GUI scope, privacy failures and personal paths', () => {
	assert.throws(() =>
		verify(
			evidence((_b, v) => {
				v.local.unitTests.failed = 1;
			})
		)
	);
	assert.throws(() =>
		verify(
			evidence((_b, v) => {
				delete v.gui.fullOriginalCrossAppWriteSequenceRepeated;
			})
		)
	);
	assert.throws(() =>
		verify(
			evidence((_b, v) => {
				v.privacy.accountFilesIncluded = true;
			})
		)
	);
	assert.throws(
		() =>
			verify(
				evidence((b) => {
					b.buildDirectory = '/Users/example/private-build';
				})
			),
		/Private path/
	);
});
test('release CI must complete for the exact integration source, with all required jobs', () => {
	const ci = {
		headSha: sourceCommit,
		headBranch: policy.defaultBranch,
		event: 'push',
		status: 'completed',
		conclusion: 'success',
		jobs: policy.requiredCiJobs.map((name) => ({ name, conclusion: 'success' })),
	};
	checkCi(ci, sourceCommit);
	for (const patch of [
		{ headSha: 'b'.repeat(40) },
		{ event: 'pull_request' },
		{ status: 'in_progress' },
		{ headBranch: 'feature' },
		{ jobs: ci.jobs.slice(1) },
		{ jobs: [...ci.jobs, { name: 'extra', conclusion: 'skipped' }] },
	]) {
		assert.throws(() => checkCi({ ...ci, ...patch }, sourceCommit));
	}
});
test('source gate catches lock drift and stale README version links', () => {
	const source = {
		pkg: { version },
		lock: { version, packages: { '': { version } } },
		changelog: `## ${version} · preview`,
		readme: `verification/v${version}.md`,
		fork: `verification/v${version}.md`,
		verificationExists: true,
	};
	checkSource(source);
	assert.throws(() => checkSource({ ...source, readme: 'verification/v1.0.1-hb.2.md' }));
	assert.throws(() => checkSource({ ...source, lock: { ...source.lock, version: '0.0.0' } }));
	assert.throws(() => checkSource({ ...source, verificationExists: false }));
});
test('checked-in default-branch rules require all CI jobs and PRs without a solo-maintainer deadlock', () => {
	const ruleset = JSON.parse(
		readFileSync(new URL('../.github/rulesets/hb-integration.json', import.meta.url))
	);
	assert.deepEqual(ruleset.bypass_actors, []);
	assert(
		ruleset.rules.some(
			(rule) =>
				rule.type === 'pull_request' && rule.parameters.required_approving_review_count === 0
		)
	);
	const checks = ruleset.rules.find((rule) => rule.type === 'required_status_checks').parameters
		.required_status_checks;
	assert.deepEqual(
		checks.map((check) => check.context).sort(),
		[...policy.requiredCiJobs, 'HB release policy'].sort()
	);
	assert(checks.every((check) => check.integration_id === 15368));
});

test('an existing release tag can only resume the same source commit', () => {
	checkTagReuse(undefined, sourceCommit);
	checkTagReuse(sourceCommit, sourceCommit);
	assert.throws(() => checkTagReuse('b'.repeat(40), sourceCommit), /new HB number/);
});

test('JSON escaping cannot hide Windows account paths in evidence', () => {
	assert.throws(
		() =>
			verify(
				evidence((build) => {
					build.buildDirectory = String.raw`C:\Users\example\private-build`;
				})
			),
		/Private path/
	);
});
