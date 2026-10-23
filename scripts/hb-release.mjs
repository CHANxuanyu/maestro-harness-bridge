#!/usr/bin/env node
// Read-only checks for this fork. Does not publish, upload, tag, install or activate a harness.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const policy = JSON.parse(readFileSync(path.join(ROOT, '.github/hb-release-policy.json')));
const versionPattern = /^\d+\.\d+\.\d+-hb\.[1-9]\d*$/;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const json = (data) => JSON.parse(data.toString());
const evidenceStrings = (value) =>
	typeof value === 'string'
		? [value]
		: value && typeof value === 'object'
			? Object.entries(value).flatMap(([key, item]) => [key, ...evidenceStrings(item)])
			: [];

export function versionFromTag(tag) {
	assert(
		typeof tag === 'string' && tag.startsWith('v') && versionPattern.test(tag.slice(1)),
		'Use a published-channel tag vX.Y.Z-hb.N, not an upstream or development tag.'
	);
	assert(
		!policy.reservedUnpublishedTags.includes(tag),
		'This failed candidate number is reserved.'
	);
	return tag.slice(1);
}

export function assetNames(version) {
	return [
		'BUILD-MANIFEST.json',
		`Maestro-Codex-Shared-${version}.zip`,
		`Maestro-I18n-${version}-mac-arm64.zip`,
		'SHA256SUMS.txt',
		'VERIFICATION.json',
	].sort();
}

export function checkSource({ pkg, lock, changelog, readme, fork, verificationExists }) {
	assert.match(pkg.version, /^\d+\.\d+\.\d+-hb\.[1-9]\d*(?:-dev\.[1-9]\d*)?$/);
	assert.equal(lock.version, pkg.version, 'package-lock root version differs.');
	assert.equal(lock.packages[''].version, pkg.version, 'package-lock package version differs.');
	if (versionPattern.test(pkg.version)) {
		assert(
			changelog.split('\n').some((line) => line.startsWith(`## ${pkg.version} · `)),
			'Product changelog must describe this version.'
		);
		assert(verificationExists, 'A version-specific verification record is required.');
		for (const content of [readme, fork]) {
			assert(
				content.includes(`verification/v${pkg.version}.md`),
				'Fork entry points must link to the current verification record.'
			);
		}
	}
	return pkg.version;
}

export function checkCi(ci, sourceCommit) {
	assert.equal(ci.headSha, sourceCommit, 'CI must cover the artifact source commit.');
	assert.equal(ci.status, 'completed', 'CI is still running.');
	assert.equal(ci.conclusion, 'success', 'CI did not pass.');
	assert.equal(
		ci.headBranch,
		policy.defaultBranch,
		'Release CI must run on the integration branch.'
	);
	assert(
		['push', 'workflow_dispatch'].includes(ci.event),
		'A PR test merge is not release-source CI.'
	);
	assert.equal(
		new Set(ci.jobs.map((job) => job.name)).size,
		ci.jobs.length,
		'Duplicate CI job names.'
	);
	for (const name of policy.requiredCiJobs) {
		assert(
			ci.jobs.some((job) => job.name === name && job.conclusion === 'success'),
			`Missing CI: ${name}`
		);
	}
	assert(
		ci.jobs.every((job) => job.conclusion === 'success'),
		'A CI job was skipped or failed.'
	);
}

// inventory comes from local file hashes or GitHub's uploaded-asset digests.
// Small JSON/checksum files are always read and hashed; ZIPs need not be downloaded twice.
export function checkEvidence(tag, files, inventory) {
	const version = versionFromTag(tag);
	const names = assetNames(version);
	assert.deepEqual(
		Object.keys(inventory).sort(),
		names,
		'Exactly five public assets are required.'
	);
	for (const [name, item] of Object.entries(inventory)) {
		assert(item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256), `Invalid asset identity: ${name}`);
	}
	for (const name of ['BUILD-MANIFEST.json', 'VERIFICATION.json', 'SHA256SUMS.txt']) {
		assert(files[name], `Missing ${name}`);
		assert.equal(sha256(files[name]), inventory[name].sha256, `Hash mismatch: ${name}`);
		assert.equal(files[name].length, inventory[name].bytes, `Size mismatch: ${name}`);
		const text = name.endsWith('.json')
			? evidenceStrings(json(files[name])).join('\n')
			: files[name].toString();
		assert(
			!/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{24,})/.test(
				text
			),
			`Private path or credential pattern in ${name}; inspect locally.`
		);
	}
	const sums = new Map();
	for (const line of files['SHA256SUMS.txt'].toString().trim().split('\n')) {
		const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
		assert(match && !sums.has(match[2]), 'Invalid or duplicate checksum entry.');
		sums.set(match[2], match[1]);
	}
	assert.deepEqual(
		[...sums.keys()].sort(),
		names.filter((name) => name !== 'SHA256SUMS.txt')
	);
	for (const [name, digest] of sums)
		assert.equal(digest, inventory[name].sha256, `Checksum mismatch: ${name}`);
	const build = json(files['BUILD-MANIFEST.json']);
	const verification = json(files['VERIFICATION.json']);
	assert.equal(build.version, version);
	assert.equal(verification.version, version);
	assert.match(build.sourceCommit, /^[a-f0-9]{40}$/);
	assert.equal(verification.sourceCommit, build.sourceCommit);
	assert.equal(build.repository, `https://github.com/${policy.repository}`);
	assert.equal(build.sharedConnector.sourceCommit, build.sourceCommit);
	assert.equal(build.sharedConnector.version, version);
	for (const artifact of [build.artifact, build.sharedConnector.artifact]) {
		assert.deepEqual(
			inventory[artifact.name],
			{ bytes: artifact.bytes, sha256: artifact.sha256 },
			'Package identity differs.'
		);
	}
	assert.equal(build.artifact.name, `Maestro-I18n-${version}-mac-arm64.zip`);
	assert.equal(build.sharedConnector.artifact.name, `Maestro-Codex-Shared-${version}.zip`);
	assert.equal(build.nativeModuleSmoke.arch, 'arm64');
	assert.equal(build.nativeModuleSmoke.ptyExecution, true);
	assert.equal(build.nativeModuleSmoke.sqlite, 42);
	assert.equal(verification.local.unitTests.failed, 0);
	assert(verification.local.unitTests.passed > 0);
	assert.equal(verification.github.headSha, build.sourceCommit);
	assert.equal(verification.github.conclusion, 'success');
	assert(Number.isSafeInteger(verification.github.runId) && verification.github.runId > 0);
	for (const key of ['sourcePrivateMatches', 'newCredentialMatches', 'appPrivateMatches']) {
		assert.equal(verification.privacy[key], 0, `Privacy check did not pass: ${key}`);
	}
	for (const key of [
		'privateTranscriptsOrScreenshotsIncluded',
		'accountFilesIncluded',
		'rawLocalLogsIncluded',
	]) {
		assert.equal(verification.privacy[key], false, `Public assets must exclude ${key}`);
	}
	const fullGui =
		verification.gui?.fullOriginalCrossAppWriteSequenceRepeated ??
		(policy.legacyMutableTags.includes(tag)
			? verification.gui?.fullOriginalCrossAppWriteSequenceRepeatedForHb4
			: undefined);
	assert.equal(typeof fullGui, 'boolean', 'Explicit GUI scope is required.');
	assert(
		Array.isArray(verification.limits) && verification.limits.length > 0,
		'Record known limitations.'
	);
	return { version, sourceCommit: build.sourceCommit, ciRunId: verification.github.runId };
}

const run = (command, args) =>
	execFileSync(command, args, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
const gh = (args) => json(run('gh', args));
const api = (route) => gh(['api', `repos/${policy.repository}/${route}`]);
const remoteCi = (id) =>
	gh([
		'run',
		'view',
		String(id),
		'--repo',
		policy.repository,
		'--json',
		'headSha,headBranch,event,status,conclusion,jobs',
	]);

export function checkTagReuse(existingCommit, sourceCommit) {
	assert(
		existingCommit === undefined || existingCommit === sourceCommit,
		'This version already names different source. Use a new HB number, never move the tag.'
	);
}

function resolveTag(reference) {
	assert.equal(reference.type, 'tag', 'Use an annotated release tag.');
	const target = api(`git/tags/${reference.sha}`).object;
	assert.equal(target.type, 'commit');
	return target.sha;
}

function localAssets(directory) {
	const files = Object.fromEntries(
		readdirSync(directory).map((name) => [name, readFileSync(path.join(directory, name))])
	);
	const inventory = Object.fromEntries(
		Object.entries(files).map(([name, data]) => [
			name,
			{ bytes: data.length, sha256: sha256(data) },
		])
	);
	return { files, inventory };
}

function main(args) {
	const command = args.shift();
	const options = {};
	while (args.length) {
		const key = args.shift();
		assert(
			['--tag', '--dir', '--notes', '--state'].includes(key) && args.length,
			`Unknown option: ${key}`
		);
		assert(!(key in options), `Duplicate option: ${key}`);
		options[key] = args.shift();
	}
	if (command === 'check') {
		assert.equal(Object.keys(options).length, 0);
		const pkg = json(readFileSync(path.join(ROOT, 'package.json')));
		checkSource({
			pkg,
			lock: json(readFileSync(path.join(ROOT, 'package-lock.json'))),
			changelog: readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'),
			readme: readFileSync(path.join(ROOT, 'README.md'), 'utf8'),
			fork: readFileSync(path.join(ROOT, 'docs/fork.md'), 'utf8'),
			verificationExists: existsSync(path.join(ROOT, `docs/verification/v${pkg.version}.md`)),
		});
		console.log(`HB source policy passed: ${pkg.version}`);
		return;
	}
	assert(
		['assets', 'verify'].includes(command),
		'Usage: hb-release.mjs check | assets --dir DIR | verify --tag TAG [--dir DIR] [--notes FILE] [--state draft|published]'
	);
	if (command === 'assets') {
		assert(options['--dir'] && Object.keys(options).length === 1, 'assets requires only --dir.');
		const { files, inventory } = localAssets(options['--dir']);
		const version = json(readFileSync(path.join(ROOT, 'package.json'))).version;
		const result = checkEvidence(`v${version}`, files, inventory);
		assert.equal(
			run('git', ['status', '--porcelain']).toString().trim(),
			'',
			'Commit source changes before building.'
		);
		assert.equal(
			run('git', ['rev-parse', 'HEAD']).toString().trim(),
			result.sourceCommit,
			'Rebuild from this commit.'
		);
		checkCi(remoteCi(result.ciRunId), result.sourceCommit);
		const tag = `v${version}`;
		const existing = api(`git/matching-refs/tags/${tag}`).find(
			(reference) => reference.ref === `refs/tags/${tag}`
		);
		checkTagReuse(existing ? resolveTag(existing.object) : undefined, result.sourceCommit);
		console.log(JSON.stringify(result, null, 2));
		return;
	}
	const tag = options['--tag'];
	versionFromTag(tag);
	const state = options['--state'] || 'published';
	assert(['draft', 'published'].includes(state));
	// The by-tag REST endpoint can return 404 for a draft; resolve its existing ID from the list.
	const releases = gh([
		'api',
		`repos/${policy.repository}/releases?per_page=100`,
		'--paginate',
		'--slurp',
	]).flat();
	const matches = releases.filter((release) => release.tag_name === tag);
	assert.equal(
		matches.length,
		1,
		'Expected exactly one existing release; do not create a duplicate.'
	);
	const release = matches[0];
	assert.equal(release.draft, state === 'draft');
	assert.equal(release.prerelease, true, 'HB releases are previews.');
	if (!release.draft && !policy.legacyMutableTags.includes(tag))
		assert.equal(release.immutable, true, 'New published releases must be immutable.');
	const inventory = Object.fromEntries(
		release.assets.map((asset) => {
			assert.equal(asset.state, 'uploaded');
			assert(asset.digest?.startsWith('sha256:'), 'GitHub did not return an asset digest.');
			return [asset.name, { bytes: asset.size, sha256: asset.digest.slice(7) }];
		})
	);
	assert.equal(Object.keys(inventory).length, release.assets.length, 'Duplicate uploaded assets.');
	let files;
	if (options['--dir']) {
		const local = localAssets(options['--dir']);
		assert.deepEqual(
			local.inventory,
			inventory,
			'Uploaded files differ from the reviewed local files.'
		);
		files = local.files;
	} else {
		files = {};
		for (const name of ['BUILD-MANIFEST.json', 'VERIFICATION.json', 'SHA256SUMS.txt']) {
			const asset = release.assets.find((item) => item.name === name);
			assert(asset && asset.size < 1024 * 1024, `Missing or oversized evidence: ${name}`);
			files[name] = run('gh', [
				'api',
				'-H',
				'Accept: application/octet-stream',
				`repos/${policy.repository}/releases/assets/${asset.id}`,
			]);
		}
	}
	const result = checkEvidence(tag, files, inventory);
	const target = api(`git/ref/tags/${encodeURIComponent(tag)}`).object;
	assert.equal(resolveTag(target), result.sourceCommit, 'Tag and package source differ.');
	const contents = api(`contents/package.json?ref=${encodeURIComponent(tag)}`);
	assert.equal(json(Buffer.from(contents.content, 'base64')).version, result.version);
	checkCi(remoteCi(result.ciRunId), result.sourceCommit);
	if (options['--notes'])
		assert.equal(
			release.body.trim(),
			readFileSync(options['--notes'], 'utf8').trim(),
			'Release notes differ.'
		);
	console.log(
		JSON.stringify(
			{
				...result,
				url: release.html_url,
				state,
				immutable: release.immutable,
				legacyMutable: policy.legacyMutableTags.includes(tag),
				verifiedAssets: release.assets.length,
			},
			null,
			2
		)
	);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
