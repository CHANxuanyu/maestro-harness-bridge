import * as fs from 'fs/promises';
import path from 'path';
import { isPathAtOrUnderRoot } from '../shared/worktreePaths';
import type {
	CheckDefinition,
	ConversationAutomationState,
} from '../shared/conversationAutomation';

const NODE_CODE_FLAG =
	/^(?:-e|--eval|-p|--print|-r|--require|--import|--loader|--experimental-loader)(?:=|$)/;

/** Conservative scope review, not a shell sandbox. Opaque programs need a one-use grant. */
export async function checkCommandBoundary(
	command: string,
	scope: Pick<ConversationAutomationState, 'cwd' | 'project' | 'host'>,
	seen = new Set<string>()
): Promise<CheckDefinition['boundary']> {
	if (!isPathAtOrUnderRoot(scope.cwd, scope.project)) return 'outside-project';
	if (
		/(^|[\s"'=])(?:\.\.(?:[/\\]|$)|~|\$HOME|%USERPROFILE%|[A-Za-z]:\\|\/(?!dev\/null))/.test(
			command
		)
	)
		return 'outside-project';
	if (
		/\b(?:curl|wget|ssh|scp|rsync|publish|push|upload|deploy|login|install|add)\b|https?:\/\//i.test(
			command
		)
	)
		return 'network';
	if (command.includes('&&')) {
		for (const part of command.split('&&')) {
			const boundary = await checkCommandBoundary(part, scope, new Set(seen));
			if (boundary) return boundary;
		}
		return undefined;
	}
	if (/[`$<>|;&\n\r(){}]/.test(command)) return 'unverified-command';
	const words = command.trim().split(/\s+/);
	if (words.some((word) => /["'\\]/.test(word))) return 'unverified-command';
	for (const word of words.slice(1)) {
		const value = word.replace(/^--?[^=]+=/, '');
		if (!value.startsWith('-')) {
			if (scope.host.kind === 'ssh') {
				if (value.includes('/')) return 'unverified-command';
				continue;
			}
			try {
				if (!isPathAtOrUnderRoot(await fs.realpath(path.resolve(scope.cwd, value)), scope.project))
					return 'outside-project';
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		}
	}
	const [program, verb, script] = words;
	if (['npm', 'pnpm', 'yarn'].includes(program)) {
		const name = verb === 'run' ? script : verb;
		if (!name || seen.has(name) || scope.host.kind === 'ssh') return 'unverified-command';
		if (
			!['test', 'lint', 'typecheck', 'check', 'build'].some(
				(prefix) => name === prefix || name.startsWith(`${prefix}:`)
			)
		)
			return 'unverified-command';
		try {
			const pkg = JSON.parse(await fs.readFile(path.join(scope.cwd, 'package.json'), 'utf8')) as {
				scripts?: Record<string, string>;
			};
			seen.add(name);
			for (const key of [`pre${name}`, name, `post${name}`]) {
				const source = pkg.scripts?.[key];
				if (!source && key === name) return 'unverified-command';
				if (source) {
					const boundary = await checkCommandBoundary(source, scope, seen);
					if (boundary) return boundary;
				}
			}
			return undefined;
		} catch (error) {
			if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
				return 'unverified-command';
			throw error;
		}
	}
	if (
		['tsc', 'vitest', 'jest', 'eslint', 'prettier', 'pytest', 'ruff'].includes(program) &&
		!words.some((word) => ['--config', '-c', '--plugin', '--require'].includes(word))
	)
		return undefined;
	// Built-in test runners, trusted like the tools above: they run the project's own
	// tests from the project directory. A flag that loads code from elsewhere (an eval
	// string, a preload, a loader) or widens a sandbox keeps the one-use grant.
	if (
		program === 'node' &&
		words.includes('--test') &&
		!words.some((word) => NODE_CODE_FLAG.test(word))
	)
		return undefined;
	if (
		['python', 'python3'].includes(program) &&
		verb === '-m' &&
		['pytest', 'unittest'].includes(script)
	)
		return undefined;
	if (program === 'go' && ['test', 'vet', 'build'].includes(verb)) return undefined;
	if (program === 'cargo' && ['test', 'check', 'clippy', 'build', 'fmt'].includes(verb))
		return undefined;
	if (
		['bun', 'deno'].includes(program) &&
		verb === 'test' &&
		!words.some((word) => /^(?:--allow-|-A$|--preload|-r$)/.test(word))
	)
		return undefined;
	if (['true', 'false', 'echo', 'printf', 'exit'].includes(program)) return undefined;
	if (program === 'git' && ['status', 'diff', 'log', 'show'].includes(verb)) return undefined;
	return 'unverified-command';
}
