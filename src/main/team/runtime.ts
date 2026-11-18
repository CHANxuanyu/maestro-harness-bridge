import path from 'path';
import { app } from 'electron';
import { captureTeamOutput } from './output-capture';
import { teamQuotaSample } from './quota';
import { createTeamScheduler } from './scheduler';
import { createTeamStore } from './team-store';
import { createTeamWorkspaces } from './workspaces';
import { createTurnDispatcher, type SeatTurnRequest, type SeatTurnResult } from './turn-dispatcher';
import { createCheckRunner } from '../check-runner';
import { createFollowUpStore } from '../follow-ups';
import type { SpawnHandlerDependencies } from '../ipc/handlers/process/handle-spawn';
import { getSessionStorage } from '../agents';
import { resolveAgentAccountDir } from '../../shared/agentAccountDir';
import { getAgentAccountDirLayers } from '../agents/provider-account-dirs';
import { transcriptMessagesToLogEntries } from '../../shared/transcriptEntries';
import { execGitReadOnly } from '../utils/remote-git';
import { logger } from '../utils/logger';

/** Match a result to its user-turn marker, never to the latest reply in an account. */
export async function reconcileTeamTurn(request: SeatTurnRequest): Promise<SeatTurnResult | null> {
	const storage = getSessionStorage(request.tool);
	if (!storage) return null;
	const configDir = resolveAgentAccountDir(
		{ toolType: request.tool, customEnvVars: request.customEnv },
		getAgentAccountDirLayers(request.tool)
	);
	const candidates = request.nativeSessionId
		? [request.nativeSessionId]
		: (await storage.listSessions(request.cwd, undefined, configDir)).map((s) => s.sessionId);
	for (const nativeSessionId of candidates) {
		const messages = [];
		let offset = 0;
		for (;;) {
			const page = await storage.readSessionMessages(request.cwd, nativeSessionId, {
				configDir,
				readOnly: true,
				offset,
				limit: 500,
			});
			messages.push(...page.messages);
			offset += page.messages.length;
			if (!page.hasMore || !page.messages.length) break;
		}
		const entries = transcriptMessagesToLogEntries(messages);
		const marker = `[team-dispatch:${request.dispatchId}]`;
		const start = entries.findLastIndex(
			(entry) => entry.source === 'user' && entry.text.includes(marker)
		);
		if (start < 0) continue;
		const after = entries.slice(start + 1);
		const nextUser = after.findIndex((entry) => entry.source === 'user');
		const turn = nextUser < 0 ? after : after.slice(0, nextUser);
		const reply = turn
			.filter(
				(entry) => entry.source === 'stdout' && entry.nativeTranscript.channel !== 'commentary'
			)
			.at(-1);
		if (!reply) continue;
		return {
			dispatchId: request.dispatchId!,
			processId: `team-${request.teamId}-${request.seat}-${request.dispatchId}`,
			nativeSessionId,
			text: reply.text,
			truncated: false,
			usage: null,
			exitCode: 0,
			durationMs: 0,
			lastActivityAt: reply.timestamp,
			livenessEvents: 0,
			canceled: false,
		};
	}
	return null;
}

/** Called after native storage registration; independent of window ownership. */
export function createTeamRuntime(
	deps: SpawnHandlerDependencies & { safeSend: (channel: string, ...args: unknown[]) => void }
) {
	const userData = app.getPath('userData');
	const store = createTeamStore(userData);
	const onError = (error: unknown) => logger.error(String(error), 'TeamScheduler');
	const scheduler = createTeamScheduler({
		store,
		dispatcher: createTurnDispatcher(deps),
		checks: createCheckRunner(),
		followUps: createFollowUpStore({ userData, onError }),
		onError,
		workspaces: (config, pushAuthorized) =>
			createTeamWorkspaces({
				root: path.join(userData, 'teams', config.id, 'workspaces'),
				projectRoot: config.projectRoot,
				slug: config.id,
				pushAuthorized,
			}),
		quota: (config, source, model) =>
			teamQuotaSample(
				{ ...(config.seats[source].tool === model.tool ? config.seats[source] : {}), ...model },
				deps.agentConfigsStore.get('configs', {})[model.tool]?.customEnvVars,
				Date.now()
			),
		seatOptions: (config, seat, model) =>
			model && model.tool !== config.seats[seat].tool
				? {}
				: {
						customPath: config.seats[seat].customPath,
						customArgs: config.seats[seat].customArgs,
						customEnv: config.seats[seat].customEnv,
					},
		reconcile: async (request) => {
			// Inspect the workspace as well as native history before deciding to repeat a turn.
			await execGitReadOnly(['status', '--porcelain'], request.cwd);
			return reconcileTeamTurn(request);
		},
		captureOutput: captureTeamOutput,
	});
	const unsubscribe = store.subscribe((teamId, event) =>
		deps.safeSend('team:changed', { teamId, event })
	);
	app.once('will-quit', () => {
		scheduler.dispose();
		unsubscribe();
	});
	return scheduler;
}
