import { describe, expect, it } from 'vitest';
import { codexAppServerEnabled } from '../../shared/codexAppServer';
import { getAgentCapabilities } from '../../main/agents/capabilities';

describe('Codex prototype capability gate', () => {
	it.each([false, true])(
		'requires newShell and local execution with prototype=%s',
		(codexAppServer) => {
			const capabilities = getAgentCapabilities('codex');
			expect(codexAppServerEnabled(capabilities, { newShell: false, codexAppServer })).toBe(false);
			expect(codexAppServerEnabled(capabilities, { newShell: true, codexAppServer })).toBe(
				codexAppServer
			);
			expect(codexAppServerEnabled(capabilities, { newShell: true, codexAppServer }, true)).toBe(
				false
			);
			expect(
				codexAppServerEnabled(getAgentCapabilities('claude-code'), {
					newShell: true,
					codexAppServer,
				})
			).toBe(false);
		}
	);
});
