import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AboutMeSection } from '../../../../renderer/components/Settings/tabs/GeneralTab/components/AboutMeSection';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { createMockSession } from '../../../helpers/mockSession';
import { mockTheme } from '../../../helpers/mockTheme';
import type { AboutMeCommand, AboutMeFileStatus, AboutMeResult } from '../../../../shared/aboutMe';

const BLOCK = '<!-- maestro:about-me:start -->\nWritten by hand\n<!-- maestro:about-me:end -->';

function file(overrides: Partial<AboutMeFileStatus>): AboutMeFileStatus {
	const path = overrides.path ?? '/accounts/claude/CLAUDE.md';
	return {
		path,
		aliases: [path],
		providers: ['claude-code'],
		agentIds: [],
		resolvedPath: path,
		currentBlock: null,
		state: 'synced',
		shadowedBy: [],
		...overrides,
	};
}

// A stand-in for the main-process service: `set` keeps the text it is given,
// `status` reports `files`, and `apply` answers with `applyResult`.
let files: AboutMeFileStatus[];
let applyResult: (command: Extract<AboutMeCommand, { action: 'apply' }>) => AboutMeResult;
let setResult: ((content: string) => AboutMeResult) | null;
const aboutMe = vi.mocked(window.maestro.settings.aboutMe);

function serviceResult(extra: Partial<AboutMeResult> = {}): AboutMeResult {
	const content = useSettingsStore.getState().conductorProfile;
	return {
		success: true,
		content,
		estimatedTokens: Math.ceil(content.length / 4),
		files: [],
		...extra,
	};
}

function Harness() {
	const conductorProfile = useSettingsStore((state) => state.conductorProfile);
	const saveConductorProfile = useSettingsStore((state) => state.saveConductorProfile);
	return (
		<AboutMeSection
			theme={mockTheme}
			isOpen
			conductorProfile={conductorProfile}
			saveConductorProfile={saveConductorProfile}
		/>
	);
}

async function renderSection() {
	render(<Harness />);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(50);
	});
}

async function settle(ms = 50) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

const row = (path: string) => screen.getByTestId(`about-me-file-${path}`);
const writeButton = () => screen.getByTestId('about-me-write');
const applyCalls = () =>
	aboutMe.mock.calls.map(([command]) => command).filter((command) => command.action === 'apply');

beforeEach(() => {
	vi.useFakeTimers();
	useSettingsStore.setState({ conductorProfile: 'I prefer short answers.' });
	files = [];
	setResult = null;
	applyResult = () => serviceResult({ files });
	aboutMe.mockReset();
	aboutMe.mockImplementation(async (command: AboutMeCommand) => {
		if (command.action === 'set') {
			if (setResult) return setResult(command.content);
			return {
				success: true,
				content: command.content,
				estimatedTokens: Math.ceil(command.content.length / 4),
				files: [],
			};
		}
		if (command.action === 'status') return serviceResult({ files });
		if (command.action === 'apply') return applyResult(command);
		return serviceResult();
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe('AboutMeSection editor', () => {
	it('shows and saves a profile longer than 5000 characters without cutting it', async () => {
		const long = `${'a'.repeat(6000)}END`;
		useSettingsStore.setState({ conductorProfile: long });
		await renderSection();

		const editor = screen.getByRole('textbox', { name: 'About Me' }) as HTMLTextAreaElement;
		expect(editor.value).toBe(long);
		expect(editor.hasAttribute('maxLength')).toBe(false);
		expect(screen.getByTestId('about-me-tokens')).toHaveTextContent('~1.5K tokens');

		fireEvent.change(editor, { target: { value: `${long} and more` } });
		await settle(1000);

		expect(aboutMe).toHaveBeenCalledWith({ action: 'set', content: `${long} and more` });
		expect(useSettingsStore.getState().conductorProfile).toBe(`${long} and more`);
		expect(window.maestro.settings.set).not.toHaveBeenCalledWith(
			'conductorProfile',
			expect.anything()
		);
		expect(screen.getByTestId('about-me-save-state')).toHaveTextContent('Saved');
	});

	it('keeps the draft and says why when the save is refused', async () => {
		setResult = () => ({
			success: false,
			code: 'invalid-request',
			error: 'Invalid About Me command or managed marker in content',
			content: 'I prefer short answers.',
			estimatedTokens: 6,
			files: [],
		});
		await renderSection();
		const editor = screen.getByRole('textbox', { name: 'About Me' }) as HTMLTextAreaElement;
		fireEvent.change(editor, { target: { value: 'Has <!-- maestro:about-me:start --> inside' } });
		await settle(1000);

		expect(editor.value).toBe('Has <!-- maestro:about-me:start --> inside');
		expect(useSettingsStore.getState().conductorProfile).toBe('I prefer short answers.');
		expect(screen.getByTestId('about-me-save-state')).toHaveTextContent(
			'Not saved: remove the maestro:about-me marker lines'
		);
	});
});

describe('AboutMeSection native files', () => {
	it('lists each file with its real target and what Maestro can do with it', async () => {
		files = [
			file({ path: '/a/CLAUDE.md', state: 'synced', currentBlock: BLOCK }),
			file({
				path: '/home/.codex/AGENTS.md',
				resolvedPath: '/notes/agents.md',
				providers: ['codex'],
				state: 'unconfirmed',
			}),
			file({
				path: '/gone/CLAUDE.md',
				resolvedPath: undefined,
				currentBlock: undefined,
				state: 'missing-directory',
			}),
			file({
				path: '/broken/CLAUDE.md',
				currentBlock: undefined,
				state: 'invalid-block',
				error: 'The managed markers are incomplete or repeated',
			}),
		];
		await renderSection();

		expect(row('/a/CLAUDE.md')).toHaveTextContent('Claude Code');
		expect(row('/a/CLAUDE.md')).toHaveTextContent('Up to date');
		const link = row('/home/.codex/AGENTS.md');
		expect(link).toHaveTextContent('Codex');
		expect(link).toHaveTextContent('/home/.codex/AGENTS.md');
		expect(link).toHaveTextContent('Real file: /notes/agents.md');
		expect(link).toHaveTextContent('Needs your OK');
		expect(link).toHaveTextContent('Maestro will add one at the end');
		expect(row('/gone/CLAUDE.md')).toHaveTextContent('Folder missing');
		expect(row('/gone/CLAUDE.md')).toHaveTextContent('Maestro does not create account folders.');
		expect(row('/gone/CLAUDE.md')).not.toHaveTextContent('No Maestro agent uses this account');
		expect(row('/broken/CLAUDE.md')).toHaveTextContent('Markers broken');
		expect(writeButton()).toBeDisabled();
	});

	it('names the agents that read each file and marks a DeepSeek account', async () => {
		useSessionStore.setState({
			sessions: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Seek'].map((name) =>
				createMockSession({ id: name.toLowerCase(), name })
			),
		});
		files = [
			file({ path: '/a/CLAUDE.md', agentIds: ['alpha', 'beta'] }),
			file({ path: '/b/CLAUDE.md', agentIds: ['alpha', 'beta', 'gamma', 'delta'] }),
			file({ path: '/c/CLAUDE.md', agentIds: [] }),
			file({ path: '/d/CLAUDE.md', agentIds: ['seek'], deepseek: true }),
		];
		await renderSection();

		expect(row('/a/CLAUDE.md')).toHaveTextContent('Used by Alpha, Beta');
		expect(row('/b/CLAUDE.md')).toHaveTextContent('Used by Alpha, Beta, Gamma and 1 more');
		expect(row('/c/CLAUDE.md')).toHaveTextContent('No Maestro agent uses this account');
		expect(row('/d/CLAUDE.md')).toHaveTextContent('DeepSeek');
		expect(row('/d/CLAUDE.md')).not.toHaveTextContent('Claude Code');
		expect(row('/d/CLAUDE.md')).toHaveTextContent('Used by Seek');
	});

	it('writes an approved file with exactly the snapshot it showed', async () => {
		files = [file({ path: '/a/CLAUDE.md', state: 'unconfirmed', currentBlock: BLOCK })];
		applyResult = (command) => {
			files = [file({ path: '/a/CLAUDE.md', state: 'synced', currentBlock: command.content })];
			return serviceResult({ files, written: ['/a/CLAUDE.md'] });
		};
		await renderSection();

		const target = row('/a/CLAUDE.md');
		fireEvent.click(within(target).getByRole('button', { name: 'Show current section' }));
		expect(within(target).getByTestId('about-me-current-block')).toHaveTextContent(
			'Written by hand'
		);
		fireEvent.click(
			within(target).getByRole('checkbox', { name: 'Replace the existing About Me section' })
		);
		expect(writeButton()).toHaveTextContent('Write to 1 file');
		fireEvent.click(writeButton());
		await settle();

		expect(applyCalls()).toEqual([
			{
				action: 'apply',
				content: 'I prefer short answers.',
				confirmations: [{ path: '/a/CLAUDE.md', resolvedPath: '/a/CLAUDE.md', block: BLOCK }],
			},
		]);
		expect(screen.getByTestId('about-me-outcome')).toHaveTextContent('Wrote 1 file.');
		expect(screen.getByTestId('about-me-outcome')).toHaveTextContent(
			'Restart any claude or codex that is already running'
		);
		expect(row('/a/CLAUDE.md')).toHaveTextContent('Up to date');
	});

	it('drops an approval when the file changes again before writing', async () => {
		files = [file({ path: '/a/CLAUDE.md', state: 'external-change', currentBlock: BLOCK })];
		await renderSection();
		fireEvent.click(
			within(row('/a/CLAUDE.md')).getByRole('checkbox', {
				name: 'Replace the section that was edited outside Maestro',
			})
		);
		expect(writeButton()).toBeEnabled();

		files = [
			file({
				path: '/a/CLAUDE.md',
				state: 'external-change',
				currentBlock: BLOCK.replace('Written by hand', 'Edited again'),
			}),
		];
		fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
		await settle();

		const checkbox = within(row('/a/CLAUDE.md')).getByRole('checkbox', {
			name: 'Replace the section that was edited outside Maestro',
		});
		expect(checkbox).not.toBeChecked();
		expect(writeButton()).toBeDisabled();
		expect(applyCalls()).toEqual([]);
	});

	it('shows a partial write as written and not done, never as all done', async () => {
		files = [
			file({ path: '/a/CLAUDE.md', state: 'pending', currentBlock: BLOCK }),
			file({ path: '/b/CLAUDE.md', state: 'external-change', currentBlock: BLOCK }),
			file({ path: '/c/CLAUDE.md', state: 'invalid-block', currentBlock: undefined }),
		];
		applyResult = () => {
			files = [
				file({ path: '/a/CLAUDE.md', state: 'synced', currentBlock: 'new' }),
				files[1],
				files[2],
			];
			return serviceResult({
				success: false,
				code: 'file-error',
				error: 'Some instruction files were not synchronized',
				files,
				written: ['/a/CLAUDE.md'],
			});
		};
		await renderSection();
		expect(writeButton()).toHaveTextContent('Write to 1 file');
		fireEvent.click(writeButton());
		await settle();

		const outcome = screen.getByTestId('about-me-outcome');
		expect(outcome).toHaveTextContent('Wrote 1 of 3 files.');
		expect(outcome).not.toHaveTextContent('Wrote 1 file.');
		expect(row('/a/CLAUDE.md')).toHaveTextContent('Up to date');
		expect(row('/b/CLAUDE.md')).toHaveTextContent('Edited outside Maestro');
		expect(row('/c/CLAUDE.md')).toHaveTextContent('Markers broken');
	});

	it('explains a file that was written but whose record could not be saved', async () => {
		files = [file({ path: '/a/CLAUDE.md', state: 'pending', currentBlock: BLOCK })];
		applyResult = () => {
			files = [
				file({ path: '/a/CLAUDE.md', state: 'error', currentBlock: 'new', error: 'disk full' }),
			];
			return serviceResult({
				success: false,
				code: 'file-error',
				files,
				written: ['/a/CLAUDE.md'],
			});
		};
		await renderSection();
		fireEvent.click(writeButton());
		await settle();

		expect(row('/a/CLAUDE.md')).toHaveTextContent(
			'Written, but Maestro could not record it: disk full'
		);
		expect(screen.getByTestId('about-me-outcome')).toHaveTextContent('Wrote 1 of 1 files.');
	});

	it('warns that a Codex override takes priority instead of calling the file loaded', async () => {
		files = [
			file({
				path: '/c/AGENTS.md',
				providers: ['codex'],
				state: 'synced',
				currentBlock: BLOCK,
				shadowedBy: ['/c/AGENTS.override.md'],
			}),
		];
		await renderSection();

		const codex = row('/c/AGENTS.md');
		expect(codex).toHaveTextContent('Overridden');
		expect(codex).not.toHaveTextContent('Up to date');
		expect(codex).toHaveTextContent('Codex reads /c/AGENTS.override.md instead');
	});

	it('removes the section after the profile is cleared and asks to restart running CLIs', async () => {
		useSettingsStore.setState({ conductorProfile: '' });
		files = [file({ path: '/a/CLAUDE.md', state: 'pending', currentBlock: BLOCK })];
		applyResult = () => {
			files = [file({ path: '/a/CLAUDE.md', state: 'synced', currentBlock: null })];
			return serviceResult({ files, written: ['/a/CLAUDE.md'] });
		};
		await renderSection();
		expect(writeButton()).toHaveTextContent('Remove from 1 file');
		fireEvent.click(writeButton());
		await settle();

		expect(applyCalls()).toEqual([{ action: 'apply', content: '', confirmations: [] }]);
		expect(screen.getByTestId('about-me-outcome')).toHaveTextContent(
			'Removed the section from 1 file.'
		);
		expect(screen.getByTestId('about-me-outcome')).toHaveTextContent(
			'Restart any claude or codex that is already running'
		);
	});

	it('does not retry when the profile changed while writing', async () => {
		files = [file({ path: '/a/CLAUDE.md', state: 'pending', currentBlock: BLOCK })];
		applyResult = () =>
			serviceResult({
				success: false,
				code: 'profile-changed',
				error: 'The profile changed; inspect it again before applying',
				files,
				written: [],
			});
		await renderSection();
		fireEvent.click(writeButton());
		await settle(5000);

		expect(applyCalls()).toHaveLength(1);
		expect(screen.getByTestId('about-me-outcome')).toHaveTextContent(
			'About Me changed in another window or the CLI while writing'
		);
	});

	it('waits for the newest text to be saved before it can write', async () => {
		files = [file({ path: '/a/CLAUDE.md', state: 'pending', currentBlock: BLOCK })];
		await renderSection();
		fireEvent.change(screen.getByRole('textbox', { name: 'About Me' }), {
			target: { value: 'Newer text' },
		});
		expect(writeButton()).toBeDisabled();
		await settle(1000);
		expect(writeButton()).toBeEnabled();
		fireEvent.click(writeButton());
		await settle();
		expect(applyCalls()).toEqual([{ action: 'apply', content: 'Newer text', confirmations: [] }]);
	});
});
