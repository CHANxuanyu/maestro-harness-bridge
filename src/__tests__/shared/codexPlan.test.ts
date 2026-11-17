import { describe, expect, it } from 'vitest';
import { extractCodexPlan } from '../../shared/codexSessionText';

describe('extractCodexPlan', () => {
	const input = {
		explanation: 'Keep braces } and a quoted "step" intact',
		plan: [
			{ step: 'Review the sample', status: 'completed' },
			{ step: 'Check the sample', status: 'in_progress' },
			{ step: 'Report the sample', status: 'pending' },
		],
	};
	const json = JSON.stringify(input);
	const script = `text(await tools.update_plan(${json}));\n`;

	it.each(['update_plan', 'functions.update_plan'])(
		'accepts the old direct function call %s',
		(name) => {
			expect(extractCodexPlan({ type: 'function_call', name, arguments: json })).toEqual(input);
		}
	);

	it.each([
		script,
		`await tools.update_plan(${json});`,
		` text ( await tools . update_plan (\n${json}\n) ) ; `,
	])('parses a complete literal call without evaluating it: %s', (source) => {
		expect(
			extractCodexPlan({ type: 'custom_tool_call', name: 'exec', input: source, arguments: null })
		).toEqual(input);
	});

	it('preserves explicit clearing of a plan', () => {
		expect(
			extractCodexPlan({
				type: 'custom_tool_call',
				name: 'exec',
				input: 'text(await tools.update_plan({"plan":[]}));',
			})
		).toEqual({ plan: [] });
	});

	it.each([
		'text(await tools.update_plan({"plan":[',
		`text(await tools.update_plan(${json})); broken(`,
		`// ${script}`,
		JSON.stringify(script),
		`if (false) { ${script} }`,
		`function example() { ${script} }`,
		'text(await tools.update_plan(globalThis.plan));',
		'text(await tools.update_plan({"plan": globalThis.readSecrets()}));',
		'text(await tools.update_plan({"plan":[{"step":"x","status":"unknown"}]}));',
		'text(await tools.update_plan({"plan":[{"step":"","status":"completed"}]}));',
		'text(await tools.update_plan({"plan":[null]}));',
		'text(await tools.update_plan({"plan":null}));',
		'text(await tools.update_plan({}));',
	])('returns no plan for incomplete, computed or non-call source: %s', (source) => {
		expect(extractCodexPlan({ type: 'custom_tool_call', name: 'exec', input: source })).toBeNull();
	});

	it.each([
		null,
		{},
		{ type: 'message', name: 'exec', input: script },
		{ type: 'custom_tool_call', name: 'shell', input: script },
		{ type: 'function_call', name: 'update_plan', arguments: '{' },
	])('ignores unrelated or malformed native records: %j', (payload) =>
		expect(extractCodexPlan(payload)).toBeNull()
	);
});
