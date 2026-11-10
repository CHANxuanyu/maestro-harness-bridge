import { describe, it, expect, beforeEach } from 'vitest';
import {
	buildDelegationLogEntry,
	recordAgentDelegation,
	resolveDelegationSourceTab,
	settleAgentDelegation,
} from '../../../renderer/services/agentDelegation';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { isSelfContainedCard } from '../../../renderer/utils/logEntries';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import type { AgentDelegationNotice } from '../../../shared/agentDelegation';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';

const proxmox = () =>
	createMockSession({ id: 'proxmox', name: '🖥 Proxmox', toolType: 'claude-code' });

const maestro = () =>
	createMockSession({
		id: 'maestro',
		name: 'Maestro',
		aiTabs: [
			createMockAITab({ id: 'caller-tab', logs: [] }),
			createMockAITab({ id: 'other-tab', logs: [] }),
		],
		activeTabId: 'other-tab',
	});

const notice = (overrides: Partial<AgentDelegationNotice> = {}): AgentDelegationNotice => ({
	kind: 'dispatch',
	fromSessionId: 'maestro',
	fromTabId: 'caller-tab',
	targetSessionId: 'proxmox',
	prompt: 'Fix the advisory recovery bug',
	...overrides,
});

const logsOf = (sessionId: string, tabId: string) =>
	useSessionStore
		.getState()
		.sessions.find((s) => s.id === sessionId)!
		.aiTabs.find((t) => t.id === tabId)!.logs;

describe('resolveDelegationSourceTab', () => {
	it('uses the tab the spawn named', () => {
		expect(resolveDelegationSourceTab(maestro(), 'caller-tab')?.id).toBe('caller-tab');
	});

	it('refuses to guess another tab when the named one has closed', () => {
		expect(resolveDelegationSourceTab(maestro(), 'closed-tab')).toBeUndefined();
	});

	it('falls back to the lone busy tab, then to the active tab', () => {
		const session = maestro();
		expect(resolveDelegationSourceTab(session)?.id).toBe('other-tab');
		session.aiTabs[0] = { ...session.aiTabs[0], state: 'busy' };
		expect(resolveDelegationSourceTab(session)?.id).toBe('caller-tab');
	});
});

describe('buildDelegationLogEntry', () => {
	it('builds a self-contained card with a one-line subject', () => {
		const entry = buildDelegationLogEntry(
			notice({ targetTabId: 'queued-tab', prompt: 'Fix the\n\n advisory   bug', queued: true }),
			proxmox()
		);
		expect(entry.delegation).toEqual({
			kind: 'dispatch',
			toSessionId: 'proxmox',
			toTabId: 'queued-tab',
			toAgentName: '🖥 Proxmox',
			toToolType: 'claude-code',
			subject: 'Fix the advisory bug',
			queued: true,
		});
		expect(entry.text).toBe('Delegated to 🖥 Proxmox: Fix the advisory bug');
		expect(isSelfContainedCard(entry)).toBe(true);
	});

	it('cuts a long prompt down to one line', () => {
		const entry = buildDelegationLogEntry(notice({ prompt: 'x'.repeat(500) }), proxmox());
		expect(entry.delegation!.subject.length).toBeLessThanOrEqual(120);
		expect(entry.delegation!.subject.endsWith('…')).toBe(true);
	});

	it('words an ask as a question', () => {
		const entry = buildDelegationLogEntry(
			notice({ kind: 'ask', prompt: 'Which branch?' }),
			proxmox()
		);
		expect(entry.text).toBe('Asked 🖥 Proxmox: Which branch?');
	});
});

describe('recordAgentDelegation / settleAgentDelegation', () => {
	beforeEach(() => {
		useSettingsStore.setState({ newShell: false });
		useSessionStore.setState({ sessions: [proxmox(), maestro()] } as never);
	});

	it.each([false, true])('requires a saved child receipt only in newShell=%s', (newShell) => {
		useSettingsStore.setState({ newShell });
		const target = { ...proxmox(), aiTabs: [createMockAITab({ id: 'child' })] };
		useSessionStore.setState({ sessions: [maestro(), target] });
		const result = recordAgentDelegation(notice({ newTab: true, targetTabId: 'child' }));
		if (newShell) expect(result).toBeNull();
		else expect(result).toMatchObject({ sessionId: 'maestro', tabId: 'caller-tab' });
		expect(logsOf('maestro', 'caller-tab')).toHaveLength(newShell ? 0 : 1);
		expect(useSessionStore.getState().sessions[1]).toBe(target);
	});

	it('records an acknowledged cross-window child without patching its stale snapshot', () => {
		useSettingsStore.setState({ newShell: true });
		const target = { ...proxmox(), aiTabs: [createMockAITab({ id: 'child' })] };
		useSessionStore.setState({ sessions: [maestro(), target] });
		const accepted = notice({
			newTab: true,
			targetTabId: 'child',
			provenanceSaved: true,
			target: { id: target.id, name: target.name, toolType: target.toolType },
		});
		recordAgentDelegation(accepted);
		expect(useSessionStore.getState().sessions[1]).toBe(target);
		useSessionStore.setState({ sessions: [maestro()] });
		expect(recordAgentDelegation(accepted)).not.toBeNull();
		expect(logsOf('maestro', 'caller-tab')[0].delegation).toMatchObject({
			toTabId: 'child',
			toSessionId: target.id,
			toAgentName: target.name,
		});
	});

	it('keeps existing conversation provenance when dispatch does not create a tab', () => {
		useSettingsStore.setState({ newShell: true });
		const child = createMockAITab({ id: 'child', name: 'Existing' });
		useSessionStore.setState({ sessions: [maestro(), { ...proxmox(), aiTabs: [child] }] });
		recordAgentDelegation(notice({ targetTabId: child.id }));
		expect(useSessionStore.getState().sessions[1].aiTabs[0]).toBe(child);
	});

	it('appends the pill to the delegating tab only', () => {
		const ref = recordAgentDelegation(notice());

		expect(ref).toEqual({ sessionId: 'maestro', tabId: 'caller-tab', entryId: expect.any(String) });
		expect(logsOf('maestro', 'caller-tab')).toHaveLength(1);
		expect(logsOf('maestro', 'caller-tab')[0].delegation?.toAgentName).toBe('🖥 Proxmox');
		expect(logsOf('maestro', 'other-tab')).toHaveLength(0);
	});

	it('records nothing when the target or the caller is gone', () => {
		expect(recordAgentDelegation(notice({ targetSessionId: 'deleted' }))).toBeNull();
		expect(recordAgentDelegation(notice({ fromSessionId: 'deleted' }))).toBeNull();
		expect(logsOf('maestro', 'caller-tab')).toHaveLength(0);
	});

	it('settles a pending ask pill in place', () => {
		const ref = recordAgentDelegation(notice({ kind: 'ask' }), { pending: true })!;
		expect(logsOf('maestro', 'caller-tab')[0].delegation?.status).toBe('pending');

		settleAgentDelegation(ref, { status: 'error', error: 'timed out', toTabId: 'consult-1' });

		expect(logsOf('maestro', 'caller-tab')).toHaveLength(1);
		expect(logsOf('maestro', 'caller-tab')[0].delegation).toMatchObject({
			status: 'error',
			error: 'timed out',
			toTabId: 'consult-1',
		});
	});

	it('settling is a no-op once the entry is gone', () => {
		const ref = recordAgentDelegation(notice({ kind: 'ask' }), { pending: true })!;
		useSessionStore.setState({ sessions: [proxmox(), maestro()] } as never);

		settleAgentDelegation(ref, { status: 'done' });

		expect(logsOf('maestro', 'caller-tab')).toHaveLength(0);
	});
});
