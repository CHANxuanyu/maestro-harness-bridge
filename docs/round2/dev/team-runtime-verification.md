# Team M1 runtime verification

Artifact: uncommitted A1b-2 worktree changes on `d19ed750b`, 2026-11-17. No
release build or installed artifact was tested. The renderer is a separate task.

## Checks

Run from the repository root:

Final targeted result: 14 files, 194 tests passed. All four TypeScript projects
and both changed-file ESLint passes completed with exit code 0. The changed-file
Prettier check and `git diff --check` also passed.

```sh
npx vitest run --configLoader runner src/__tests__/main/team src/__tests__/shared/team src/__tests__/shared/progressRules.test.ts src/__tests__/main/check-runner.test.ts src/__tests__/main/follow-ups.test.ts src/__tests__/cli/commands/team.test.ts
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.lint.json --noEmit
npx tsc -p tsconfig.cli.json --noEmit
npx tsc -p e2e/tsconfig.team.json --noEmit
npx eslint src/main/team/{scheduler,runtime,report-events,turn-dispatcher,workspaces}.ts src/main/ipc/bootstrap/index.ts src/main/ipc/handlers/{team,index}.ts src/main/preload/{team,index}.ts src/shared/team/{types,report}.ts src/renderer/global.d.ts src/cli/{index,commands/team}.ts e2e/native-team.spec.ts
npx eslint -c eslint.dashes.config.mjs src/__tests__/main/team/{scheduler,runtime,ipc,turn-dispatcher,workspaces}.test.ts src/__tests__/shared/team/report.test.ts src/__tests__/cli/commands/team.test.ts
npx prettier --check CHANGELOG.md docs/worklog.md docs/agent-guides/{CANONICAL-UTILITIES,CLI-UI-PARITY}.md docs/round2/dev/{team-model,team-runtime-verification}.md src/main/team/{scheduler,runtime,report-events,turn-dispatcher,workspaces}.ts src/main/ipc/bootstrap/index.ts src/main/ipc/handlers/{team,index}.ts src/main/preload/{team,index}.ts src/shared/team/{types,report}.ts src/renderer/global.d.ts src/cli/{index,commands/team}.ts e2e/{native-team.spec.ts,tsconfig.team.json} src/__tests__/main/team/{scheduler,runtime,ipc,turn-dispatcher,workspaces}.test.ts src/__tests__/shared/team/report.test.ts src/__tests__/cli/commands/team.test.ts
npm run test:e2e:fixtures -- --configLoader runner
git diff --check
```

The runner config loader avoids Vite trying to write its generated config into
the externally located dependency directory. The default config loader failed
with `EPERM` before collecting tests in this sandbox.

Fixture result: 23 files passed, 1 failed; 93 tests passed, 3 failed, 3 unhandled
errors. All three failures are existing app-server protocol cases whose Unix
socket `listen` was denied with `EPERM`. No fixture source was modified.

## Outside-sandbox acceptance

```sh
npm run test:e2e:fixtures -- --configLoader runner
MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-team.spec.ts
```

Electron could not be launched in the task sandbox, so the second command was
not run. It builds the main process, renderer, web desktop and CLI, then runs
the native Playwright project. The scenario is explicitly skipped in real mode.
No paid provider or real account was used. Full repository CI, Windows/Linux
native execution and a packaged app were not verified here.

The synthetic scenario gives each seat its own script and account directory.
It covers missing PM and malformed dev reports, isolated dev/QA challenges,
CLI baseline confirmation, parallel implementation/QA preparation, QA boundary
restoration, a forced quit after a native dev result but before its process exit,
automatic receipt recovery, a QA defect/fix/retest, PM review/demo, CLI acceptance,
ledger attribution and uniqueness, evidence sources, concurrency, and export.
The unit suite additionally covers native-history pagination/account selection,
senderless IPC, broadcasts, missed event notifications, slow QA restoration,
owner-answer crash recovery, permission memory, follow-ups and progress decisions.

## Scope choices

- The fixed task API supersedes the older `team:state` description: broadcasts
  are `team:changed`, and `get` returns config plus ordered ledger events.
- Baseline dry runs establish that a command can execute. A nonzero product
  test exit is allowed before implementation; missing commands and timeouts
  send the check definition back to PM. Trial rows never prove completion.
- `push` follows the existing workspace service's commit-and-push authorization
  class. M1 commits the task branch and advances QA locally; it does not push or
  open a PR. Substitute, PR and temporary-takeover settings are retained for
  later scheduling milestones. SSH creation is explicitly refused.
- M1 incorporates `respond.askOwner` into the baseline card. General discussions,
  PM rejection loops and full model/login/quota recovery are M2/M3. A rejected
  or unrepairable direct-path result wakes PM; it is never silently accepted.
- `requestChanges` records the exact owner note as an added QA-verifiable
  criterion and a dev work item, then requires PM restatement before new work.
  It does not silently rewrite the earlier baseline criteria.
- A repeated failing fingerprint gets an evidence-gathering turn with no repeat
  fingerprint; three no-progress attempts get a dev diagnosis with the attempt
  record. Check row IDs alone are not new evidence. A narrow QA retest does not
  erase a previously failed broad criterion; another `verify` supplies that proof.
- Application jobs run outside the event queue. Failures register a persisted
  30-second retry; reported external waits use the existing bounded time follow-up.
  Pause stops new dispatches and retains running results. Stop cancels active work.
- Native recovery matches the exact dispatch marker in the correct account and
  ignores commentary. Recovered text is validated normally. Token/cost totals
  unavailable from a recovered transcript remain unknown. Receipt IDs prevent
  duplicate ledger results, but incomplete external side effects can require a
  resumed seat to inspect and preserve partial work; the prompt states this.
- The 5-second response and 30-second fallback guarantees are verified with
  fake timers and service boundaries, not measured on a running Electron build.
  Worktree isolation and QA restoration are not an operating-system sandbox.
