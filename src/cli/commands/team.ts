import { Command } from 'commander';
import { isValidAgentId } from '../../shared/agentIds';
import { reduceLedger } from '../../shared/team/ledger';
import { formatTeamStatus } from '../../shared/team/status';
import {
	DEFAULT_TEAM_AUTHORIZATIONS,
	DEFAULT_TEAM_TURN_BUDGET,
	SEAT_ROLES,
	type CreateTeamInput,
	type LedgerEvent,
	type SeatConfig,
	type SeatModel,
	type SeatRole,
	type TeamConfig,
	type TeamStatusView,
} from '../../shared/team/types';
import { failCommand, sendSimpleCommand } from '../services/session-command';
import { resolveCliPath } from '../utils/parse';

interface TeamOptions {
	json?: boolean;
	team?: string;
	idea?: string;
	pm?: string;
	dev?: string;
	qa?: string;
	subPm?: string;
	subDev?: string;
	subQa?: string;
	deadline?: string;
	turns?: string;
	allow?: string;
	path?: string;
	to?: string;
	note?: string;
	text?: string;
	seat?: string;
}

/** Parse provider-native model/effort names; reject unknown providers and Codex Ultra. */
export function parseTeamSeat(value: string): SeatModel {
	const [tool, model, effort, extra] = value.split(':');
	if (extra !== undefined || !isValidAgentId(tool) || tool === 'terminal')
		throw new Error('Seat must be tool[:model[:effort]] with a supported provider');
	if (tool === 'codex' && effort?.toLowerCase().trim() === 'ultra')
		throw new Error('Codex Ultra is not allowed for team seats');
	return { tool, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

async function invoke<T>(method: string, ...args: unknown[]): Promise<T> {
	const reply = await sendSimpleCommand<{ ok: boolean; result: T; error?: string }>(
		{ type: 'bridge.invoke', channel: `team:${method}`, args },
		'bridge.response'
	);
	if (!reply.ok) throw new Error(reply.error ?? 'Team request failed');
	return reply.result;
}

async function teamId(options: TeamOptions): Promise<string> {
	const teams = await invoke<TeamConfig[]>('list');
	if (options.team) {
		const exact = teams.find((team) => team.id === options.team);
		if (exact) return exact.id;
		const matches = teams.filter((team) => team.id.startsWith(options.team!));
		if (matches.length === 1) return matches[0].id;
		throw new Error(matches.length ? 'Ambiguous team id; use the full id' : 'Team not found');
	}
	if (teams.length === 1) return teams[0].id;
	throw new Error('Choose a team with --team <id>; use team list to inspect teams');
}

export async function teamCommand(
	action: string,
	args: string[],
	options: TeamOptions
): Promise<void> {
	try {
		let result: unknown;
		if (action === 'start') {
			if (!options.idea || !options.pm || !options.dev || !options.qa)
				throw new Error('start requires --idea, --pm, --dev and --qa');
			const seats = Object.fromEntries(
				SEAT_ROLES.map((seat) => {
					const substitute = options[seat === 'pm' ? 'subPm' : seat === 'dev' ? 'subDev' : 'subQa'];
					return [
						seat,
						{
							...parseTeamSeat(options[seat]!),
							...(substitute ? { substitute: parseTeamSeat(substitute) } : {}),
						},
					];
				})
			) as Record<SeatRole, SeatConfig>;
			const allow = options.allow
				?.split(',')
				.map((value) => value.trim())
				.filter(Boolean);
			if (allow?.some((value) => !['checks', 'push', 'pr', 'temp'].includes(value)))
				throw new Error('--allow accepts checks,push,pr,temp');
			const input: CreateTeamInput = {
				idea: options.idea,
				projectRoot: resolveCliPath(options.path ?? process.cwd()),
				seats,
				turnBudget: options.turns === undefined ? DEFAULT_TEAM_TURN_BUDGET : Number(options.turns),
				...(options.deadline ? { deadline: Date.parse(options.deadline) } : {}),
				authorizations:
					allow === undefined
						? { ...DEFAULT_TEAM_AUTHORIZATIONS }
						: {
								checks: allow.includes('checks'),
								push: allow.includes('push'),
								draftPr: allow.includes('pr'),
								temporaryTakeover: allow.includes('temp'),
							},
			};
			result = await invoke('create', input);
		} else if (action === 'list') result = await invoke('list');
		else {
			const id = await teamId(options);
			if (action === 'show') {
				const data = await invoke<{ config: TeamConfig; events: LedgerEvent[] } | null>('get', id);
				if (!data) throw new Error('Team not found');
				const state = reduceLedger(data.events);
				const sections: Record<string, unknown> = {
					brief: state.brief,
					baseline: state.baseline,
					decisions: {
						objections: state.briefResponses,
						decisions: state.decisions,
						answers: state.cardAnswers,
					},
					meetings: state.discussions,
					changes: state.standardChanges,
					suggestions: state.suggestions,
					output: state.outputs,
					residual: state.residual,
					messages: state.messages,
					issues: state.issues,
					evidence: { criteria: state.criteria, checks: state.checks },
					cost: {
						usage: state.usage,
						seats: Object.fromEntries(SEAT_ROLES.map((seat) => [seat, state.seats[seat].usage])),
					},
				};
				if (!Object.prototype.hasOwnProperty.call(sections, args[0]))
					throw new Error(`show expects ${Object.keys(sections).join('|')}`);
				result = sections[args[0]];
			} else if (action === 'baseline') {
				if (args[0] === 'diff') result = await invoke('baselineDiff', id);
				else if (args[0] === 'edit') {
					const text = options.text ?? args.slice(2).join(' ');
					if (!args[1] || !text.trim())
						throw new Error('baseline edit requires a criterion and --text or replacement text');
					result = await invoke('baselineEdit', id, args[1], text);
				} else if (args[0] === 'return') {
					if (!options.note?.trim()) throw new Error('baseline return requires --note');
					result = await invoke('baselineReturn', id, options.note);
				} else if (args[0] === 'confirm') {
					const status = await invoke<TeamStatusView | null>('status', id);
					const card = status?.openCards.find((card) => card.boundary === 'baseline');
					if (!card) throw new Error('No baseline confirmation card');
					await invoke('answer', id, card.id, 'confirm');
				} else throw new Error('baseline expects confirm|edit|diff|return');
			} else if (action === 'answer')
				result = await invoke('answer', id, args[0], args[1], options.note);
			else if (action === 'say') {
				if (options.to && !SEAT_ROLES.includes(options.to as SeatRole))
					throw new Error('--to expects pm, dev or qa');
				result = await invoke('say', id, args.join(' '), options.to);
			} else if (action === 'request-changes')
				result = await invoke('requestChanges', id, options.note);
			else if (action === 'log') result = await invoke('log', id, options.seat);
			else if (action === 'seat-transcript') result = await invoke('seatTranscript', id, args[0]);
			else result = await invoke(action, id);
		}
		if (options.json) console.log(JSON.stringify(result ?? { success: true }));
		else if (action === 'status' && result) console.log(formatTeamStatus(result as TeamStatusView));
		else if (typeof result === 'string') console.log(result);
		else console.log(result === undefined ? 'Done.' : JSON.stringify(result, null, '\t'));
	} catch (error) {
		failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}

export function registerTeamCommands(program: Command): void {
	const team = program.command('team').description('Create and operate a main-process team');
	const command = (signature: string, description: string) =>
		team
			.command(signature)
			.description(description)
			.option('--team <id>', 'Team id or unique prefix')
			.option('--json', 'Machine-readable result');
	command('start', 'Create and start a team')
		.requiredOption('--idea <text>', 'What the team should deliver')
		.requiredOption('--pm <seat>', 'tool:model:effort')
		.requiredOption('--dev <seat>', 'tool:model:effort')
		.requiredOption('--qa <seat>', 'tool:model:effort')
		.option('--sub-pm <seat>', 'PM substitute')
		.option('--sub-dev <seat>', 'Dev substitute')
		.option('--sub-qa <seat>', 'QA substitute')
		.option('--deadline <iso>', 'Absolute deadline, ISO date/time')
		.option('--turns <count>', 'Turn budget', String(DEFAULT_TEAM_TURN_BUDGET))
		.option('--allow <classes>', 'Authorized classes: checks,push,pr,temp; omitted means all')
		.option('--path <path>', 'Project root; defaults to current directory')
		.action((options) => teamCommand('start', [], options));
	for (const action of ['list', 'get', 'status', 'pause', 'resume', 'stop', 'accept', 'export'])
		command(action, `${action} team`).action((options) => teamCommand(action, [], options));
	command('show <section>', 'Read a ledger projection').action((section, options) =>
		teamCommand('show', [section], options)
	);
	command('answer <card> <option>', 'Answer an owner card')
		.option('--note <text>', 'Decision note')
		.action((card, option, options) => teamCommand('answer', [card, option], options));
	command(
		'baseline <action> [criterion] [replacement...]',
		'Confirm, edit, diff or return the baseline'
	)
		.option('--text <text>', 'Replacement criterion text')
		.option('--note <text>', 'Reason for returning the baseline')
		.action((action, criterion, replacement, options) =>
			teamCommand('baseline', [action, ...(criterion ? [criterion] : []), ...replacement], options)
		);
	command('log', 'Read the exact assigned prompts and seat replies')
		.option('--seat <seat>', 'pm, dev or qa')
		.action((options) => teamCommand('log', [], options));
	command('say <text...>', 'Deliver an owner message to PM or a named seat')
		.option('--to <seat>', 'Requested recipient')
		.action((text, options) => teamCommand('say', text, options));
	command('request-changes', 'Return the demonstration for changes')
		.requiredOption('--note <text>', 'Specific requested changes')
		.action((options) => teamCommand('request-changes', [], options));
	command('seat-transcript <seat>', 'Read the seat native-history locator').action(
		(seat, options) => teamCommand('seat-transcript', [seat], options)
	);
}
