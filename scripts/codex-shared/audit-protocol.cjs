'use strict';
// Official public schemas omit experimental queue/background methods. Their
// exact Rust declarations and method mappings are checked before supplementing
// the projection. This is an audit tool, not a runtime compatibility fallback.
const fs = require('node:fs');
const path = require('node:path');
const { project, compare } = require('./protocol-check.cjs');
const surface = require('./protocol-surface.json');
const versions = require('./versions.json');

function declarations(source) {
	return Object.fromEntries(
		Object.keys(surface.experimentalDeclarations).map((name) => {
			const declaration = source.match(
				new RegExp('pub struct ' + name + ' \\{[\\s\\S]*?\\n\\}')
			)?.[0];
			return [
				name,
				declaration
					?.replace(/^\s*\/\/\/.*$/gm, '')
					.replace(/\s+/g, ' ')
					.trim(),
			];
		})
	);
}

function officialProjection(schema, sources) {
	for (const [name, expected] of Object.entries(surface.experimentalDeclarations)) {
		if (declarations(sources.thread)[name] !== expected)
			throw new Error('Experimental protocol changed: ' + name);
	}
	const copy = structuredClone(schema);
	for (const [method, base] of [
		['thread/queue/list', 'ThreadQueueList'],
		['thread/backgroundTerminals/list', 'ThreadBackgroundTerminalsList'],
	]) {
		const mapping = `${base} => "${method}" {\n        params: v2::${base}Params,\n        serialization: thread_id(params.thread_id),\n        response: v2::${base}Response,\n    }`;
		if (!sources.common.includes(mapping))
			throw new Error('Experimental method changed: ' + method);
		copy.definitions.v2[base + 'Params'] = {
			type: 'object',
			required: ['threadId'],
			properties: {
				threadId: { type: 'string' },
				...copy.definitions.v2.ThreadLoadedListParams.properties,
			},
		};
		copy.definitions.v2[base + 'Response'] = {
			type: 'object',
			properties: { data: { type: 'array' } },
		};
		copy.definitions.ClientRequest.oneOf.push({ properties: { method: { enum: [method] } } });
	}
	return project(copy);
}

async function audit(directory) {
	const reports = [];
	for (const entry of versions) {
		const version = entry.version.replace('codex-cli ', '');
		let schema, sources;
		if (directory) {
			schema = JSON.parse(fs.readFileSync(path.join(directory, version + '.json'), 'utf8'));
			sources = JSON.parse(fs.readFileSync(path.join(directory, 'sources.json'), 'utf8'))[version];
		} else {
			const read = async (file) => {
				const url = `https://raw.githubusercontent.com/openai/codex/${entry.commit}/codex-rs/app-server-protocol/${file}`;
				const response = await fetch(url);
				if (!response.ok) throw new Error(`${response.status}: ${url}`);
				return response.text();
			};
			const [json, thread, common] = await Promise.all([
				read('schema/json/codex_app_server_protocol.schemas.json'),
				read('src/protocol/v2/thread.rs'),
				read('src/protocol/common.rs'),
			]);
			schema = JSON.parse(json);
			sources = { thread, common };
		}
		reports.push({
			version: entry.version,
			commit: entry.commit,
			differences: compare(
				officialProjection(schema, sources),
				require('./protocol-baseline.json')
			),
		});
	}
	return reports;
}

module.exports = { officialProjection, audit };
if (require.main === module)
	audit(process.argv[2])
		.then((reports) => {
			console.log(JSON.stringify(reports, null, 2));
			if (reports.some((entry) => entry.differences.length)) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(error.message);
			process.exitCode = 1;
		});
