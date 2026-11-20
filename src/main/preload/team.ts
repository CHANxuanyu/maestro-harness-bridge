import { ipcRenderer } from 'electron';
import type {
	CreateTeamInput,
	BaselineDiff,
	Brief,
	Criterion,
	TeamTurnLog,
	LedgerEvent,
	SeatRole,
	SeatModel,
	TeamAction,
	TeamConfig,
	TeamStatusView,
	TeamSeatTranscript,
	QueuedTeamMessage,
} from '../../shared/team/types';

export function createTeamApi() {
	return {
		create: (input: CreateTeamInput): Promise<TeamConfig> =>
			ipcRenderer.invoke('team:create', input),
		list: (): Promise<TeamConfig[]> => ipcRenderer.invoke('team:list'),
		get: (
			teamId: string,
			full = false
		): Promise<{ config: TeamConfig; events: LedgerEvent[] } | null> =>
			ipcRenderer.invoke('team:get', teamId, full),
		prompt: (teamId: string, dispatchId: string): Promise<string> =>
			ipcRenderer.invoke('team:prompt', teamId, dispatchId),
		events: (teamId: string): Promise<LedgerEvent[]> => ipcRenderer.invoke('team:events', teamId),
		status: (teamId: string): Promise<TeamStatusView | null> =>
			ipcRenderer.invoke('team:status', teamId),
		answer: (teamId: string, cardId: string, optionId: string, note?: string): Promise<void> =>
			ipcRenderer.invoke('team:answer', teamId, cardId, optionId, note),
		baselineEdit: (
			teamId: string,
			criterionId: string,
			text: string,
			fields?: Partial<Pick<Criterion, 'proof' | 'how'>>
		): Promise<{ brief: Brief; diff: BaselineDiff }> =>
			ipcRenderer.invoke('team:baselineEdit', teamId, criterionId, text, fields),
		baselineDiff: (teamId: string): Promise<BaselineDiff> =>
			ipcRenderer.invoke('team:baselineDiff', teamId),
		baselineReturn: (teamId: string, note: string): Promise<void> =>
			ipcRenderer.invoke('team:baselineReturn', teamId, note),
		log: (teamId: string, seat?: SeatRole): Promise<TeamTurnLog[]> =>
			ipcRenderer.invoke('team:log', teamId, seat),
		say: (teamId: string, text: string, to?: SeatRole): Promise<QueuedTeamMessage> =>
			ipcRenderer.invoke('team:say', teamId, text, to),
		pause: (teamId: string): Promise<void> => ipcRenderer.invoke('team:pause', teamId),
		resume: (teamId: string): Promise<void> => ipcRenderer.invoke('team:resume', teamId),
		stop: (teamId: string): Promise<void> => ipcRenderer.invoke('team:stop', teamId),
		accept: (teamId: string, withGaps?: boolean): Promise<void> =>
			ipcRenderer.invoke('team:accept', teamId, withGaps),
		extend: (teamId: string, extension: { hours?: number; turns?: number }): Promise<void> =>
			ipcRenderer.invoke('team:extend', teamId, extension),
		seatSet: (teamId: string, seat: SeatRole, model: SeatModel): Promise<void> =>
			ipcRenderer.invoke('team:seatSet', teamId, seat, model),
		seatSub: (teamId: string, seat: SeatRole, model?: SeatModel, wait?: boolean): Promise<void> =>
			ipcRenderer.invoke('team:seatSub', teamId, seat, model, wait),
		action: (teamId: string, action: TeamAction, detail: string): Promise<LedgerEvent> =>
			ipcRenderer.invoke('team:action', teamId, action, detail),
		requestChanges: (teamId: string, note: string): Promise<void> =>
			ipcRenderer.invoke('team:requestChanges', teamId, note),
		assignResidual: (teamId: string, itemId: string, owner: string | null): Promise<void> =>
			ipcRenderer.invoke('team:assignResidual', teamId, itemId, owner),
		export: (teamId: string): Promise<string> => ipcRenderer.invoke('team:export', teamId),
		seatTranscript: (teamId: string, seat: SeatRole): Promise<TeamSeatTranscript | null> =>
			ipcRenderer.invoke('team:seatTranscript', teamId, seat),
		onChanged: (
			listener: (payload: { teamId: string; event: LedgerEvent }) => void
		): (() => void) => {
			const callback = (
				_event: Electron.IpcRendererEvent,
				payload: { teamId: string; event: LedgerEvent }
			) => listener(payload);
			ipcRenderer.on('team:changed', callback);
			return () => {
				ipcRenderer.removeListener('team:changed', callback);
			};
		},
	};
}
