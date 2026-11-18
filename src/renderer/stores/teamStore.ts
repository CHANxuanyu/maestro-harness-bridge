import { useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { reduceLedger } from '../../shared/team/ledger';
import { teamStatus } from '../../shared/team/status';
import type { LedgerEvent, SeatRole, TeamConfig, TeamState } from '../../shared/team/types';
import {
	teamClient,
	type CreateTeamInput,
	type TeamClient,
	type TeamSnapshot,
} from '../services/teamClient';
import { useGroupChatStore } from './groupChatStore';
import { useSessionStore } from './sessionStore';

interface TeamMirror extends TeamSnapshot {
	state: TeamState;
}
type TeamCommand = 'pause' | 'resume' | 'stop' | 'accept' | 'export';
interface TeamStore {
	teams: Record<string, TeamMirror>;
	activeTeamId: string | null;
	activeSeat: SeatRole | null;
	returnSeat: SeatRole | null;
	setupOpen: boolean;
	now: number;
	loading: boolean;
	error: string | null;
	available: boolean;
	pending: Record<string, boolean>;
	setSetupOpen(open: boolean): void;
	selectTeam(id: string | null, seat?: SeatRole): void;
	backToTeam(): void;
	clearReturnSeat(): void;
	mirror(snapshot: TeamSnapshot): void;
	receive(teamId: string, event: LedgerEvent): void;
	refresh(): Promise<void>;
	connect(): () => void;
	create(input: CreateTeamInput): Promise<boolean>;
	answer(teamId: string, cardId: string, optionId: string, note?: string): Promise<boolean>;
	say(teamId: string, text: string, to?: SeatRole): Promise<boolean>;
	command(teamId: string, command: TeamCommand): Promise<boolean>;
	requestChanges(teamId: string, note: string): Promise<boolean>;
	baselineEdit(...args: Parameters<TeamClient['baselineEdit']>): Promise<boolean>;
	assignResidual(...args: Parameters<TeamClient['assignResidual']>): Promise<boolean>;
	baselineReturn(teamId: string, note: string): Promise<boolean>;
}

let subscribers = 0;
let disconnect: (() => void) | undefined;
let generation = 0;
let clock: ReturnType<typeof setInterval> | undefined;
const pendingEvents = new Map<string, LedgerEvent[]>();

export const useTeamStore = create<TeamStore>((set, get) => {
	const perform = async (key: string, action: (client: TeamClient) => Promise<unknown>) => {
		const client = teamClient();
		if (!client || get().pending[key]) return false;
		set((s) => ({ error: null, pending: { ...s.pending, [key]: true } }));
		try {
			await action(client);
			return true;
		} catch (error) {
			set({ error: error instanceof Error ? error.message : String(error) });
			return false;
		} finally {
			set((s) => {
				const pending = { ...s.pending };
				delete pending[key];
				return { pending };
			});
		}
	};
	return {
		teams: {},
		activeTeamId: null,
		activeSeat: null,
		returnSeat: null,
		setupOpen: false,
		now: Date.now(),
		loading: false,
		error: null,
		available: false,
		pending: {},
		setSetupOpen: (setupOpen) => set({ setupOpen }),
		selectTeam: (activeTeamId, seat) => {
			if (activeTeamId) {
				useGroupChatStore.getState().setActiveGroupChatId(null);
				// Keep the selected project owner for creating the next conversation.
				// The shell slot, rather than destroying that conversation, clears its view.
			}
			set({ activeTeamId, activeSeat: seat ?? null, returnSeat: null });
		},
		backToTeam: () => set((s) => ({ returnSeat: s.activeSeat, activeSeat: null })),
		clearReturnSeat: () => set({ returnSeat: null }),
		mirror: ({ config, events }) => {
			const previous = get().teams[config.id];
			const merged = new Map<string, LedgerEvent>();
			for (const event of [
				...events,
				...(previous?.events ?? []),
				...(pendingEvents.get(config.id) ?? []),
			])
				merged.set(event.id, event);
			pendingEvents.delete(config.id);
			const ordered = [...merged.values()].sort((a, b) => a.seq - b.seq);
			if (
				previous &&
				previous.events.length === ordered.length &&
				ordered.every((e, i) => e === previous.events[i]) &&
				previous.config === config
			)
				return;
			const state = reduceLedger(ordered);
			const effectiveConfig = state.config ?? config;
			if (!state.config) state.config = config;
			set((s) => ({
				teams: { ...s.teams, [config.id]: { config: effectiveConfig, events: ordered, state } },
			}));
		},
		receive: (teamId, event) => {
			const existing = get().teams[teamId];
			if (existing) get().mirror({ config: existing.config, events: [event] });
			else if (event.kind === 'team_created')
				get().mirror({ config: event.config, events: [event] });
			else {
				const buffered = pendingEvents.get(teamId);
				pendingEvents.set(teamId, [...(buffered ?? []), event]);
				if (!buffered) {
					const epoch = generation;
					void teamClient()
						?.get(teamId)
						.then((snapshot) => {
							if (epoch === generation && snapshot) get().mirror(snapshot);
						})
						.catch((error: unknown) => {
							if (epoch === generation) {
								set({ error: String(error) });
								pendingEvents.delete(teamId);
							}
						});
				}
			}
		},
		refresh: async () => {
			const client = teamClient();
			set({ available: !!client, error: null });
			if (!client) return;
			const epoch = generation;
			set({ loading: true });
			try {
				const configs = await client.list();
				await Promise.all(
					configs.map(async (config) => {
						const snapshot = await client.get(config.id);
						if (epoch === generation && snapshot) get().mirror(snapshot);
					})
				);
			} catch (error) {
				if (epoch === generation) set({ error: String(error) });
			} finally {
				if (epoch === generation) set({ loading: false });
			}
		},
		connect: () => {
			if (subscribers++ === 0) {
				set({ now: Date.now() });
				clock = setInterval(() => set({ now: Date.now() }), 30000);
				disconnect = teamClient()?.onChanged(({ teamId, event }) => get().receive(teamId, event));
				void get().refresh();
			}
			let closed = false;
			return () => {
				if (closed) return;
				closed = true;
				if (--subscribers === 0) {
					disconnect?.();
					clearInterval(clock);
					clock = undefined;
					disconnect = undefined;
					generation++;
					pendingEvents.clear();
				}
			};
		},
		create: (input) =>
			perform('create', async (client) => {
				const config = await client.create(input);
				// Creation already succeeded. A failed follow-up read must not invite a duplicate create.
				get().mirror({ config, events: [] });
				get().selectTeam(config.id);
				set({ setupOpen: false });
				const snapshot = await client.get(config.id);
				if (snapshot) get().mirror(snapshot);
			}),
		answer: (id, cardId, optionId, note) =>
			perform(`${id}:${cardId}`, (client) => client.answer(id, cardId, optionId, note)),
		say: (id, text, to) => perform(`${id}:say`, (client) => client.say(id, text, to)),
		command: (id, command) => perform(`${id}:command`, (client) => client[command](id)),
		requestChanges: (id, note) =>
			perform(`${id}:command`, (client) => client.requestChanges(id, note)),
		baselineEdit: (...args) =>
			perform(`${args[0]}:baseline`, (client) => client.baselineEdit(...args)),
		assignResidual: (...args) =>
			perform(`${args[0]}:residual:${args[1]}`, (client) => client.assignResidual(...args)),
		baselineReturn: (id, note) =>
			perform(`${id}:baseline`, (client) => client.baselineReturn(id, note)),
	};
});

// Navigation from keyboard, search, history or another sidebar must leave the team slot.
useSessionStore.subscribe((state, previous) => {
	const current = state.sessions.find((s) => s.id === state.activeSessionId);
	const prior = previous.sessions.find((s) => s.id === previous.activeSessionId);
	if (
		state.activeSessionId !== previous.activeSessionId ||
		current?.activeTabId !== prior?.activeTabId ||
		current?.activeFileTabId !== prior?.activeFileTabId ||
		current?.activeBrowserTabId !== prior?.activeBrowserTabId ||
		current?.activeTerminalTabId !== prior?.activeTerminalTabId
	)
		useTeamStore.getState().selectTeam(null);
});
useGroupChatStore.subscribe((state, previous) => {
	if (state.activeGroupChatId && state.activeGroupChatId !== previous.activeGroupChatId)
		useTeamStore.getState().selectTeam(null);
});

export function useTeams(): TeamConfig[] {
	return useTeamStore(useShallow((s) => Object.values(s.teams).map((team) => team.config)));
}
export function useTeamState(teamId: string | null): TeamState | undefined {
	return useTeamStore((s) => (teamId ? s.teams[teamId]?.state : undefined));
}
export function useTeamStatus(teamId: string | null) {
	const state = useTeamState(teamId);
	const now = useTeamStore((s) => s.now);
	return useMemo(() => (state ? teamStatus(state, now) : undefined), [state, now]);
}
