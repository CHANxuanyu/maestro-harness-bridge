# Team chat domain model (implementation contract)

Status: engineering contract for round 2, derived from [PRD](../PRD.md) section 6 and section 3.1. The PRD wins on any conflict. This file fixes names, shapes and module boundaries so the backend (main process, CLI) and the frontend (new shell) can be built in parallel.

## 1. Modules

| Module                                                      | Process  | Owns                                                                                                                                                                                                           |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/progressRules.ts`                               | shared   | Progress judgement and escalation decision (PRD 3.1.3 to 3.1.5). Already written; every loop uses it                                                                                                           |
| `src/shared/team/types.ts`                                  | shared   | Team config, seat, ledger event union, derived state types                                                                                                                                                     |
| `src/shared/team/ledger.ts`                                 | shared   | `reduceLedger(events) -> TeamState`, pure and deterministic                                                                                                                                                    |
| `src/shared/team/report.ts`                                 | shared   | `team-report` block extraction, schema validation per turn kind, permission check by seat role                                                                                                                 |
| `src/shared/team/status.ts`                                 | shared   | `teamStatus(state, now) -> TeamStatusView`, the app-generated status (PRD 6.8.2, `team status`)                                                                                                                |
| `src/shared/team/prompts.ts`                                | shared   | Turn prompt builders: the ledger slice and the schema each seat receives                                                                                                                                       |
| `src/main/team/team-store.ts`                               | main     | Persistence: one folder per team under userData `teams/<teamId>/` with `config.json` and `ledger.jsonl` (append-only, fsync on append, corrupt-line tolerant)                                                  |
| `src/main/team/turn-dispatcher.ts`                          | main     | Runs one provider turn for a seat in its workspace and native session, without a renderer. Built on the group chat spawn path (`spawnGroupChatAgent`, SSH wrapping, customPath, idle watchdog, output parsers) |
| `src/main/team/scheduler.ts`                                | main     | Deterministic next-step logic. Event-driven (turn end, check end, follow-up fired, owner answer) handled within 5 s; a 30 s timer self-check as a fallback                                                     |
| `src/main/team/workspaces.ts`                               | main     | Per-seat git worktrees: dev writes its worktree; QA has its own worktree and may write only `qa/`; PM read-only. Restores QA writes outside `qa/`                                                              |
| `src/main/checks/`                                          | main     | Check runner shared with module B (F3): run a command in a cwd with timeout, capture exit code and output tail, store as evidence                                                                              |
| `src/main/follow-ups/`                                      | main     | Follow-up store shared with module B (F1, F2): persisted, survives restart, fires late with a "late" note                                                                                                      |
| `src/main/ipc/handlers/team.ts`, `src/main/preload/team.ts` | main     | IPC namespace `team:*` and preload `window.maestro.team`                                                                                                                                                       |
| `src/cli/commands/team.ts`                                  | CLI      | `maestro-cli team …` (PRD 6.12), reaching the same main-process functions through the CLI server                                                                                                               |
| `src/renderer/components/Team/`                             | renderer | Setup dialog, team main view, cards, member list in the left bar (frontend, built by Opus)                                                                                                                     |

## 2. Config

```ts
type SeatRole = 'pm' | 'dev' | 'qa';
interface SeatModel {
	tool: AgentId;
	model?: string;
	effort?: string;
} // effort uses the vendor's own level id
interface SeatConfig extends SeatModel {
	substitute?: SeatModel;
}
interface TeamAuthorizations {
	checks: boolean;
	push: boolean;
	draftPr: boolean;
	temporaryTakeover: boolean;
} // defaults all true (PRD 6.3, confirmed)
interface TeamConfig {
	id: string;
	title: string;
	idea: string;
	projectRoot: string;
	createdAt: number;
	seats: Record<SeatRole, SeatConfig>;
	deadline?: number;
	turnBudget: number; // default 40
	authorizations: TeamAuthorizations;
	sshRemoteId?: string;
}
```

Codex seats never get the Ultra effort (PRD 6.3, R4-4): the dispatcher refuses it and the setup UI does not offer it.

## 3. Ledger

The ledger is the team's only durable fact store (PRD 6.2). Append-only JSON lines; every event has `{ id, at, seq, actor, kind, ...payload }` where `actor` is `'app' | 'owner' | SeatRole`. The renderer and CLI never write events directly; they call main-process actions that validate and append.

Event kinds (M1 needs the first group; later groups land with M2 and M3 but the union is defined now):

| Group              | Kinds                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle          | `team_created`, `seat_bound` (native session id, workspace path), `phase_changed`, `paused`, `resumed`, `stopped`, `terminal` (`all` / `gaps` / `stopped`, PRD 3.1.6)                                                                                                                                                                                                                                    |
| Turns              | `turn_dispatched` (seat, kind, dispatch id, prompt digest), `turn_finished` (exit, usage, duration, report or report error), `report_repaired`, `report_rejected` (permission or schema)                                                                                                                                                                                                                 |
| Requirements       | `brief_published` (version, scope, not-doing, criteria with proof type `app`/`qa`/`pm`), `challenge_submitted` (dev objections, QA plans), `brief_response` (PM decisions per objection), `baseline_proposed`, `baseline_confirmed` (owner), `baseline_edited` (owner, criterion, before, after), `baseline_returned` (owner note), `standard_change` (kind add/tighten/relax/modify/remove, approvedBy) |
| Work               | `work_item` (id, title, owner seat, state claimed/done/checked), `check_run` (command, exit, output tail, evidence id), `issue_opened` (QA, violated criterion, repro steps, kind defect/standard), `issue_fixed` (dev claim), `issue_verified` (QA, pass/fail), `attempt` (an `AttemptInput` from progressRules, bound to a problem id)                                                                 |
| Discussion         | `discussion_opened`, `position` (sealed until step 3), `proposal`, `response`, `discussion_closed` (decision, decider, dissent, contested flag, follow-up actions)                                                                                                                                                                                                                                       |
| Review and demo    | `output_captured` (rendered previews, screenshots, files), `review` (verdict, problems with location/criterion/impact/expected, suggestions), `retro`, `demo`, `accepted`, `changes_requested`                                                                                                                                                                                                           |
| Waiting and faults | `follow_up_registered`, `follow_up_fired`, `quota_exhausted`, `substitute_took_over`, `member_fault` (one of the eight states, PRD 6.8.2), `member_recovered`, `decision_card` (boundary, options, recommendation), `card_answered`                                                                                                                                                                      |
| Messages           | `owner_message` (to seat or PM, kind scope/note), `message_delivered`                                                                                                                                                                                                                                                                                                                                    |

`reduceLedger` derives `TeamState`: phase, criteria with evidence status, work items, issues, discussions, decisions, standard changes, waits, open cards, seat health, turn and cost totals, attempts per problem (judged with `judgeAttempts`), and statistics computed from the actual path (PRD 3.1.6).

## 4. Turn reports

Each seat's turn ends with a fenced block whose info string is `team-report` and whose body is JSON. `report.ts` takes the last such block, validates it against the schema for the expected turn kind, and checks the seat may submit it:

| Kind                                 | Who             | Shape (essential fields)                                                                                                               |
| ------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `brief`                              | pm              | `scope`, `notDoing[]`, `criteria[{ id, text, proof: 'app'                                                                              | 'qa'                                                                                                                                                                     | 'pm', how }]`, `checks[{ command, covers[] }]`                                         |
| `challenge`                          | dev, qa         | `objections[{ about, problem, kind: 'unreasonable'                                                                                     | 'unverifiable'                                                                                                                                                           | 'risk' }]`; QA also `plans[{ criterion, how, data }]` (empty plans are rejected, R2-3) |
| `respond`                            | pm              | `decisions[{ about, result: 'accept'                                                                                                   | 'reject'                                                                                                                                                                 | 'discuss', reason }]`, revised `brief`, `askOwner?`                                    |
| `position` / `proposal` / `response` | any participant | discussion steps (M2)                                                                                                                  |
| `work`                               | dev             | `done[]`, `summary`, `claimsComplete`, `waiting?` (a registrable follow-up)                                                            |
| `qa_prep`                            | qa              | `tests[]` written under `qa/`, `samples[]`                                                                                             |
| `verify`                             | qa              | `criteria[{ id, pass, evidence }]`, `issues[{ title, criterion, kind, steps[], expected, actual }]`                                    |
| `fix`                                | dev             | `fixed[]`, `notFixed[{ id, why }]`, `attempt{ basis, difference, expectation }` (required from the second try on, feeds progressRules) |
| `reverify`                           | qa              | `results[{ issue, pass, evidence }]`, `newIssues[]`                                                                                    |
| `review`                             | pm              | `verdict: 'pass'                                                                                                                       | 'reject'`, `problems[{ title, location, criterion, impact, expected }]`, `suggestions[]` (problems without a confirmed criterion are rejected into suggestions, PRD 6.7) |
| `demo`                               | pm              | result first, then evidence, decisions, changes                                                                                        |
| `topic`                              | any             | a member raising an issue (M2)                                                                                                         |

A missing or malformed block is repaired once by asking the seat to resubmit only the block (R3-4); a block that a role may not submit (for example QA closing an issue it did not verify, dev verifying its own fix) is rejected and recorded. Evidence counts are computed by the app from `check_run` and QA verdicts, never taken from a seat's text (R1-7).

## 5. Phases and the M1 direct path

`clarify -> challenge -> (owner baseline) -> implement -> verify -> review -> demo -> accept`. M1 implements the direct path with the simplest rules; M2 adds discussions, review loops and baseline edits; M3 adds limits, faults and terminal reports.

| Phase     | Scheduler action                                                                                                                        | Leaves when                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| clarify   | PM `brief` turn                                                                                                                         | brief v1 in the ledger                            |
| challenge | dev and QA `challenge` turns in parallel, isolated; PM `respond`; app dry-runs the checks (authorization `checks`); owner baseline card | owner confirms the baseline                       |
| implement | dev `work`, QA `qa_prep` in parallel in their own workspaces                                                                            | dev claims complete and app checks pass           |
| verify    | QA `verify`; on issues: dev `fix`, app reruns repro, QA `reverify`                                                                      | functional criteria have evidence, no open issues |
| review    | PM `review` on captured output                                                                                                          | PM passes and every criterion has evidence        |
| demo      | PM `demo`, owner acceptance card                                                                                                        | owner accepts or requests changes                 |

Always one of: a seat working, a registered wait, an owner card. Otherwise the scheduler wakes the PM (R3-1).

## 6. Owner cards and boundaries

Every card the owner must answer carries a `boundary` from `progressRules.Boundary`: `baseline`, `acceptance`, `commitment` (scope change, relax a standard), `permission` (an action not authorized), `model`, `login`, `budget`. Cards never offer a bare "continue".

## 7. IPC and CLI

`team:create`, `team:list`, `team:get` (config + state), `team:status`, `team:answer(cardId, option, note?)`, `team:say(to?, text)`, `team:baseline:*`, `team:pause|resume|stop`, `team:accept|requestChanges`, `team:export`, and a broadcast `team:state` on every append. The CLI verbs in PRD 6.12 map one to one onto these handlers.
