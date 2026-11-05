import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../cli/services/storage', () => ({
	readSettingValue: vi.fn(() => 'dracula'),
	writeSettingValue: vi.fn(),
}));
vi.mock('../../../shared/cli-server-discovery', () => ({ isCliServerRunning: vi.fn(() => true) }));
vi.mock('../../../cli/services/agent-sessions', () => ({
	invokeNativeHistory: vi.fn(async () => true),
}));
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
