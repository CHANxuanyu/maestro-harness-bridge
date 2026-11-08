import { describe, expect, it } from 'vitest';
import {
	codexAppServerEnabled,
	effectiveStandardPermissionCapability,
} from '../../shared/codexAppServer';
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

it.each([false, true])('shares effective standard capability for prototype=%s', (enabled) => {
	const settings = { newShell: true, codexAppServer: enabled };
	expect(effectiveStandardPermissionCapability(getAgentCapabilities('codex'), settings)).toBe(
		enabled
	);
	expect(effectiveStandardPermissionCapability(getAgentCapabilities('codex'), settings, true)).toBe(
		false
	);
	expect(
		effectiveStandardPermissionCapability(getAgentCapabilities('codex'), {
			...settings,
			newShell: false,
		})
	).toBe(false);
	expect(effectiveStandardPermissionCapability(getAgentCapabilities('claude-code'), settings)).toBe(
		true
	);
});

it.each(['interactive', 'dynamic'] as const)(
	'disables Claude standard for %s only in the new shell',
	(maestroPMode) => {
		const capabilities = getAgentCapabilities('claude-code');
		const source = { enableMaestroP: true, maestroPMode };
		expect(
			effectiveStandardPermissionCapability(capabilities, { newShell: true }, false, source)
		).toBe(false);
		expect(
			effectiveStandardPermissionCapability(capabilities, { newShell: false }, false, source)
		).toBe(true);
		expect(
			effectiveStandardPermissionCapability(capabilities, { newShell: true }, false, {
				enableMaestroP: false,
			})
		).toBe(true);
		expect(
			effectiveStandardPermissionCapability(capabilities, { newShell: true }, true, {
				enableMaestroP: false,
			})
		).toBe(false);
	}
);

it.each(['/opt/maestro-p', 'C:/tools/maestro-p.cmd'])(
	'disables standard for an explicit TUI path %s',
	(customPath) => {
		expect(
			effectiveStandardPermissionCapability(
				getAgentCapabilities('claude-code'),
				{ newShell: true },
				false,
				{ enableMaestroP: false, customPath }
			)
		).toBe(false);
	}
);
