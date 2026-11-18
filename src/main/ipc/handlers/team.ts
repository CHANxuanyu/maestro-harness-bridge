import { ipcMain } from 'electron';
import { withIpcErrorLogging } from '../../utils/ipcHandler';
import type { TeamScheduler } from '../../team/scheduler';
import type {
	CreateTeamInput,
	SeatRole,
	Criterion,
	SeatModel,
	TeamAction,
} from '../../../shared/team/types';

/** The bridge passes no Electron sender; every handler only uses its arguments. */
export function registerTeamHandlers(team: TeamScheduler): void {
	const handle = <Args extends unknown[], Result>(
		name: string,
		callback: (...args: Args) => Promise<Result>
	) =>
		ipcMain.handle(
			`team:${name}`,
			withIpcErrorLogging({ context: 'Team', operation: name }, callback)
		);
	handle('create', (input: CreateTeamInput) => team.create(input));
	handle('list', () => team.list());
	handle('get', (id: string, full?: boolean) => team.get(id, full === true));
	handle('prompt', (id: string, dispatchId: string) => team.prompt(id, dispatchId));
	handle('events', (id: string) => team.events(id));
	handle('status', (id: string) => team.status(id));
	handle('answer', (id: string, card: string, option: string, note?: string) =>
		team.answer(id, card, option, note)
	);
	handle(
		'baselineEdit',
		(
			id: string,
			criterion: string,
			text: string,
			fields?: Partial<Pick<Criterion, 'proof' | 'how'>>
		) => team.baselineEdit(id, criterion, text, fields)
	);
	handle('baselineDiff', (id: string) => team.baselineDiff(id));
	handle('baselineReturn', (id: string, note: string) => team.baselineReturn(id, note));
	handle('log', (id: string, seat?: SeatRole) => team.log(id, seat));
	handle('say', (id: string, text: string, to?: SeatRole | null) => team.say(id, text, to ?? 'pm'));
	handle('pause', (id: string) => team.pause(id));
	handle('resume', (id: string) => team.resume(id));
	handle('stop', (id: string) => team.stop(id));
	handle('accept', (id: string, withGaps?: boolean) => team.accept(id, withGaps));
	handle('extend', (id: string, extension: { hours?: number; turns?: number }) =>
		team.extend(id, extension)
	);
	handle('seatSet', (id: string, seat: SeatRole, model: SeatModel) =>
		team.seatSet(id, seat, model)
	);
	handle('seatSub', (id: string, seat: SeatRole, model?: SeatModel, wait?: boolean) =>
		team.seatSub(id, seat, model, wait)
	);
	handle('action', (id: string, action: TeamAction, detail: string) =>
		team.action(id, action, detail)
	);
	handle('requestChanges', (id: string, note: string) => team.requestChanges(id, note));
	handle('assignResidual', (id: string, item: string, owner: string | null) =>
		team.assignResidual(id, item, owner)
	);
	handle('export', (id: string) => team.export(id));
	handle('seatTranscript', (id: string, seat: SeatRole) => team.seatTranscript(id, seat));
}
