import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

// These scenarios use NativeApp.cli(), including the real test's local alias.
// It appends --json, which dispatch does not accept. Check both full scenarios
// so a follow-up or a post-restart send cannot reintroduce the same failure.
it.each(['native-codex-plan.spec.ts', 'real-codex-plan.spec.ts'])(
	'%s does not submit prompts through the JSON-only CLI fixture',
	(file) => {
		const source = fs.readFileSync(path.resolve('e2e', file), 'utf8');
		expect(source).not.toMatch(/\bcli\(\s*['"]dispatch['"]/);
	}
);
