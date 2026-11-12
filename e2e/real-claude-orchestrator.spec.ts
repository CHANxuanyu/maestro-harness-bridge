import { test } from '@playwright/test';
import { RealAcceptanceApp, acceptanceEnabled } from './fixtures/real-acceptance';
import { realOrchestrator } from './fixtures/real-orchestrator';

// One Claude parent turn, one Codex child turn and one child interjection turn.
test.skip(
	!acceptanceEnabled('CLAUDE_ORCHESTRATOR'),
	'requires MAESTRO_E2E_REAL=1 and MAESTRO_E2E_CLAUDE_ORCHESTRATOR=1 outside CI/smoke'
);
test.setTimeout(540_000);
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('claude: real print parent dispatches Codex, the user interjects in its nested child', async ({}, info) => {
	const native = new RealAcceptanceApp(info, 'CLAUDE_ORCHESTRATOR', ['claude', 'codex']);
	let completed = false;
	try {
		await realOrchestrator(native, 'claude', 'codex', true);
		completed = true;
	} finally {
		await native.finish(completed);
	}
});
