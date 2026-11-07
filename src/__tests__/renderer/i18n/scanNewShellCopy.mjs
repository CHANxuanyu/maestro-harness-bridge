import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const components = path.join(root, 'renderer/components');

// This inventory includes shared surfaces. Findings need a reachability review;
// provider output, commands, key names and user content are not product copy.
export const surfaces = {
	sidebar: [
		'SessionList/ProjectSessionTree.tsx',
		'SessionList/ProjectSessionSidebar.tsx',
		'SessionList/SidebarActions.tsx',
		'SessionList/HamburgerMenuContent.tsx',
		'ProjectStartView.tsx',
		'EmptyConversationPicker.tsx',
	],
	header: ['MainPanel/MainPanelHeader.tsx', 'MainPanel/BranchSwitcherDropdown.tsx'],
	composer: ['InputArea'],
	changes: ['ChangesPanel.tsx'],
	files: ['FileExplorerPanel', 'FilePreview'],
	terminal: [
		'NewShellTerminalPanel.tsx',
		'XTerminal.tsx',
		'TerminalView.tsx',
		'TerminalSearchBar.tsx',
		'TerminalSelectionContextMenu.tsx',
		'LinkContextMenu.tsx',
		'TerminalTouchBar.tsx',
	],
	tasks: ['TasksPanel.tsx'],
	errors: ['AgentErrorModal.tsx', 'MainPanel/AgentErrorBanner.tsx', 'RetryStatusCard.tsx'],
	toasts: ['Toast.tsx'],
	confirmations: [
		'ConfirmModal.tsx',
		'QuitConfirmModal.tsx',
		'DeleteAgentConfirmModal.tsx',
		'AppModals/AppConfirmModals.tsx',
	],
	updates: ['UpdatesChoiceModal.tsx'],
};

const visibleAttributes = new Set([
	'title',
	'aria-label',
	'aria-description',
	'ariaLabel',
	'helperText',
	'confirmLabel',
	'cancelLabel',
	'placeholder',
	'alt',
	'label',
	'description',
	'message',
	'emptyMessage',
	'confirmText',
	'cancelText',
]);

function shellValue(node) {
	if (ts.isParenthesizedExpression(node)) return shellValue(node.expression);
	if (ts.isIdentifier(node) && node.text === 'newShell') return true;
	if (
		ts.isBinaryExpression(node) &&
		node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
	) {
		const left = shellValue(node.left);
		const right = shellValue(node.right);
		return left === false || right === false
			? false
			: left === true && right === true
				? true
				: undefined;
	}
	if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
		const value = shellValue(node.operand);
		return value === undefined ? undefined : !value;
	}
	return undefined;
}

export function scanJsx(source, file = 'fixture.tsx', surface = 'fixture', options = {}) {
	const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const findings = [];
	function record(node, text, kind) {
		text = text.replace(/\s+/g, ' ').trim();
		if (!/[\p{L}]/u.test(text)) return;
		findings.push({
			surface,
			file,
			line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
			kind,
			text,
		});
	}
	function literal(node, kind) {
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
			record(node, node.text, kind);
		else if (ts.isParenthesizedExpression(node)) literal(node.expression, kind);
		else if (ts.isConditionalExpression(node)) {
			const value = shellValue(node.condition);
			if (value !== false) literal(node.whenTrue, kind);
			if (value !== true) literal(node.whenFalse, kind);
		} else if (ts.isBinaryExpression(node)) {
			if (shellValue(node.left) !== false) literal(node.right, kind);
			if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) literal(node.left, kind);
		} else if (ts.isTemplateExpression(node)) {
			record(node.head, node.head.text, kind);
			for (const span of node.templateSpans) record(span.literal, span.literal.text, kind);
		}
	}
	function visit(node) {
		if (
			ts.isCallExpression(node) &&
			/^(onShowFlash|setRenameError|setNewFileError)$/.test(node.expression.getText(tree)) &&
			node.arguments[0]
		)
			literal(node.arguments[0], 'feedback');
		if (
			options.translations &&
			ts.isCallExpression(node) &&
			['t', 'tRich'].includes(node.expression.getText(tree)) &&
			node.arguments[0]
		) {
			literal(node.arguments[0], 'translation');
		}
		if (
			ts.isJsxElement(node) &&
			['style', 'script'].includes(node.openingElement.tagName.getText(tree))
		)
			return;
		if (ts.isIfStatement(node)) {
			const value = shellValue(node.expression);
			if (value !== false) visit(node.thenStatement);
			if (value !== true && node.elseStatement) visit(node.elseStatement);
			return;
		}
		if (ts.isConditionalExpression(node)) {
			const value = shellValue(node.condition);
			if (value !== false) visit(node.whenTrue);
			if (value !== true) visit(node.whenFalse);
			return;
		}
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
			shellValue(node.left) === false
		)
			return;
		if (ts.isJsxText(node)) record(node, node.text, 'text');
		if (
			ts.isJsxAttribute(node) &&
			visibleAttributes.has(node.name.getText(tree)) &&
			node.initializer
		) {
			literal(
				ts.isJsxExpression(node.initializer)
					? (node.initializer.expression ?? node.initializer)
					: node.initializer,
				node.name.getText(tree)
			);
		}
		if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression)
			literal(node.expression, 'expression');
		ts.forEachChild(node, visit);
	}
	visit(tree);
	return findings;
}

function filesUnder(entry) {
	if (!fs.existsSync(entry)) throw new Error(`Missing audited surface: ${entry}`);
	if (fs.statSync(entry).isDirectory())
		return fs.readdirSync(entry).flatMap((child) => filesUnder(path.join(entry, child)));
	return /\.tsx?$/.test(entry) ? [entry] : [];
}

export function scanNewShellCopy(options = {}) {
	return Object.entries(surfaces).flatMap(([surface, entries]) =>
		entries.flatMap((entry) =>
			filesUnder(path.join(components, entry)).flatMap((file) =>
				scanJsx(fs.readFileSync(file, 'utf8'), path.relative(root, file), surface, options)
			)
		)
	);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(JSON.stringify(scanNewShellCopy(), null, 2));
}
