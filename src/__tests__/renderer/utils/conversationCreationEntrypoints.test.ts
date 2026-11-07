// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('requires a permission review when a conversation creation call is added or moved', () => {
	// Each entry documents the permission source at the call site. Keep wrappers
	// in this inventory too: initial logs do not make a fork native history.
	const reviewed: Record<string, string[]> = {
		'services/aiHandoff.ts:createTab': ['validated handoff source'],
		'stores/agentStore.ts:createTab': ['strictest known fallback for error recovery'],
		'stores/tabStore.ts:createTab': [
			'store wrapper forwards options or uses the strictest known fallback',
		],
		'utils/tabHelpers/index.ts:createTab': ['createTabAtPosition forwards the same options'],
		'hooks/agent/useCrossAgentDispatch.ts:createTab': ['strictest known fallback for context'],
		'hooks/tabs/internal/useAITabHandlers.ts:createTab': [
			'desktop response',
			'exact source or owner snapshots',
		],
		'hooks/tabs/tileNewTab.ts:createTab': ['project owner snapshots via tileNewTabInSession'],
		'hooks/remote/useRemoteIntegration.ts:createTab': [
			'owner snapshots for CLI',
			'stricter browser and owner source',
		],
		'hooks/agent/useAgentSessionManagement.ts:createTab': ['native history identity'],
		'hooks/wizard/useWizardHandlers.ts:createTab': ['strictest known fallback'],
		'hooks/agent/useForkConversation.ts:createTabAtPosition': [
			'exact source, validated first spawn',
		],
		'hooks/agent/useSummarizeAndContinue.ts:createTabAtPosition': [
			'exact source through project resolution; classic overrides preserved',
		],
	};
	const actual: Record<string, number> = {};
	const files = readdirSync('src/renderer', { recursive: true, encoding: 'utf8' })
		.map((file) => file.split(path.sep).join('/'))
		.filter(
			(file) =>
				/\.tsx?$/.test(file) && !file.includes('__tests__/') && !/\.(test|spec)\./.test(file)
		)
		.map((file) => `src/renderer/${file}`);
	for (const file of files) {
		const source = ts.createSourceFile(
			file,
			readFileSync(file, 'utf8'),
			ts.ScriptTarget.Latest,
			true
		);
		const names = new Map([
			['createTab', 'createTab'],
			['createTabAtPosition', 'createTabAtPosition'],
		]);
		for (const statement of source.statements) {
			if (!ts.isImportDeclaration(statement)) continue;
			const bindings = statement.importClause?.namedBindings;
			if (!bindings || !ts.isNamedImports(bindings)) continue;
			for (const binding of bindings.elements) {
				const original = (binding.propertyName ?? binding.name).text;
				if (names.has(original)) names.set(binding.name.text, original);
			}
		}
		function visit(node: ts.Node): void {
			if (ts.isCallExpression(node)) {
				const name = ts.isIdentifier(node.expression)
					? names.get(node.expression.text)
					: ts.isPropertyAccessExpression(node.expression)
						? names.get(node.expression.name.text)
						: undefined;
				if (name) {
					const key = `${file.slice('src/renderer/'.length)}:${name}`;
					actual[key] = (actual[key] ?? 0) + 1;
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(source);
	}
	expect(
		actual,
		'Review permissions and first spawn, then register each new call in this inventory.'
	).toEqual(
		Object.fromEntries(Object.entries(reviewed).map(([file, calls]) => [file, calls.length]))
	);
	// Parses every renderer file; the Windows runner needs well over the default.
}, 60_000);
