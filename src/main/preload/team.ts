import { ipcRenderer } from 'electron';
import type {
	CreateTeamInput,
	BaselineDiff,
	Brief,
	Criterion,
	TeamTurnLog,
	LedgerEvent,
	SeatRole,
	TeamConfig,
	TeamStatusView,
	TeamSeatTranscript,
} from '../../shared/team/types';

export function createTeamApi() {
	return {
		create: (input: CreateTeamInput): Promise<TeamConfig> =>
			ipcRenderer.invoke('team:create', input),
		list: (): Promise<TeamConfig[]> => ipcRenderer.invoke('team:list'),
		get: (teamId: string): Promise<{ config: TeamConfig; events: LedgerEvent[] } | null> =>
			ipcRenderer.invoke('team:get', teamId),
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
		say: (teamId: string, text: string, to?: SeatRole): Promise<void> =>
			ipcRenderer.invoke('team:say', teamId, text, to),
		pause: (teamId: string): Promise<void> => ipcRenderer.invoke('team:pause', teamId),
		resume: (teamId: string): Promise<void> => ipcRenderer.invoke('team:resume', teamId),
		stop: (teamId: string): Promise<void> => ipcRenderer.invoke('team:stop', teamId),
		accept: (teamId: string): Promise<void> => ipcRenderer.invoke('team:accept', teamId),
		requestChanges: (teamId: string, note: string): Promise<void> =>
			ipcRenderer.invoke('team:requestChanges', teamId, note),
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
