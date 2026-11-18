# M3 backend verification, 2026-11-18

Latest artifact: `ee282fec1` plus the uncommitted third real-model follow-up changes.
Earlier M3 records below used `d50dba3f49c8b5c7a975a8a545dd442f603341ff` plus
the then-uncommitted M3 work. Verification targets source and development builds, not an
installed release. No commit, tag, release, paid model invocation or real GitHub
publication was performed. Existing private survey material is not part of this
change.

## Third follow-up: normalize form, preserve facts

The owner's real-model run confirmed the previous fixes: exactly 20 dispatches,
at most two challenge rounds, baseline confirmation at turn 7, then development,
QA preparation, verification and an issue. The owner stopped at the progress
report; that run did not reach acceptance. Four rejected reports and their repairs
consumed eight turns. The four original report objects now form a regression
fixture, with only the discussion id and a temporary baseline-directory spelling
replaced. No full ledger, private transcript or account path is included.

1. **Seat-owned fields:** PM and QA positions both included `extraTurns: 0` and
   `preservesDeadline: true`. The shared prompt schema advertised these fields
   to every seat; the semantic validator then rejected the entire non-dev
   position. Validation now drops both fields, including nested standard-change
   estimates, and retains the claim, basis and evidence references. Non-PM
   `resolvedStandards` is similarly dropped without closing anything. Prompt and
   repair schemas omit fields owned by another seat. Dev estimates and PM
   standard-resolution facts retain their existing validation.
2. **Proposal decider:** the PM supplied `decider: "pm"` on a commitment-layer
   topic. The validator compared this hint with a value the app already knew
   and rejected the proposal. The app now supplies `discussionDecider()` for an
   omitted or conflicting hint and records the correction. Prompts expose the
   lawful decider in context but omit it from the report schema. A scheduler
   regression completes all participant responses and checks that an owner
   commitment card appears, with no automatic conclusion or standard change.
3. **QA paths:** the captured report used the bare `clamp.boundary.test.cjs`,
   not an absolute or `./qa/` spelling. The old string-prefix validator rejected
   all three forms. The shared policy normalizes dot segments and owned absolute
   paths. Main checks the actual QA worktree, including real paths and symlink
   ancestors. A bare name is inferred only when an existing `qa/` file is
   unambiguous; unknown or root-conflicting names are rejected. Tests cover real
   Git workspaces, absolute aliases, Windows spellings, traversal, other
   directories, escaping symlinks, missing descendants and dangling symlinks.
   Output-location spelling uses the capture workspace; CI cwd spelling uses
   the reporting seat. References outside those workspaces are not relocated or
   promoted to evidence, and output capture still enforces its physical boundary.
4. **Validator audit and recording:** known unowned fields, app-derived decider
   and safe path spelling are normalized. Existing review demotion of problems
   without confirmed criteria, and its derived verdict, now also records notes.
   Report-role permissions, required factual shape, unknown fields, confirmed
   criterion identities, actual message ids, complete standard replacements,
   discussion membership/order, participant actions, QA plan coverage,
   verification evidence, issue lifecycle, new-basis diagnosis and demo proof
   remain strict. Unknown discussion references remain unverified basis text,
   never recorded evidence; unsupported insistence remains a reservation.
   No guard invents a missing fact or grants authority. Empty review rejection
   still requires a concrete problem. The full policy is in `team-model.md`.

Each of the four actual reports is tested at both shared-validation and scheduler
levels. The scheduler accepts it without a repair, records one app-owned
`report_normalized` event, exposes the changes through `team log`, and replays
the same note once after a simulated interruption immediately after the durable
turn receipt. Notes do not add evidence, progress or turns. Fact-guard regressions
reject QA closure without a developer fix, dev verification of its own fix and
escaping QA paths; existing evidence tests check recorded ids separately from
unverified text. No native scenario assertion was loosened or changed.

Commands for this artifact:

```sh
npm test -- --configLoader runner src/__tests__/shared/team src/__tests__/main/team src/__tests__/cli/commands/team.test.ts src/__tests__/cli/services/session-command.test.ts src/__tests__/shared/progressRules.test.ts src/__tests__/shared/retryClassification.test.ts src/__tests__/main/follow-ups.test.ts src/__tests__/main/check-runner.test.ts
npm run lint
node node_modules/typescript/bin/tsc -p e2e/tsconfig.team.json --pretty false
node node_modules/eslint/bin/eslint.js src/main/team/{scheduler,workspaces}.ts src/shared/team/{policy,types,ledger,report,prompts,schemas}.ts
node node_modules/eslint/bin/eslint.js -c eslint.dashes.config.mjs src/__tests__/main/team/{scheduler,workspaces}.test.ts src/__tests__/shared/team/{report,prompts}.test.ts
git diff --name-only -z --diff-filter=ACM | xargs -0 node node_modules/prettier/bin/prettier.cjs --check
node node_modules/prettier/bin/prettier.cjs --check src/__tests__/shared/team/real-normalization-fixtures.json
npm run docs:verify
npm run lint:doc-refs
git diff --check
```

All listed commands exited 0. The team run passes **456 tests in 19 files**.
The three production TypeScript projects and all three Electron scenario files
type-check. ESLint has no errors or warnings. Prettier passes the 19 changed
tracked files and the new JSON fixture. Documentation verification checks 724
asserted paths with none missing, and references across 39 docs resolve.
`git diff --check` passes; an added-line and new-fixture scan finds zero forbidden
dash characters. The first focused run had one new test expecting `open` rather
than the actual `opened` state; that assertion was corrected before the final
456-test run. Existing assertions were not weakened.

Native/build attempts, with earlier artifacts preserved in their original paths:

```sh
node scripts/native-e2e.mjs e2e/native-team.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m3.spec.ts --output e2e-results/m3-normalization --max-failures=1
npm run build:main
npm run build:cli
npm run build:renderer -- --configLoader runner
npm run build:web-desktop -- --configLoader runner
node --input-type=module -e 'globalThis.__dirname = process.cwd(); const { build } = await import("vite"); await build({ configLoader: "runner" }); await build({ configFile: "vite.config.web-desktop.mts", configLoader: "runner" });'
node node_modules/@playwright/test/cli.js test --project=native e2e/native-team.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m3.spec.ts --output e2e-results/m3-normalization --max-failures=1 --reporter=line
```

The wrapper exited 1 during renderer config loading: the default Vite loader
tried to write `.vite-temp` through the shared `node_modules` symlink outside the
sandbox. Main/preload and CLI builds exited 0. The two plain runner-loader commands
exited 1 because the existing configs use `__dirname`; the programmatic runner
command supplies the same project directory as the bundled loader and builds
both renderer and web-desktop successfully (exit 0, existing chunk-size and
mixed dynamic/static import warnings). No build configuration was changed.

The direct Playwright command then exited 1: **Electron failed to launch** for
the first M2 scenario, before scenario assertions; 24 scenarios did not run.
Its error context is in `e2e-results/m3-normalization/`. This is not a native
regression result or a claim that the current artifact passed 25/25. Real-model
acceptance was not rerun. Outside the restricted host, verify with:

```sh
node scripts/native-e2e.mjs e2e/native-team.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m3.spec.ts
node scripts/native-e2e.mjs e2e/real-team.spec.ts --grep 'team small task'
```

The real command requires the documented opt-in account setup and is listed for
owner-run verification only; this change made no paid model call.

## Second follow-up after the real-model run

The owner's synthetic native run passed 25/25 before this change. The subsequent
real-model ledger was read in place: 151 events, 21 dispatches, 20 charged turns,
nine rejected reports, six challenges, four briefs and zero checks. The quota
suspension and fresh-conversation takeover worked. Raw capture and account paths
were not copied into the repository. This section supersedes the original quota
budget exemption; it does not change solved-before-budget progress, 10-minute
wait rechecks or the existing 60-second M2 scripted-test timeouts.

1. **Hard budget:** recovery did not omit the ordinary scheduling check; that
   check used the wrong counter. One quota refusal reduced `budgetTurns`, so the
   app admitted dispatch 21 at 20 actual turns. All decisions, prompts and status
   now use `usage.turns`; `budgetTurns` is a compatibility alias. Each dispatch
   reserves one slot and duplicate finishes cannot charge it again. All invocation
   paths share `dispatchAllowed()`, including repairs, takeover, recovery and
   wrap-up. At exhaustion restart may inspect and reconcile a receipt but cannot
   start another process. Regressions cover the 20-turn sequence with pending
   recovery, absent/present wrap-up, quota in the final slot, parallel final slots,
   restart and pause/extension. The unfinished report is app-generated for free.
2. **Discussion basis and evidence:** validation treated any prose in `evidence`
   as a malformed position, and the prompts omitted the allowed ids. Every seat
   repeated the same error during repair. Positions without evidence are valid;
   unknown position and response references remain in `unverifiedBasis` on the
   ledger, separate from verified ids. The shared evidence catalog supplies check,
   capture and criterion descriptions plus exact ids. Response prompts identify
   unused ids and confirmed baseline ids; repair prompts quote the original
   snapshot's allowed ids. An unsupported insistence becomes a recorded reservation
   with its original requested result and reason. The lawful decider concludes a
   reversible question as contested; no member fault or extra evidence round is
   manufactured. Tests retain supported insistence and reject reused evidence as
   a basis for insisting, while accepting and preserving the reservation.
3. **Challenge loop:** every PM-published brief reset the challenge epoch, so
   even small revisions repeated the full dev/QA round indefinitely. The owner's
   product decision is now in `team-model.md` and shared by scheduler, prompt and
   QA validation: one full round, at most one round on the first revision's changed
   criteria with a diff, then discussion or the baseline card. The card retains
   challenges, answers and the boundary question. Only owner edits/returns reset
   the cycle. Tests cover another PM revision, restart, partial QA plans, removal
   only, and a fresh full round after owner edit/return. Old unit flow setups now
   complete that fresh round before asserting the same baseline result; no native
   baseline assertion was weakened.
4. **Respond shape:** the schema allowed `criterion` to be omitted for removal,
   but the prose never explained its conditional requirement for every other
   change. The respond prompt now distinguishes draft edits from confirmed
   standard changes, spells out matching ids and the complete replacement
   criterion, and includes an example checked by the real validator. The existing
   rejection for an incomplete non-removal change remains intact.

The restart workspace test now has available budget and an owner-card scheduling
hold, preserving its real Git inspection and exact-resume assertions. Separate
tests assert no invocation when that reservation already exhausts the budget.
The native quota cost assertion now requires the compatibility counter to equal
actual turns, as required by this follow-up, rather than expecting an exemption.
QA plans may be empty only when this round has no remaining criteria to plan for
(or all required criteria have explicit unverifiable objections).

Final commands and results for this follow-up:

```sh
npm test -- --configLoader runner src/__tests__/shared/team src/__tests__/main/team src/__tests__/cli/commands/team.test.ts src/__tests__/cli/services/session-command.test.ts src/__tests__/shared/progressRules.test.ts src/__tests__/shared/retryClassification.test.ts src/__tests__/main/follow-ups.test.ts src/__tests__/main/check-runner.test.ts
npm run lint
node node_modules/typescript/bin/tsc -p e2e/tsconfig.team.json --pretty false
node node_modules/eslint/bin/eslint.js src/main/team/{scheduler,report-events}.ts src/shared/team/{policy,types,ledger,report,prompts,schemas,status}.ts
node node_modules/eslint/bin/eslint.js -c eslint.dashes.config.mjs src/__tests__/main/team/scheduler.test.ts src/__tests__/shared/team/{ledger,policy,prompts}.test.ts
node node_modules/eslint/bin/eslint.js -c eslint.dashes.config.mjs --stdin --stdin-filename src/__tests__/native-team-m3.spec.ts < e2e/native-team-m3.spec.ts
git diff --name-only -z --diff-filter=ACM | xargs -0 node node_modules/prettier/bin/prettier.cjs --check
npm run docs:verify
npm run lint:doc-refs
git diff --check
```

All commands exited 0. The final team run passed **438 tests in 19 files**,
including 86 scheduler cases and 22 shared policy cases. All three production
TypeScript projects and the three Electron scenario files type-check. ESLint
reports no errors or warnings for changed production sources and the test passes;
the native file is fed through the repository's test lint configuration on stdin
because its file globs otherwise omit `e2e/`. Prettier passes all 19 changed files.
Documentation verification checks 722 paths with none missing and references
across 39 docs. `git diff --check` passes, and an added-line scan finds zero
forbidden dash characters. The pre-existing untracked survey file is untouched.

Not rerun here: the three Electron scenarios after this patch and paid-model
acceptance. The previous external 25/25 result is not a pass for this artifact.
Run outside the restricted host, preserving current artifacts if needed:

```sh
node scripts/native-e2e.mjs e2e/native-team.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m3.spec.ts
node scripts/native-e2e.mjs e2e/real-team.spec.ts --grep 'team small task'
```

The real-team spec exists in the owner's real-team integration worktree; run the
second command there after applying this patch, with that worktree's documented
opt-in real-acceptance environment. No paid run or external publication was
performed for this follow-up. No commit was made.

## Follow-up after the external native run

The owner's external run of the three team specs passed all six M2 cases and
exposed the failures below. The run log and retained synthetic ledgers were read
in place; their raw contents and local account paths are not copied here. These
fixes retain the owner's solved-before-budget rule, 10-minute wait rechecks, and
the five scripted M2 tests' explicit 60-second timeout. No assertion was loosened.

1. **M1 baseline regression:** the brief repair succeeded, but its accepted report
   belongs to the original dispatch. The new recovery selector looked only at
   the repair dispatch's empty `report` projection and launched an unwanted PM
   `recovery` turn. That consumed the next scripted PM response before baseline
   preparation. The actual card list was empty; check authorization was not the
   cause. Recovery now checks the repair's finished report and the original
   accepted report. A repaired brief plus repaired dev challenge reaches exactly
   the baseline card under default authorization in the regression test.
2. **Quota messages and CLI errors:** an omitted `--to` became `undefined` in the
   argument array, then `null` on JSON serialization. Main rejected that value as
   an invalid seat. CLI now sends PM explicitly; IPC normalizes an omitted/null
   recipient. Main returns `{ status: 'queued', messageId, to }` after durable
   append. JSON failures retain their stdout envelope and also print stderr.
   Tests cover the serialized argument, receipt, queue retention and handling
   after reset, substitute and temporary takeover. A built CLI subprocess exits
   1 with both the JSON error and a nonempty stderr diagnostic.
3. **Missing/bad reports:** both native ledgers show the one report-only repair
   returning a valid review with exit code 0. The same selector error then sent
   an unsupported recovery assignment to the scripted seat, which exited 1 and
   held the PM. Regression tests preserve the exact rejection in the repair
   prompt, permit only one repair, and reach demo/acceptance without recovery.
   Canceled repairs and successful earlier repairs cannot start a new recovery
   or a failed-repair inspection wait.
4. **Wait timestamp:** the scheduler computed `untilMs` before asynchronous
   registration and let append take another clock reading for `at`. All normal,
   quota and fault wait registrations now carry one captured timestamp through
   duration calculation and persistence. An advancing-clock regression reproduces
   the mismatch before the fix and verifies exact 20-minute and 10-minute spans.
5. **T17 restart:** the fixture held process exit after emitting logical turn
   completion. The retained ledger shows dev already finished before restart;
   the interrupted turn was QA verification, whose inspection was correctly
   recorded. The scenario now gates completion after file writes and kills the
   app/provider before releasing it. Its original assertions remain, with added
   assertions that the work is unfinished and inspection sees the changed file.
   A real child-process fixture test fails before this gate change. Scheduler
   integration tests use actual Git worktrees to verify inspection precedes
   native reconciliation or re-execution and preserves the existing file effect.

Seven targeted regression cases failed before their fixes. Final verification:

```sh
npm test -- --configLoader runner src/__tests__/shared/team src/__tests__/main/team src/__tests__/cli/commands/team.test.ts src/__tests__/cli/services/session-command.test.ts src/__tests__/shared/progressRules.test.ts src/__tests__/shared/retryClassification.test.ts src/__tests__/main/follow-ups.test.ts src/__tests__/main/check-runner.test.ts
# 421 passed, 19 files, including 78 scheduler tests.
npm test -- --configLoader runner src/__tests__/cli
# 1826 passed, 1 skipped, 106 files. Covers the shared CLI failure helper's callers.
npm run test:e2e:fixtures -- --configLoader runner e2e/fixtures/native/team-m3.test.ts e2e/fixtures/native/protocol.test.ts -t 'M3 restart fixture|executable stream|SIGINT'
# 5 passed, 4 intentionally unselected, 2 files. No sockets or Electron required.
npm run lint
# All three checks pass: tsconfig.lint.json, tsconfig.main.json, tsconfig.cli.json.
node node_modules/typescript/bin/tsc -p e2e/tsconfig.team.json --pretty false
# Pass: all three team scenario files and their imported fixture graph.
node node_modules/eslint/bin/eslint.js src/main/team src/shared/team src/cli/commands/team.ts src/cli/services/session-command.ts src/main/ipc/handlers/team.ts src/main/preload/team.ts src/renderer/global.d.ts
node node_modules/eslint/bin/eslint.js -c eslint.dashes.config.mjs src/__tests__/main/team src/__tests__/cli/commands/team.test.ts src/__tests__/cli/services/session-command.test.ts e2e/fixtures/native/team-m3.cjs e2e/fixtures/native/cli.cjs
# Both pass.
npm run build:cli
# Pass.
```

The built CLI diagnostic check used an empty temporary `MAESTRO_USER_DATA` and
`node dist/cli/maestro-cli.js team start --idea "Error-path check" --pm terminal --dev codex --qa claude-code --json`.
It failed before contacting the app or starting a model, with the expected seat
validation message on both stdout JSON and stderr.

Prettier passes for all 41 changed/added files; the added-text scan finds zero
forbidden dashes, and `git diff --check` passes. Documentation verification checks
722 paths with none missing and references across 39 docs. The three native
scenario files have not been rerun inside this
restricted host; the owner's failure artifacts remain intact. The required next
native verification command is:

```sh
node scripts/native-e2e.mjs e2e/native-team.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m3.spec.ts
```

Files changed in this follow-up, excluding earlier M3 changes and the owner's
three preserved edits:

```text
docs/agent-guides/CANONICAL-UTILITIES.md
docs/agent-guides/CLI-UI-PARITY.md
docs/round2/dev/team-m3-verification.md
docs/round2/dev/team-model.md
docs/worklog.md
e2e/fixtures/native/cli.cjs
e2e/fixtures/native/team-m3.cjs
e2e/fixtures/native/team-m3.test.ts
e2e/native-team-m3.spec.ts
src/__tests__/cli/commands/team.test.ts
src/__tests__/cli/services/session-command.test.ts
src/__tests__/main/team/ipc.test.ts
src/__tests__/main/team/scheduler.test.ts
src/cli/commands/team.ts
src/cli/services/session-command.ts
src/main/ipc/handlers/team.ts
src/main/preload/team.ts
src/main/team/scheduler.ts
src/renderer/global.d.ts
src/shared/team/types.ts
```

## Implemented contract

| Acceptance | Implementation and coverage                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T8         | Remember checks, push, draft PR and temporary takeover grants by action class. Record publication intent and started/succeeded/failed receipts. Push the owned task branch to the configured project remote; use `gh pr create --draft`, reuse an existing draft on recovery, and report missing CLI or authentication. Merge, publishing and external messages remain owner boundaries and are never executed by the team. |
| T11        | First normal wait wakes after 20 minutes with observed external status; subsequent unchanged waits look again every 10 minutes (PRD 6.8.1). Waits do not enter the no-progress streak. Three attempts on one problem force diagnosis; categories do not count and repeated fingerprints cannot dispatch the same fix.                                                                                                       |
| T14        | Read existing account-specific quota samples before dispatch. Exhausted model/account state survives restart and turn-kind changes. Use an authorized substitute first, then an authorized existing team model in a new conversation, then a registered wait. Prefer a different vendor from dev. Reset or a fresh healthy sample restores the original model in a new conversation.                                        |
| T16        | Overall deadline or reserved turn budget prevents new dispatch. An app-generated unfinished progress report costs no model turn. Extension restores pending permission/baseline decisions; accept-with-gaps preserves unmet items as unassigned follow-ups; stop preserves branch and ledger.                                                                                                                               |
| T17        | Preserve existing exact-dispatch native reconciliation. Inspect workspace revision, status and recent commits before resuming interrupted work. Pause prevents new dispatch while app status stays readable; resume continues from durable receipts.                                                                                                                                                                        |
| T21        | Cover all eight member states. Working is not a fault; failed turns get one bounded retry with partial-work warning; missing/bad reports get one report-only repair; PM can organize a still-missing report; broken sessions use a new same-model conversation; quota/login use availability recovery; idle reports get one nudge then diagnosis. Held failures register app-only inspection waits.                         |
| T22        | `all`, `gaps` and `stopped` retain actual path statistics, seat usage and terminal wall time. Quota/login refusals count once in actual turns and the hard dispatch budget, but never count as a no-progress attempt.                                                                                                                                                                                                       |
| T23        | `decideNext()` is shared by fix planning, team problems and review. Solved problems stay done; otherwise budget wins first. Categories never force escalation, in-authority work wins over boundary alternatives, rewording cannot defeat repeat detection, and boundary cards name the blocked paths, costs, recommendation and used budget.                                                                               |

The exact priority-0 sequence is a PM review dispatch followed by
`model-unavailable` containing `resets 11:10pm`. Scheduler regressions cover wait,
authorized substitute, temporary takeover and reset-after-deadline boundaries.
Repeated wakes do not dispatch PM topic turns or burn the turn budget. The
dispatcher separately verifies classification and reset extraction.

`team show cost`, `team extend`, `team accept --with-gaps`, `team stop`,
`team seat set`, `team seat sub --wait` and publication requests use the same
main-process service exposed through IPC/preload. Every team verb supports
`--json`; the generated reference and CLI-UI parity table are updated.

## Initial implementation commands and results

```sh
npm test -- --configLoader runner src/__tests__/shared/team src/__tests__/main/team src/__tests__/cli/commands/team.test.ts src/__tests__/shared/progressRules.test.ts src/__tests__/shared/retryClassification.test.ts src/__tests__/main/follow-ups.test.ts src/__tests__/main/check-runner.test.ts
npm run lint
node node_modules/typescript/bin/tsc -p e2e/tsconfig.team.json --pretty false
npm run build:main
npm run build:cli
node node_modules/eslint/bin/eslint.js src/main/team src/shared/team src/shared/progressRules.ts src/shared/retryClassification.ts src/cli/commands/team.ts src/main/ipc/handlers/team.ts src/main/preload/team.ts src/renderer/global.d.ts
npm run docs:verify
npm run lint:doc-refs
git diff --check
```

The focused suite passes 412 tests in 18 files, including 72 scheduler tests.
Production and Electron scenario type checks, main/preload and CLI builds,
targeted ESLint, and `git diff --check` pass. Documentation checks resolve 722
asserted paths and references across 39 docs. Formatting passes for all 38 changed
or added files; the added-text scan finds zero forbidden dash characters.

The changed-file formatting command includes untracked M3 additions and excludes
the pre-existing private survey:

```sh
python3 - <<'PY'
import subprocess
files = subprocess.check_output(['git', 'diff', '--name-only'], text=True).splitlines()
files += [p for p in subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], text=True).splitlines() if p != '.survey-A0.md']
raise SystemExit(subprocess.run(['node', 'node_modules/prettier/bin/prettier.cjs', '--check', *files]).returncode)
PY
```

An earlier focused run, concurrent with development builds, passed 411 tests and
timed out in the long T13 review test at its existing 10-second limit. The final
run passed all 412 without changing that test, its assertions or its timeout.

The broader fixture suite was also attempted:

```sh
npm run test:e2e:fixtures -- --configLoader runner
```

Result: 94 passed, 3 failed in `protocol.test.ts`. All three shared app-server
cases failed with `listen EPERM` on their temporary local sockets and then timed
out; the suite reported the same three uncaught errors. A standalone local-socket
probe also returned `EPERM`. This host-limited suite is not a passing gate.

The ordinary renderer build could not write Vite's temporary config into the
shared dependency directory. `npm run build:renderer -- --configLoader runner`
then failed because the existing config expects `__dirname`. This equivalent
local runner invocation built the renderer successfully, with existing chunk
size and ineffective dynamic import warnings:

```sh
node --input-type=module -e 'globalThis.__dirname = process.cwd(); const { build } = await import("vite"); await build({ configLoader: "runner" });'
```

CLI reference generation initially hit the default-data identity guard. It
succeeded against an empty isolated data directory:

```sh
m3_reference_data=$(mktemp -d /tmp/m3-cli-reference.XXXXXX)
MAESTRO_USER_DATA="$m3_reference_data" npm run gen:cli-reference
node node_modules/prettier/bin/prettier.cjs --write docs/cli-reference.md
```

Electron scenario discovery lists 18 tests. The pure shared-rule scenario passes;
it does not launch Electron and is not native acceptance evidence:

```sh
node node_modules/@playwright/test/cli.js test --project=native e2e/native-team-m3.spec.ts --list
node node_modules/@playwright/test/cli.js test --project=native e2e/native-team-m3.spec.ts --grep 'T11 T23 identical'
```

The native priority-0 attempt failed before fixture execution at Electron launch
with `Process failed to launch!`:

```sh
node node_modules/@playwright/test/cli.js test --project=native e2e/native-team-m3.spec.ts --grep 'priority 0.*quota-wait'
```

## Choices and remaining verification

- Immediate failed dispatches use a 30-second minimum cooldown unless a durable
  recovery or binding change changes the condition. The one report-only repair
  is allowed immediately because it does not repeat the assignment.
- An unknown reset time remains a registered wait, with fresh quota samples
  checked periodically. The app does not infer that an unknown reset crosses a
  deadline. The deadline still stops the team and generates the report.
- A bare reset clock is interpreted using the execution host timezone for local
  seats. An SSH clock without an explicit timezone is not guessed locally.
- An unavailable model never resets its latch merely because a new UUID, topic
  kind or prompt wording appears. Dispatched work reserves a turn slot; quota
  and login refusals consume that slot once without entering no-progress.
- Publication is performed only for a concrete requested action under its
  grant. The grant alone does not automatically publish every work revision.
  Git pushes are non-forced; a project with ambiguous remotes fails visibly.
- New model choices outside the team authorization require a named model card.
  Broad merge, publish and external-message execution remains owner-operated.
- Missing usage values remain unknown (coverage counts are exposed), not an
  invented cost. Cost history includes failed provider invocations.
- SSH team workspaces remain explicitly unsupported as in M2. Renderer feature
  wiring, installed-package acceptance, real-model completion after these fixes
  and live GitHub authentication/publication have not been verified by these tests.

On an Electron-capable host, run the native regression and new scenarios:

```sh
npm run test:e2e -- e2e/native-team.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m3.spec.ts
npm run test:e2e:fixtures -- --configLoader runner
```

The synthetic native scenarios use isolated account directories, scripted seats,
temporary Git workspaces and offline persisted-clock changes only while the app
is closed. The T11 persisted-attempt case explicitly seeds prior app observations;
the T23 rule case directly invokes the shared engine. Neither substitutes for
watching a real provider consume three failed attempts.

Real publication requires a separately selected disposable project and explicit
authorization. After selecting that project/team, use
`maestro-cli team action draftPr --team <id> --note "Review this disposable task branch" --json`,
then inspect `maestro-cli team export --team <id> --json` and
`gh pr view --repo <project-remote> <task-branch> --json isDraft,url,headRefName`.
Do not run this against the development repository as a verification side effect.
