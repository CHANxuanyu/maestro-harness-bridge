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
| `src/main/team/team-store.ts`                               | main     | Persistence: one folder per team under userData `teams/<teamId>/` with `config.json`, `ledger.jsonl` and prompt audit sidecars (append-only, fsync on append, corrupt-line tolerant)                           |
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
	customPath?: string;
	customArgs?: string;
	customEnv?: Record<string, string>; // seat-specific account environment
}
type CreateTeamInput = Omit<TeamConfig, 'id' | 'createdAt' | 'title'>;
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
| Turns              | `turn_dispatched` (seat, kind, dispatch id, prompt digest and sidecar reference), `turn_finished` (exit, usage, duration, report or report error), `report_repaired`, `report_rejected` (permission or schema)                                                                                                                                                                                           |
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

Owner product decision, 2026-11-18: be strict about facts and lenient about form.
When the app can determine the correct value, or a field belongs to another seat,
normalize it and keep the rest of the report instead of spending a repair turn.
This does not invent evidence, permission, verification, files, or a decision.

- Only dev supplies `extraTurns` and `preservesDeadline`, including inside
  `standardChanges`. Other seats' values are dropped. Only PM supplies
  `resolvedStandards`; dropping another seat's field never closes an issue.
  Prompt and repair schemas omit fields the receiving seat does not own.
- A proposal's `decider` is app-owned, derived by `discussionDecider()`. An
  omitted or conflicting model hint is replaced and recorded. The model schema
  omits this field; the discussion slice states the lawful decider. An owner-layer
  proposal still waits for the owner card after participant responses.
- QA test paths are workspace-relative `qa/...`. Harmless `./` segments and
  absolute paths physically inside the QA workspace's `qa/` normalize to that
  spelling. A bare filename is accepted only when that file exists in `qa/` and
  no same-named workspace-root entry makes it ambiguous. Traversal, other
  directories, directory targets and symlink escapes are rejected. Normalizing
  a file claim does not make it test evidence. Output locations use
  `teamOutputLocation()`: relative `qa/...` and absolute paths inside QA's `qa/`
  belong to the QA workspace; other targets belong to dev. A QA-proof criterion
  can name files in both workspaces. External references retain their identity;
  capture still checks the real path. A relative CI observation cwd
  resolves against the reporting seat's workspace.
- Every accepted correction produces one app-owned `report_normalized` event
  with the dispatch id and `{ field, before?, after?, reason }` changes. The
  normalized report and notes also live in `turn_finished`, so interrupted
  ingestion replays the same notes once without a new model turn. `team log`
  and the preload API expose the same notes. Notes are neither evidence nor
  progress and do not add a turn.

Validation still rejects reports from the wrong role, invented or duplicate
criterion/issue/message identities, incomplete standard definitions, missing
verification evidence, premature issue closure, invalid discussion ordering,
repeated diagnosis without a new basis and a completion demo without proof.
Unknown position/response references remain unverified basis text. Existing
review normalization (unconfirmed problems become suggestions, verdict follows
confirmed problems) now records its corrections; an empty rejection still
requires a concrete problem rather than guessing the missing fact.

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

Always one of: a seat working, a registered wait, an owner card, or an explicit
member fault awaiting recovery. Otherwise the scheduler wakes the PM (R3-1).
A member fault must not generate repeated PM wake turns.

Execution permissions are per turn through `teamTurnPermission()` in
`src/shared/team/policy.ts`: dev `work` and `fix` write in the dev worktree;
QA `qa_prep` and `reverify` write only `qa/` in the QA worktree. Every other
turn is read-only, including challenge, position, proposal, response, review,
verification, message and report repair. PM is always read-only. Read-only
provider enforcement and conflicting custom-argument checks apply to all seats.

An immediate dispatch error is a `turn-failed` member fault. The scheduler
permits one same-turn recovery retry and then holds the fault in status. This
latch is derived from ledger receipts, including duplicate roots left by older
schedulers; new dispatch IDs and restart cannot reset it. A different turn kind
requires a changed basis, or an owner answer/member recovery can restart the
failed assignment. Failed attempts remain recorded, but fallback polling does
not consume more turns. `model-unavailable` obeys this same bound; model takeover
is reserved for M3.

## 6. Owner cards and boundaries

Every card the owner must answer carries a `boundary` from `progressRules.Boundary`: `baseline`, `acceptance`, `commitment` (scope change, relax a standard), `permission` (an action not authorized), `model`, `login`, `budget`. Cards never offer a bare "continue".

## 7. IPC and CLI

The fixed preload API is documented with JSDoc in `src/renderer/global.d.ts`.
`team:create(CreateTeamInput)` returns a `TeamConfig`, deriving its title from
the idea. `team:get(teamId)` returns `{ config, events } | null`; consumers use
`reduceLedger()` for state. `team:status(teamId)` returns `TeamStatusView | null`.
The other methods are `list()`, `answer(teamId, cardId, optionId, note?)`,
`say(teamId, text, to?)`, `pause(teamId)`, `resume(teamId)`, `stop(teamId)`,
`accept(teamId)`, `requestChanges(teamId, note)`, `export(teamId)` (JSON text),
and `seatTranscript(teamId, seat)` (provider, optional native ID, cwd, or null).
Baseline confirmation calls `answer`; it has no separate IPC action.

`team:changed` broadcasts `{ teamId, event }` after every durable append.
Subscribe with `onChanged` before `get`, buffer notifications during the read,
and deduplicate by event ID/sequence. Its return value unsubscribes that listener.
All handlers work without `event.sender`, including through the authenticated
CLI bridge. The [CLI parity table](../../agent-guides/CLI-UI-PARITY.md) lists the
matching commands. M1 queues owner messages for the PM's next turn.

`turn_finished.message` holds up to 12,000 code units of visible reply with
top-level report fences removed. The validated report is a durable receipt;
stable domain event IDs allow restart during ingestion. `sourceSeq` freezes
each dispatch's prompt input, and `repairOf` preserves the original context.
`workspace_submitted` stores the revision and content fingerprint. QA receipts
are ingested only after `qa_boundary_checked`, with restored paths recorded in
`qa_boundary_restored`. Application work runs outside the per-team event queue.

M1 limitations and verification commands are recorded in
[team runtime verification](team-runtime-verification.md).

## M2 backend contract (2026-11-17)

The renderer consumes the existing append stream plus these main-process actions:
`baselineEdit(id, criterionId, text)`, `baselineDiff(id)`,
`baselineReturn(id, note)`, and `log(id, seat?)`. `say(id, text, to?)` defaults
to PM. A direct seat conversation uses the same call with `to`; messages have
separate delivered, forwarded and handled receipts. New dispatches persist their exact assignment in a prompt sidecar before the
digest/reference event. Legacy inline assignments remain readable; the oldest
dispatches without either representation reconstruct their frozen ledger slice
using the current prompt builder. See the
[CLI parity table](../../agent-guides/CLI-UI-PARITY.md#team-m1-and-m2-main-process-contract-2026-11-17).

Any report may attach `topic` or `standardChanges`. Discussion reports are
`position`, `proposal`, `response`; PM's `retro` records causes, approach, basis,
difference and expected progress evidence. `message` receipts can identify an
owner addition, edit or removal with `change`, `criterionId` and the complete
replacement `criterion` when applicable. Owner wording remains in the ledger.
`topic.kind: 'standard'` routes unjudgeable criteria to PM; standard resolution
is separate from a QA-verified implementation fix. Owner-approved replacement
or removal supersedes old issues, preserving their history.

`Criterion.locations` enumerates every required viewer or output file:
`{ label, target, kind: 'file' | 'preview' | 'screenshot' }`. The app captures
local HTML, SVG and Markdown with the compositor, copies files, and can capture
an already open app web viewer by exact URL. `qa/...` resolves in QA's worktree,
other relative targets in dev's; file receipts name the workspace and resolved
source. QA content changes get a new immutable copy even at the same dev revision.
Missing targets block review as app-owned `output_observation` events, never
standard issues or requests to change the baseline. Status and the app-generated
progress report expose these observations. QA writes require a fresh capture.
For a missing capture, a new QA verification, changed standard, resume or budget
extension permits another attempt; otherwise the app
rechecks after 10 minutes without spending a model turn. A successful newer capture
clears the active observation while preserving its history. Capture receipts carry
`beforeOutputId` and per-location errors; the initial revision is captured before
implementation. Native apps outside Electron require a
separate capture integration and are not silently treated as reviewed.

`CheckCommand.boundary` and discussion experiments may declare
`outside-workspace` or `external-write`. These use one-invocation owner cards,
without expanding the team's workspace-check authorization. Explicit shell
paths and common external-write verbs are also detected. Arbitrary script
internals are not sandboxed by this metadata and command inspection.

`TeamState.reviewProgress` and `reviewDecision` come from the shared progress
rules. Every PM problem opens a criterion-linked issue and work item. Dropping
a comment cannot close it. Two consecutive rejections cause a PM-led retro;
progress after a retro continues fixing. `demos` contains app-generated criterion
coverage, all changes and contested decisions. A second demo covers the new
owner request only, while the completion gate still checks every criterion.

The actual validation and limitations are recorded in
[team-m2-verification.md](team-m2-verification.md).

### M2 renderer contract

Owner cards keep human `body` text separate from typed `payload` data: baseline, discussion (including standard-change comparisons), check-permission, acceptance and progress-report. JSON payloads are never displayed as prose. `team.baselineEdit(teamId, criterionId, text, { proof?, how? })` extends the existing edit handler without changing the three-argument call; CLI equivalents are `team baseline edit <criterion> --text <text> --proof app|qa|pm --how <text>`. Only ledger events update the renderer mirror.

## M3 backend contract, 2026-11-18

Effective configuration is the original config plus owner-authored
`budget_extended` and `seat_configured` events from `reduceLedger()`. The config
file is not rewritten behind ledger replay. `seat_bound.configSource` selects the
existing team launch configuration for a substitute. Each `turn_dispatched`
freezes its binding; a takeover or broken-session recovery starts a fresh native
conversation in the same seat workspace. Original availability is tracked apart
from the currently bound substitute and switch-back occurs after reset or a newer
healthy quota sample. PM messages remain queued while its model is suspended.

`quota_exhausted` stores model/source, reset and login classification.
`model_recovered` clears that specific observation. Every dispatched turn,
including a quota/login refusal, reserves one slot in `usage.turns` exactly once.
`usage.budgetTurns` remains a compatibility alias of that total. Quota/login
refusals do not enter the product no-progress streak. Ordinary immediate failures wait 30
seconds before the one same-turn retry. Repeated failures never become topic
retries. After a failed report repair, PM can organize existing replies in a
read-only `recovery` turn; reconstructed reports still pass the original schema
and attribution checks. Unsupported facts enter diagnosis instead of passing a
criterion. Exhausted recovery registers app-only native-result inspection, which
cannot consume another model turn while its conditions remain unchanged.

Normal follow-ups wake the seat after 20 minutes with observed status. Unchanged
reports use 10-minute rechecks and do not create failed attempts. A report can name
an observable command/CI condition; unobservable claims fall back to an explicitly
labelled timer. `wrap_up` is informational at 80% of time or turns and appears on
`teamStatus().wrapUp`. At the overall boundary the app creates the incomplete
progress report without a model call. `all`, `gaps`, `stopped` retain actual-path
statistics. Accepting gaps emits `residual_item` with `owner: null` and preserves
failed/unproven criteria.

`requestedActions` on a member report or `team.action()` records publication
intent. Class grants are remembered by `permission:<action>`; push includes local
commit on the task branch, and draft PR also requires push authority. Started,
succeeded and failed receipts record partial external effects. Restart inspects
Git and checks for an existing draft before creating one. Merge, publish and
external messages are owner actions only. New model selection creates a model
boundary card unless already authorized by the team configuration.

Added preload methods: `extend`, `seatSet`, `seatSub`, `action`, and the optional
`accept(id, withGaps)` argument. All PRD 6.12 CLI verbs use those same handlers;
`team show cost` returns per-seat usage, total wall time and actual-path statistics.
`team.say()` returns a durable `{ status: 'queued', messageId, to }` receipt;
delivery and handling remain separate ledger events. Omitted CLI recipients are
explicitly PM, including across JSON transport.
The M3 renderer integration is described below. See
[verification](team-m3-verification.md) for tested artifacts and open acceptance.

## M3 renderer contract

Seat rows and Members share `TeamSeatHealth` over `TeamState.seats` and
`teamStatus()`. A repair or wait never borrows the working spinner. Coverage
keeps the seat role and reads catalog names from the launch source account.
`TeamEscalation` renders typed permission, escalation and progress-report
payloads; `body` remains human prose for CLI readers. Reports retain their
captured outputs and attempt records. The normal demo evidence gate is unchanged.
`TeamProgress` supplies the app status, registered wait timing, attempt verdicts,
wrap-up plan, cost bill and residual ownership. Cost values are the same usage
projection as `team show cost`; member duration and team wall time are separate.
`workspace_inspected.reason` identifies restart notes without guessing from a
seat's prose. Residual reassignment appends `residual_item` through the shared
service/IPC/CLI and replaces only that item's owner in the reducer. All three
terminal summaries and paused message queuing remain ledger-derived.

## Real-model follow-up decisions, 2026-11-18

The hard limit uses actual dispatches, including pending reservations. Recovery,
report repair, takeover and the 80% wrap-up all use the same dispatch guard.
An initial invocation uses its already reserved slot; restart at an exhausted
budget may inspect the workspace and reconcile a completed native receipt, but
cannot invoke a process again. The app generates the unfinished report without
a turn. A paused reservation can resume after the owner extends the budget and
resumes the team. Solved progress still precedes the budget in `decideNext()`.

The owner decided that challenge is bounded per owner-authored brief cycle:
dev and QA first challenge the full brief once. A PM revision permits at most
one additional round, only for changed criteria, with the before/after diff.
QA must plan for those criteria still present, or mark them unverifiable; a
removal-only revision may have an empty plan. Further disagreements enter a
short discussion or remain visible with the PM answers and boundary question
on the baseline confirmation card. There is never a third challenge round in
that cycle. An owner edit or return starts a fresh full round; on return PM
first supplies the new draft. `teamChallengeRound()` derives the cycle from
durable owner changes, challenge receipts and brief versions, so restart cannot
reset the cap. This decision refines PRD 6.4 without changing the discussion
rules in 6.5.

Positions need a claim, prose basis and what would change the author's mind;
recorded evidence is optional. `teamEvidenceCatalog()` supplies the exact ids
and observation descriptions to position and response prompts. Unknown
references survive in `position.unverifiedBasis` or `response.unverifiedBasis`,
separate from evidence. The original report receipt also remains intact.
Step-3 insistence needs a new recorded id or a confirmed baseline violation.
Without either, the app records `result: reserve`, `requestedResult: insist`
and an `evidenceConclusion`, then lets the lawful decider conclude the reversible
question as contested. It does not classify this disagreement as a member fault
or invent another evidence-bearing round. Repair prompts quote the exact ids
from the original dispatch snapshot.

The respond prompt distinguishes draft edits in `brief` from confirmed
`standardChanges`, and supplies the complete replacement criterion shape and
a validated example. These shared rules apply equally through CLI and UI.

## Prompt storage and context size, 2026-11-18

A prompt is audit material, not a team fact. New `turn_dispatched` rows contain
`promptDigest` and `promptRef: prompts/<dispatchId>.txt`, not inline `prompt`.
The store serializes prompt writes with team writes, atomically writes and fsyncs
the text before appending the dispatch, and refuses a different assignment for
an existing dispatch id. Failed sidecar writes do not reserve or spend a turn.
Unused sidecars left by an interrupted append are harmless. Existing ledgers are
not rewritten; inline prompts remain readable. Digest failures or missing new
sidecars fail explicit audit reads loudly rather than inventing an assignment.

Receipt reconciliation uses the dispatch id, bound account/workspace and native
marker without reading a prompt. A receipt can therefore complete an interrupted
turn even if its audit sidecar is unavailable. A real redispatch needs the saved
assignment and still goes through the shared budget guard. Runtime inspection
and restart additions keep their existing workspace/recovery events and native
transcript; the sidecar preserves the original assigned text.

`get(id)` / `team get` returns config plus all ordered fact events, excluding
inline prompts and repair tails and capping reply, assignment-note and check
output previews through `compactToolOutput()`. Criteria, evidence ids, reports,
permissions and decisions are not abbreviated. This bounds heavy fields, not the
number of facts in an arbitrarily long team. `get(id, true)` / `team get --full`
hydrates exact prompts and returns full stored tails. `prompt(id, dispatchId)` /
`team show prompt <dispatchId>` reads one assignment. The JSON result of `show prompt` is a string; plain mode prints that text.
`events(id)` / `team show events` is an explicit complete append-log audit,
including raw repair text and legacy inline prompts without loading sidecars.
`get()` remains compact and preserves report errors, rejection reasons,
normalization notes and fault details. The existing explicit
`log()` / `team log` audit view retains exact prompts and replies. `team export`
includes unabridged config/events and a `prompts` object keyed by dispatch id.
All CLI verbs support `--json` and call the same main handlers as preload.
The runtime already sent append deltas, not `team:state` snapshots; those deltas
now use the same lightweight projection. No append broadcasts a full ledger.

Prompt builders emit compact JSON and only the current turn/seat schema. The
original idea is used for brief creation; later turns use the current brief or
confirmed baseline. A targeted fix, reverify or criterion discussion gets the
complete affected criteria and a text/proof index of other commitments. Work,
QA preparation, verification and review retain their necessary proof methods
and locations. Second-round challenge diffs repeat only changed fields, and PM
respond receives current-round challenges plus the last response. QA plans keep
the latest plan per current criterion, including unchanged criteria. Passing
checks retain command, exit, coverage and evidence ids without verbose success
output; failure diagnostics remain. Discussions retain the three latest proposals and their responses; progress
contexts retain the three latest attempts, while the app's policy and
repeat detection still use the full ledger. Demo retains all standard changes
and contested decisions. Wait turns get external wait state and scope, without
unrelated output manifests. Pending owner messages appear in their delivery
turn, not unrelated assignments.

Citable evidence is never silently capped away: every recorded id remains, with
a single-line description of at most 240 characters. A captured file describes
itself, rather than repeating the whole capture manifest for every id. Response
turns also receive the exact new-evidence ids and confirmed baseline ids;
validation and repair still enforce the recorded facts. Size measurements and
native verification limits are in [M3 verification](team-m3-verification.md).

## Sixth follow-up: held work, wait ownership and stalls, 2026-11-18

A suspension belongs to a model/account, not to the seat's latest turn. Pending
positions, proposals and responses are derived from the open discussion, and
failed assignments survive later wait/message receipts. A resumed assignment
records `resumedFrom`, retains its discussion, round, problem and message context,
and inspects the workspace before executing. The authorized substitute or
existing-team temporary model uses a new conversation. Reset or login recovery
returns to the original model; an older cached exhausted sample cannot undo that
recovery. All calls still use the shared cooldown, concurrency and hard budget
guards. Successful or superseded assignments are not revived.

`teamWaitRejection()` owns the external-wait boundary for work reports,
discussion conclusions and legacy registered waits. A discussion step, member
turn or app check is app work, even when a report attaches a timer. Work reports
can identify member dependencies through `needs`; discussion actions can now
supply the same command/CI/time `condition` as work reports. The app refuses or
cancels internal waits with durable `wait_canceled` and `app_observation` receipts,
then evaluates its ordinary next step. It does not charge a repair turn for this
form error. Legacy prose that clearly names CI, a command, build, quota reset or
time boundary retains a bounded status check; unidentified prose is refused.
Application job receipts and exhausted-recovery inspections stay app-managed,
not member-declared external waits. Canceled waits cannot be resurrected by a
late fire receipt or restart.

The watchdog observes ten minutes without a substantive ledger fact, excluding
poll registrations, wait reports and dispatch bookkeeping. It runs on the
existing event/30-second scheduler paths. Paused or terminal teams, open owner
cards, active member/app work and genuine external waits are excluded. A quota
monitor for an inactive original model does not exempt a healthy takeover from
stall detection. One durable app observation per stuck fact precedes another
normal scheduler evaluation; if no step becomes runnable, one PM diagnosis names
the phase/discussion and missing step. Observations appear in app/CLI status and
budget progress reports, never as criterion evidence or a new standard issue.
A PM wait report that only repeats waiting is idle: one nudge, then diagnosis.
Dev/QA unchanged polls of a genuine external operation remain normal waits and
do not enter the product-failure streak. This distinguishes member idleness
(6.8.2) from unchanged external results (T11).

Topics use the position/response evidence rule: recorded ids remain evidence;
unknown references remain `discussion_opened.unverifiedBasis`. Topic prompts and
all turns that allow an attached topic list the citable catalog. Reopening a
concluded question and step-three insistence still require new recorded evidence
(or the existing confirmed-baseline violation rule for insistence). QA verify and
reverify reports describe newly observed results, so their evidence text remains
a new attributed observation rather than an id lookup. Demo claims still cannot
establish proof; the app derives demo eligibility from recorded facts.

## Efficiency from the fifth real run, 2026-11-20

A real medium run spent 23 turns after the baseline without delivering. Four app causes, each fixed with a regression built from that run:

- **The confirmed baseline governs.** On `baseline_confirmed`, every earlier decision is marked `supersededByBaseline` with that version. Prompts list such decisions as historical, with no actions, and the rules line says the owner-confirmed baseline governs. A standard issue that only asks whether such a decision or the baseline governs is resolved by the app (`standard_issue_resolved` with `baselineVersion`) without a discussion; a question backed by evidence recorded after confirmation still goes to PM. The Decisions tab marks superseded decisions.
- **An experiment does not force a round.** When every current-round response agrees, a completed experiment is recorded as evidence in the decision and the discussion closes. Another round is dispatched only when a response disagrees or the result contradicts the experiment's optional `expectExit`.
- **Decided steps carry their phase.** Conclusion actions still give each participant a next step (PRD 6.5 step 4). After confirmation, dev steps run as work or fix and QA steps as qa_prep; PM steps and steps from a standard issue (R1-10) stay message turns. The note names the steps and the decision they come from and says the turn carries no message ids; the pre-baseline "preparation only" note appears only before confirmation.
- **A check can expect a nonzero exit.** Brief checks accept `expectExit` (integer, default 0; `expectedExit` is normalized). The runner records `expectedExitCode`, and every pass judgement (criterion status, batch pass, failure fingerprints, feed) compares against it. The baseline card and feed show the expected code when it is not 0. Single-conversation checks are unchanged unless a definition carries the field.
