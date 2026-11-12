import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { RealAcceptanceApp, acceptanceEnabled } from './fixtures/real-acceptance';
import { createDeepSeekRelay } from './fixtures/native/deepseek-relay.cjs';
import { getAgentDefinition } from '../src/main/agents/definitions';
import { AGENT_CAPABILITIES } from '../src/main/agents/capabilities';

// Text + image + one turn per non-empty harness effort option. No capability edits.
test.skip(
	!acceptanceEnabled('DEEPSEEK') || !process.env.MAESTRO_E2E_DEEPSEEK_KEY,
	'requires real DeepSeek opt-in and MAESTRO_E2E_DEEPSEEK_KEY outside CI/smoke'
);
test.setTimeout(1_200_000);
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('deepseek: record real text, image and effort acceptance without changing capabilities', async ({}, info) => {
	const native = new RealAcceptanceApp(info, 'DEEPSEEK', ['deepseek']);
	let completed = false;
	let relay: Awaited<ReturnType<typeof createDeepSeekRelay>> | undefined;
	try {
		relay = await createDeepSeekRelay();
		await native.start();
		const discovered = await native.page.evaluate(() =>
			window.maestro.agents.getConfigOptions('claude-code', 'effort')
		);
		const effortOption = getAgentDefinition('claude-code')!.configOptions!.find(
			(option) => option.key === 'effort'
		);
		if (effortOption?.type !== 'select') throw new Error('Missing harness effort definition');
		const fallback = effortOption.options ?? [];
		const efforts = (discovered.length ? discovered : fallback).filter(Boolean);
		expect(new Set(efforts).size).toBe(efforts.length);
		expect(efforts.length).toBeLessThanOrEqual(8);
		native.evidence.capabilities = {
			harness: AGENT_CAPABILITIES['claude-code'],
			efforts,
			effortSource: discovered.length ? 'runtime discovery' : 'definition fallback',
			presetUi:
				'DeepSeek currently hides effort in useAgentModelEffortOptions; probe the harness flags through tab effort',
		};
		const owner = await native.create('deepseek', efforts.length + 2, relay.url);
		const cases = [
			{ kind: 'text', effort: '' },
			{ kind: 'image', effort: '' },
			...efforts.map((effort: string) => ({ kind: 'effort', effort })),
		];
		const observations: Array<Record<string, unknown>> = [];
		native.evidence.deepseekCases = observations;
		for (const [index, probe] of cases.entries()) {
			let tab = owner.tab;
			if (index > 0) {
				const created = await native.cli('tab', 'new', '--agent', owner.owner);
				expect(created.success).toBe(true);
				tab = created.tabId;
			}
			const ref = await native.conversation(owner.owner, 'deepseek', tab);
			await native.select(ref);
			expect(
				(await native.cli('tab', 'permission', ref.tab, 'readonly', '--agent', ref.owner)).success
			).toBe(true);
			if (probe.effort)
				expect(
					(await native.cli('tab', 'effort', ref.tab, probe.effort, '--agent', ref.owner)).success
				).toBe(true);
			const before = relay.requests.length;
			if (probe.kind === 'image') {
				const fixture = path.join(native.root, 'test-image.png');
				fs.copyFileSync(path.resolve('src/__tests__/fixtures/maestro-test-image.png'), fixture);
				await native.page.locator('input[type="file"][accept="image/*"]').setInputFiles(fixture);
				await expect(native.page.getByTitle('Remove image 1', { exact: true })).toBeVisible();
			}
			await native
				.input()
				.fill(
					probe.kind === 'image'
						? 'Describe the attached image in five words or fewer. Do not use tools. End with DEEPSEEK_IMAGE_DONE.'
						: 'Reply exactly DEEPSEEK_TEXT_DONE. Do not use tools.'
				);
			await native.input().press('Enter');
			await native.settled(ref, 1, false);
			const requests = relay.requests
				.slice(before)
				.filter((request: { path: string }) => request.path.endsWith('/messages'));
			const calls = native.invocations(ref.owner);
			expect(calls).toHaveLength(index + 1);
			const args = calls[index].args;
			if (probe.effort) expect(args[args.indexOf('--effort') + 1]).toBe(probe.effort);
			const answer = await native.answer(ref);
			const exits = await native.page.evaluate(
				(id) => window.__realCodexProbe.exits.filter((event) => event.id === id),
				ref.process
			);
			const accepted =
				requests.length > 0 &&
				requests.every(
					(request: { status: number }) => request.status >= 200 && request.status < 300
				) &&
				exits[0].code === 0 &&
				answer.includes(probe.kind === 'image' ? 'DEEPSEEK_IMAGE_DONE' : 'DEEPSEEK_TEXT_DONE');
			const requestShape = requests.map((request: { effort: unknown; thinking: unknown }) => ({
				effort: request.effort,
				thinking: request.thinking,
			}));
			observations.push({
				...probe,
				accepted,
				requests,
				exitCode: exits[0].code,
				requestShape,
				effortChangedRequest:
					index > 1
						? JSON.stringify(requestShape) !== JSON.stringify(observations[0].requestShape)
						: null,
				nativeFiles: native.files('claude', ref.home),
				answer,
			});
			if (accepted) await native.transcript(ref);
			if (probe.kind === 'image' && requests.length)
				expect(requests.some((request: { images: number }) => request.images > 0)).toBe(true);
			// A provider rejection is a recorded diagnostic, not a reason to send again.
			// Close any error dialog before the next independent case.
			await native.page.keyboard.press('Escape');
		}
		native.evidence.deepseekWire = relay.requests;
		expect(observations).toHaveLength(efforts.length + 2);
		expect(observations[0].accepted, 'The baseline real text turn must succeed').toBe(true);
		native.checked(
			'All text/image/effort cases attempted once; actual HTTP request shapes and acceptance recorded; capabilities left unchanged'
		);
		completed = true;
	} finally {
		if (relay) native.evidence.deepseekWire = relay.requests;
		try {
			await native.finish(completed);
		} finally {
			if (relay) await relay.close();
		}
	}
});
