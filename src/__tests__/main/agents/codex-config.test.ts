/**
 * Tests for Codex config utilities
 *
 * Covers CODEX_HOME resolution, skill/prompt directory ordering, and the
 * frontmatter scanner that decides whether a file is offered as a `/command`.
 *
 * Path assertions are built with path.join so they hold on both CI legs -
 * POSIX literals pass locally and fail only on windows-latest.
 */

import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import {
	getCodexHome,
	getCodexSkillDirs,
	getCodexPromptDirs,
	parseCodexMarkdownDoc,
	parseCodexConfig,
} from '../../../main/agents/codex-config';

describe('codex-config', () => {
	describe('native default settings', () => {
		it('reads root scalars and the selected profile, ignoring unrelated tables', () => {
			expect(
				parseCodexConfig(
					'model = "root"\nprofile = "work"\nmodel_context_window = 123\n[ profiles . work ]\nmodel = \'profile-model\' # comment\n[mcp_servers.fixture]\nmodel = "wrong"'
				)
			).toEqual({ model: 'profile-model', contextWindow: 123 });
			expect(parseCodexConfig('[mcp_servers.fixture]\nmodel = "wrong"').model).toBeUndefined();
			expect(parseCodexConfig('[[servers]]\nmodel = "wrong"').model).toBeUndefined();
		});
		it('does not mistake multiline instruction text for native settings', () => {
			expect(
				parseCodexConfig('instructions = """\nmodel = "wrong"\n"""\nmodel = "right"').model
			).toBe('right');
			expect(() => parseCodexConfig('model = """bad\nvalue"""')).toThrow('Unsupported multiline');
		});
	});
	describe('getCodexHome', () => {
		it('defaults to ~/.codex', () => {
			expect(getCodexHome({})).toBe(path.join(os.homedir(), '.codex'));
		});

		it('honours CODEX_HOME so an alternate profile is probed', () => {
			expect(getCodexHome({ CODEX_HOME: path.join('/custom', 'codex') })).toBe(
				path.join('/custom', 'codex')
			);
		});
	});

	describe('getCodexSkillDirs', () => {
		it('puts the project-local dir ahead of the global one', () => {
			expect(getCodexSkillDirs(path.join('/project'), {})).toEqual([
				path.join('/project', '.codex', 'skills'),
				path.join(os.homedir(), '.codex', 'skills'),
			]);
		});

		it('omits the project dir when there is no cwd', () => {
			expect(getCodexSkillDirs(undefined, {})).toEqual([
				path.join(os.homedir(), '.codex', 'skills'),
			]);
		});
	});

	describe('getCodexPromptDirs', () => {
		it('probes both the project and global prompt dirs', () => {
			expect(getCodexPromptDirs(path.join('/project'), { CODEX_HOME: path.join('/ch') })).toEqual([
				path.join('/project', '.codex', 'prompts'),
				path.join('/ch', 'prompts'),
			]);
		});
	});

	describe('parseCodexMarkdownDoc', () => {
		it('extracts name and description and strips the frontmatter', () => {
			const doc = parseCodexMarkdownDoc(
				[
					'---',
					'name: ship-it',
					'description: Cut a release',
					'---',
					'',
					'# Ship It',
					'Do the thing.',
				].join('\n')
			);
			expect(doc.name).toBe('ship-it');
			expect(doc.description).toBe('Cut a release');
			expect(doc.userInvocable).toBe(true);
			expect(doc.body).toBe('# Ship It\nDo the thing.');
		});

		it('strips surrounding quotes from frontmatter values', () => {
			const doc = parseCodexMarkdownDoc(
				['---', 'description: "Quoted: value"', '---', 'body'].join('\n')
			);
			expect(doc.description).toBe('Quoted: value');
		});

		it('treats user-invocable: false as not offerable', () => {
			const doc = parseCodexMarkdownDoc(
				['---', 'name: internal', 'user-invocable: false', '---', 'body'].join('\n')
			);
			expect(doc.userInvocable).toBe(false);
		});

		it('defaults userInvocable to true when the key is absent', () => {
			expect(
				parseCodexMarkdownDoc(['---', 'name: x', '---', 'body'].join('\n')).userInvocable
			).toBe(true);
		});

		it('ignores an indented description nested under metadata', () => {
			const doc = parseCodexMarkdownDoc(
				[
					'---',
					'name: nested',
					'metadata:',
					'  description: not the skill description',
					'---',
					'body',
				].join('\n')
			);
			expect(doc.description).toBeUndefined();
		});

		it('treats a file without frontmatter as an all-body prompt', () => {
			const doc = parseCodexMarkdownDoc('Just a prompt body.\n');
			expect(doc.name).toBeUndefined();
			expect(doc.userInvocable).toBe(true);
			expect(doc.body).toBe('Just a prompt body.');
		});

		it('keeps the whole file when the frontmatter block is never closed', () => {
			const raw = '---\nname: broken\nstill going';
			expect(parseCodexMarkdownDoc(raw).body).toBe(raw);
		});

		it('parses CRLF files, so a Windows-authored skill is not skipped', () => {
			const doc = parseCodexMarkdownDoc(
				'---\r\nname: crlf\r\ndescription: Works\r\n---\r\nbody\r\n'
			);
			expect(doc.name).toBe('crlf');
			expect(doc.description).toBe('Works');
			expect(doc.body).toBe('body');
		});
	});
});
