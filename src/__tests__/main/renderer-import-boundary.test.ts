import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('keeps runtime renderer imports out of main process modules', () => {
	const root = resolve('src/main');
	const violations: string[] = [];
	for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.ts') || /\.(test|spec|d)\.ts$/.test(entry.name))
			continue;
		const file = join(entry.parentPath, entry.name);
		if (file.includes('__tests__')) continue;
		const source = ts.createSourceFile(
			file,
			readFileSync(file, 'utf8'),
			ts.ScriptTarget.Latest,
			true
		);
		const visit = (node: ts.Node) => {
			let target: ts.Expression | undefined;
			if (ts.isImportDeclaration(node)) {
				const clause = node.importClause;
				const bindings = clause?.namedBindings;
				const typeOnly =
					clause?.isTypeOnly ||
					(!clause?.name &&
						bindings &&
						ts.isNamedImports(bindings) &&
						bindings.elements.length > 0 &&
						bindings.elements.every((item) => item.isTypeOnly));
				if (!typeOnly) target = node.moduleSpecifier;
			} else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
				if (
					!node.exportClause ||
					!ts.isNamedExports(node.exportClause) ||
					!node.exportClause.elements.every((item) => item.isTypeOnly)
				)
					target = node.moduleSpecifier;
			} else if (
				ts.isCallExpression(node) &&
				(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
					(ts.isIdentifier(node.expression) && node.expression.text === 'require'))
			) {
				target = node.arguments[0];
			}
			if (target && ts.isStringLiteral(target) && /(^|\/)renderer(\/|$)/.test(target.text))
				violations.push(`${relative(root, file)}: ${target.text}`);
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	expect(violations).toEqual([]);
});
