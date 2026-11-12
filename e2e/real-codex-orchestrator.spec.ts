import { test } from '@playwright/test';
import { RealAcceptanceApp, acceptanceEnabled } from './fixtures/real-acceptance';
import { realOrchestrator } from './fixtures/real-orchestrator';

// Each case: one Codex parent turn and exactly one dispatched child turn.
// Claude is a separately named, separately opted-in case with a fresh snapshot
// prechecked before even the Codex version probe or Electron can start.
test.setTimeout(420_000);
test.describe.configure({ retries: 0 });

for (const childProvider of ['codex', 'claude'] as const) {
	test.describe(`${childProvider} child`, () => {
		test.skip(
			!acceptanceEnabled('CODEX_ORCHESTRATOR') ||
				(childProvider === 'claude' && process.env.MAESTRO_E2E_CLAUDE_CHILD !== '1'),
			'requires real Codex orchestrator opt-in; Claude child also requires MAESTRO_E2E_CLAUDE_CHILD=1'
		);
		// eslint-disable-next-line no-empty-pattern
		test(`codex: real orchestrator dispatches ${childProvider} and quotes its result`, async ({}, info) => {
			const native = new RealAcceptanceApp(
				info,
				'CODEX_ORCHESTRATOR',
				childProvider === 'claude' ? ['codex', 'claude'] : ['codex']
			);
			let completed = false;
			try {
				await realOrchestrator(native, 'codex', childProvider, false);
				completed = true;
			} finally {
				await native.finish(completed);
			}
		});
	});
}
