'use strict';

// Compare only the shared client's documented protocol surface. Source revisions
// and experimental definitions are recorded in protocol-surface.json.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const surface = require('./protocol-surface.json');

function dereference(schema, root) {
	return schema?.$ref
		? schema.$ref
				.slice(2)
				.split('/')
				.reduce((value, key) => value?.[key], root)
		: schema;
}

function select(schema, parts, root) {
	schema = dereference(schema, root);
	if (!schema) return undefined;
	if (!parts.length) return schema;
	if (schema.anyOf || schema.oneOf) {
		const choices = (schema.anyOf || schema.oneOf)
			.map((choice) => select(choice, parts, root))
			.filter(Boolean);
		return choices.length ? { anyOf: choices } : undefined;
	}
	return select(schema.properties?.[parts[0]], parts.slice(1), root);
}

function shape(schema, root, seen = []) {
	if (!schema) return { missing: true };
	if (schema.$ref) {
		if (seen.includes(schema.$ref)) return { recursive: schema.$ref };
		return shape(dereference(schema, root), root, [...seen, schema.$ref]);
	}
	const result = {};
	for (const key of Object.keys(schema).sort()) {
		if (['description', 'title', '$schema', 'default', 'examples', 'deprecated'].includes(key))
			continue;
		if (key === 'properties')
			result[key] = Object.fromEntries(
				Object.keys(schema[key])
					.sort()
					.map((name) => [name, shape(schema[key][name], root, seen)])
			);
		else if (['anyOf', 'oneOf', 'allOf'].includes(key))
			result[key] = schema[key].map((item) => shape(item, root, seen));
		else if (['items', 'additionalProperties'].includes(key) && typeof schema[key] === 'object')
			result[key] = shape(schema[key], root, seen);
		else result[key] = schema[key];
	}
	return result;
}

function project(root) {
	const result = {};
	for (const [name, definition] of Object.entries(surface.definitions)) {
		const schema = name.split('/').reduce((value, key) => value?.[key], root.definitions);
		if (definition.request) result[name + '.$required'] = schema?.required || [];
		for (const field of definition.paths) {
			const selected = select(schema, field.split('.'), root);
			// Queue entries and background terminals are only counted, never read.
			result[name + '.' + field] =
				field === 'item.type' && selected
					? { type: 'string' }
					: field === 'data' && definition.experimental
						? { type: selected?.type || 'missing' }
						: shape(selected, root);
		}
	}
	for (const item of root.definitions.v2.ThreadItem.oneOf) {
		const type = item.properties.type.enum[0];
		// Other item bodies are passed through as JSON, not decoded. Removing
		// one such variant does not change the fields the connector depends on.
		if (!surface.handledItems.includes(type)) continue;
		for (const field of surface.itemFields) {
			if (item.properties[field])
				result['ThreadItem.' + type + '.' + field] = shape(item.properties[field], root);
		}
	}
	const requests = root.definitions.ClientRequest.oneOf.map(
		(entry) => entry.properties.method.enum[0]
	);
	for (const method of Object.keys(surface.requests))
		result['method.' + method] = requests.includes(method);
	return result;
}

function compare(actual, expected) {
	const differences = [];
	for (const key of Object.keys(expected)) {
		if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
			differences.push({
				field: key,
				expected: expected[key],
				actual: actual[key] ?? { missing: true },
			});
	}
	return differences;
}

function inspectNative(executable) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-protocol-'));
	try {
		// Official cli/src/main.rs GenerateJsonSchemaCommand at the pinned commit.
		execFileSync(
			executable,
			['app-server', 'generate-json-schema', '--experimental', '--out', root],
			{
				stdio: ['ignore', 'pipe', 'pipe'],
				timeout: 30000,
			}
		);
		const schema = JSON.parse(
			fs.readFileSync(path.join(root, 'codex_app_server_protocol.schemas.json'), 'utf8')
		);
		return compare(project(schema), require('./protocol-baseline.json'));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

module.exports = { project, compare, inspectNative };
if (require.main === module) {
	try {
		console.log(JSON.stringify({ differences: inspectNative(process.argv[2]) }));
	} catch (error) {
		console.error('Protocol export unavailable: ' + error.message);
		process.exitCode = 1;
	}
}
