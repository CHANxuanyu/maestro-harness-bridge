import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../cli/services/storage', () => ({
	readSettingValue: vi.fn(() => 'dracula'),
	writeSettingValue: vi.fn(),
}));
vi.mock('../../../shared/cli-server-discovery', () => ({ isCliServerRunning: vi.fn(() => true) }));
vi.mock('../../../cli/services/agent-sessions', () => ({
	invokeNativeHistory: vi.fn(async () => true),
}));
import { settingsGet } from '../../../cli/commands/settings-get';
import { readSettingValue } from '../../../cli/services/storage';
import { settingsSet } from '../../../cli/commands/settings-set';
import { writeSettingValue } from '../../../cli/services/storage';
import { isCliServerRunning } from '../../../shared/cli-server-discovery';
import { invokeNativeHistory } from '../../../cli/services/agent-sessions';
beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});
it('applies a live setting through the Settings IPC path and awaits its result', async () => {
	await settingsSet('activeThemeId', 'clay-dark', { json: true });
	expect(invokeNativeHistory).toHaveBeenCalledWith('settings:set', ['activeThemeId', 'clay-dark']);
	expect(writeSettingValue).not.toHaveBeenCalled();
});
it('retains offline file writes when the desktop is closed', async () => {
	vi.mocked(isCliServerRunning).mockReturnValueOnce(false);
	await settingsSet('activeThemeId', 'clay-dark', { json: true });
	expect(writeSettingValue).toHaveBeenCalledWith('activeThemeId', 'clay-dark');
	expect(invokeNativeHistory).not.toHaveBeenCalled();
});

it.each([true, false])(
	'rejects project settings writes online=%s without reaching either storage route',
	async (online) => {
		vi.mocked(isCliServerRunning).mockReturnValue(online);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		for (const key of ['projectSettings', 'projectSettings.any.defaultPermissionMode'])
			await settingsSet(key, '{"defaultPermissionMode":"full"}', { json: true });
		expect(writeSettingValue).not.toHaveBeenCalled();
		expect(invokeNativeHistory).not.toHaveBeenCalled();
		expect(process.exit).toHaveBeenCalledWith(1);
		expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('project settings set');
	}
);

it('redacts project environment values in generic CLI reads', () => {
	vi.mocked(readSettingValue).mockReturnValue({
		'[null,"/tmp/project"]': {
			defaultPermissionMode: 'readonly',
			envVars: { GITHUB_TOKEN: 'synthetic-private-token' },
		},
	} as never);
	settingsGet('projectSettings', { json: true });
	const value = JSON.parse(vi.mocked(console.log).mock.calls[0][0]).value;
	expect(value).toEqual({
		'[null,"/tmp/project"]': { defaultPermissionMode: 'readonly', envVars: {} },
	});
});

it('refuses generic nested project reads and points to the explicit project command', () => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
	vi.mocked(readSettingValue).mockReturnValue('synthetic-private-token');
	settingsGet('projectSettings.any.envVars.GITHUB_TOKEN', { json: true });
	expect(console.log).not.toHaveBeenCalled();
	expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('project settings show');
	expect(process.exit).toHaveBeenCalledWith(1);
});
