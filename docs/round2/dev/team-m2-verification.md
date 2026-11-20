# M2 backend verification, 2026-11-17

Artifact: source at `24c01ad8996dc7957307b9d73e6be927a34790ac` plus this uncommitted
worktree change. No commit, tag, release, installer, real-account run or renderer
feature implementation was produced. Main, preload, CLI, desktop-renderer and
web-renderer development builds are distinct from installed-app acceptance.

## Follow-up: immediate dispatch failures

The ledger captured from the failing native review run contained 1,065 events, 200 dispatches and
195 immediate policy failures (118 dev positions and 77 QA positions). After a
failed recovery retry the discussion scheduler created another root dispatch.
The old dispatcher also rejected every dev/QA read-only discussion assignment.
The raw ledger remains a private local diagnostic, not a test fixture.

`teamTurnPermission()` now supplies the same per-turn policy to prompts,
scheduler requests and dispatcher validation. Only dev work/fix and QA
prep/reverify write; PM and all other assignments are read-only. Read-only
provider enforcement applies to every seat. QA boundary restoration runs only
after writing assignments.

Recovery is bounded by durable receipts. Both `turn-failed` and
`model-unavailable` get one same-turn retry and then remain visible as member
faults. A fresh ID, incidental observation, fallback wake, or restart cannot
reset the bound; duplicate roots already present in an older ledger cannot each
obtain another retry. Owner answers and explicit recovery can restart a held
assignment. A different turn kind also needs a changed assignment basis.
Attempts remain in usage history; the guard prevents repeated budget consumption.
The full model takeover chain remains M3 scope.

The five formerly failing scenarios reuse the exact native scripted reports
and baseline in scheduler tests. These tests exercise real scheduling, prompt
construction, report validation and ledger projection, with simulated execution,
check results and captures. Discussion reaches a team decision; contested takes
two rounds; commitment and relaxation produce owner cards, with a failing check
still failing. Review covers edit/diff/return, a busy-seat owner message, two
rejections then retro, a third rejection with progress, a gated first demo and
the added criterion's second demo. Dispatcher tests independently run every
seat/turn permission combination through native spawn preparation.

Follow-up verification commands:

```sh
npm test -- --configLoader runner src/__tests__/shared/team src/__tests__/main/team src/__tests__/cli/commands/team.test.ts src/__tests__/shared/progressRules.test.ts src/__tests__/main/check-runner.test.ts src/__tests__/main/ipc/handlers/system.test.ts src/__tests__/renderer/utils/modelFamily.test.ts
npm run lint
npx tsc -p e2e/tsconfig.team.json --noEmit --pretty false
npm run build:main
npx eslint src/shared/team src/main/team
npx eslint -c eslint.dashes.config.mjs src/__tests__/main/team e2e/fixtures/native/team-m2.cjs
npm run docs:verify
npm run lint:doc-refs
git diff --check
node node_modules/prettier/bin/prettier.cjs --check CHANGELOG.md docs/agent-guides/CANONICAL-UTILITIES.md docs/round2/dev/team-model.md docs/round2/dev/team-m2-verification.md docs/worklog.md e2e/fixtures/native/team-m2.cjs e2e/native-team-m2.spec.ts src/__tests__/main/team/runtime.test.ts src/__tests__/main/team/scheduler.test.ts src/__tests__/main/team/turn-dispatcher.test.ts src/main/team/scheduler.ts src/main/team/turn-dispatcher.ts src/shared/team/policy.ts src/shared/team/prompts.ts src/shared/team/status.ts
```

The focused suite passes 439 tests in 17 files, including both failure sequences,
replayed duplicate roots, explicit recovery and all five scripted flows. The
production and Electron scenario type-checks, main/preload build and targeted
ESLint checks pass. Documentation verification checks 721 paths with none missing;
references resolve across 39 docs. Formatting passes for all 15 follow-up files,
the forbidden-punctuation scan has zero matches, and `git diff --check` passes.
The general dash-rule ESLint config does not include the Electron spec; its
formatting, punctuation scan and explicit TypeScript project check do include it.
The existing failure-ledger dump and optional-team type fix in the native spec are
preserved. Electron run outside the sandbox on 2026-11-18 (macOS, synthetic seats):
`node scripts/native-e2e.mjs e2e/native-team-m2.spec.ts e2e/native-team.spec.ts`
passed 7 of 7 in 2.4 minutes (discussion, contested, commitment, relaxation, review,
permission, and the M1 scenario). The single-spec command is:

```sh
node node_modules/@playwright/test/cli.js test --project=native e2e/native-team-m2.spec.ts
```

The original implementation's validation record follows; its earlier test count
and launch limitation describe that earlier run.

## Implemented and covered

| Acceptance | Backend coverage                                                                                                                                                                                            | Synthetic Electron scenario               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| T5         | Sealed positions, lawful decider, per-seat actions and waits, two rounds then contested, evidence extension, two evidenced objections requiring an experiment, commitment card                              | discussion, contested, commitment         |
| T6         | Failed checks stay failed, relaxation application preserves old text, new observation required to reopen a decided question                                                                                 | relaxation and reopening after discussion |
| T7         | Owner edit, immutable previous version, minimal diff, return discussion, fresh challenges, runnable-command gate                                                                                            | review                                    |
| T8         | Workspace-check authorization is remembered; explicit boundary-crossing checks require per-invocation approval without expanding it                                                                         | permission                                |
| T9         | Target-only wake, busy-seat queue, delivered/forwarded/handled receipts, owner additions/edits/removals applied by PM                                                                                       | review message during active dev work     |
| T10        | Exact frozen assignment and visible reply from `team log --seat`; same IPC/preload/CLI actions                                                                                                              | all scenarios                             |
| T13        | Criterion-bound problems, suggestions for other ideas, any violation rejects, issue/work creation, two rejections then retro, third rejection with progress continues, subsequent pair causes another retro | review                                    |
| T15        | Every confirmed criterion plus PM review gates demo; owner changes restart implementation, QA and review; second demo covers only added criterion                                                           | review                                    |

Unit tests also cover per-viewer capture receipts, immutable before/after files,
missing viewers, escaped symlinks, stalled compositor teardown, superseded issue
history, evidence-count dilution, and canonical vendor grouping. Existing M1
scheduler, workspace, store, dispatcher, IPC, report, ledger and progress-rule
regressions are included in the focused run.

## Commands and results

Run from the repository root. The final command outcomes are listed below.

```sh
npm test -- --configLoader runner src/__tests__/shared/team src/__tests__/main/team src/__tests__/cli/commands/team.test.ts src/__tests__/shared/progressRules.test.ts src/__tests__/main/check-runner.test.ts src/__tests__/main/ipc/handlers/system.test.ts src/__tests__/renderer/utils/modelFamily.test.ts
npm run lint
npx tsc -p e2e/tsconfig.team.json --noEmit --pretty false
npm run build:main
npm run build:cli
npx eslint src/shared/team src/shared/checkRun.ts src/shared/modelFamily.ts src/main/team src/main/utils/capture-page.ts src/main/check-runner.ts src/main/ipc/handlers/team.ts src/main/ipc/handlers/system.ts src/main/preload/team.ts src/renderer/global.d.ts src/renderer/utils/modelFamily.ts src/cli/commands/team.ts
npx eslint -c eslint.dashes.config.mjs src/__tests__/shared/team src/__tests__/main/team src/__tests__/cli/commands/team.test.ts
npm run docs:verify
```

Final outcomes:

- Focused unit suite: 17 files, 374 tests passed.
- `npm run lint`: passed all three TypeScript projects.
- Electron scenario TypeScript project: passed, including M1 and all six M2 scenarios.
- Main/preload and CLI development builds: passed.
- Targeted source ESLint and test dash-rule ESLint: passed.
- `docs:verify`: 721 asserted paths checked, zero missing.
- `lint:doc-refs`: references resolved across 39 docs.
- Prettier: all 39 changed files passed. `git diff --check`: passed.
- Forbidden U+2013/U+2014 character scan: zero matches in the 39 changed files.

The additional documentation and formatting commands were:

```sh
npm run lint:doc-refs
git diff --check
python3 - <<'PY_CHECK'
import subprocess
from pathlib import Path
files = subprocess.check_output(['git', 'diff', '--name-only', '-z']).decode().split('\0')
files += subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z']).decode().split('\0')
files = sorted({f for f in files if f and f != '.survey-A0.md'})
assert not [f for f in files if any(chr(c) in Path(f).read_text() for c in (0x2013, 0x2014))]
subprocess.run(['node', 'node_modules/prettier/bin/prettier.cjs', '--check', *files], check=True)
PY_CHECK
```

The unrelated pre-existing scratch file was not changed.

This checkout shares a read-only dependency tree. Default Vite config bundling
failed because it writes a temporary file beside that tree. The runner loader
avoids that write. These desktop and web builds passed, with existing chunk-size
and static/dynamic import warnings:

```sh
node --input-type=module -e 'globalThis.__dirname = process.cwd(); const { build } = await import("vite"); await build({ configLoader: "runner" });'
node --input-type=module -e 'globalThis.__dirname = process.cwd(); const { build } = await import("vite"); await build({ configFile: "vite.config.web-desktop.mts", configLoader: "runner" });'
```

The CLI reference was generated with isolated empty settings, then formatted;
only the team section was retained to avoid refreshing unrelated pre-existing
reference drift. The first generator invocation refused the default data
directory at its product-identity check, before generating the reference.

```sh
m2_reference_data=$(mktemp -d /tmp/m2-cli-reference.XXXXXX)
MAESTRO_USER_DATA="$m2_reference_data" npm run gen:cli-reference
npx prettier --write docs/cli-reference.md
```

Electron launch was attempted with:

```sh
node node_modules/@playwright/test/cli.js test --project=native e2e/native-team-m2.spec.ts --grep 'team M2 discussion'
DEBUG=pw:browser node node_modules/@playwright/test/cli.js test --project=native e2e/native-team-m2.spec.ts --grep 'team M2 discussion'
```

Both failed before a scenario ran: `Process failed to launch!`. The diagnostic
launch exited with `SIGABRT`, and Playwright's kill attempt reported `EPERM`.
No scenario assertions, screenshots or native-provider round trips are claimed
as passing. Raw local launch logs and account paths are not included here.

## Interpretation choices

- A discussion round is proposal plus responses. Positions remain sealed through
  the proposal, following the explicit reveal-at-step-3 requirement. Fresh native
  contexts and topic-only prompt slices prevent prior conversation context from
  revealing other positions. This is context isolation, not a filesystem sandbox
  preventing a deliberately disobedient native agent from reading team files.
- Question identity is `question` (defaulting to topic text) or `reopens`.
  Reopening requires a recorded observation after the previous decision, not a
  new wording or fabricated evidence reference.
- PM tightening conservatively preserves the old text as a prefix, proof method,
  named locations and numerical examples, with a dev cost/deadline estimate and
  a stated within-meaning rationale. Other rewrites go to an owner card. The app
  cannot mechanically prove semantic equivalence of arbitrary natural language.
- The canonical progress rules own both rejection and no-progress streaks.
  A retro is a diagnosis marker and resets those streaks; there is no independent
  counter or fixed limit that allows a still-failing review to enter demo.
- `locations` is the explicit manifest of places named by a criterion. The app
  records failure for unavailable viewers. Legacy briefs without a manifest
  capture up to 200 tracked files; they do not prove that an unspecified external
  viewer was inspected. Native apps outside Electron need a capture adapter.
- Owner additions retain exact owner wording. Edits/removals identify the existing
  criterion; the original message remains the reason. Superseded issues preserve
  their failed history and are never labelled QA-verified.
- Test counts recognize TAP and common Vitest/Jest/pytest summaries. Unknown
  summaries remain unknown and are flagged. The app reports fewer tests, more
  skips and changed command text; these flags do not rewrite check exit results.

## Unverified and remaining boundaries

1. Run the new six synthetic Electron scenarios and the M1 regression on a host
   that can launch Electron. After the builds above:

   ```sh
   node node_modules/@playwright/test/cli.js test --project=native e2e/native-team.spec.ts e2e/native-team-m2.spec.ts
   ```

2. T8 is only partially covered here. Workspace checks and explicit check
   boundaries are implemented and unit-tested. No automated draft-PR, merge or
   paid-model-switch execution path was added to M1 by this M2 task; full T8
   acceptance cannot be claimed. Existing `TeamWorkspaces.pushDevWork()` remains
   separately authorized but is not newly dispatched by M2. Re-run the workspace
   authorization regression with:

   ```sh
   npm test -- --configLoader runner src/__tests__/main/team/workspaces.test.ts src/__tests__/main/team/scheduler.test.ts
   ```

   End-to-end push/draft-PR/merge/new-model acceptance still needs its execution
   integration and fixtures; there is no passing command for that missing path.

3. Check boundary declarations plus recognizable paths and verbs are not complete
   shell analysis or OS confinement. Indirect effects inside project scripts
   depend on correct declaration. Sealed native contexts similarly do not make
   arbitrary native tool access a sandbox. These limitations must not be presented
   as security guarantees.

4. External native viewers, real-model behavior, renderer cards/interactions,
   Windows/Linux CI and packaged-app acceptance were not exercised. Renderer
   integration is a separate task. Run the Electron command above on both CI
   platforms; real-model and packaged acceptance require the existing explicit
   opt-in acceptance/release procedures, not the synthetic fixture.

## Changed files

```text
CHANGELOG.md
docs/agent-guides/CANONICAL-UTILITIES.md
docs/agent-guides/CLI-UI-PARITY.md
docs/cli-reference.md
docs/round2/dev/team-m2-verification.md
docs/round2/dev/team-model.md
docs/worklog.md
e2e/fixtures/native/cli.cjs
e2e/fixtures/native/team-m2.cjs
e2e/native-team-m2.spec.ts
e2e/tsconfig.team.json
src/__tests__/cli/commands/team.test.ts
src/__tests__/main/team/ipc.test.ts
src/__tests__/main/team/output-capture.test.ts
src/__tests__/main/team/scheduler.test.ts
src/__tests__/shared/team/fixtures.ts
src/__tests__/shared/team/ledger.test.ts
src/__tests__/shared/team/policy.test.ts
src/__tests__/shared/team/report.test.ts
src/cli/commands/team.ts
src/main/check-runner.ts
src/main/ipc/handlers/system.ts
src/main/ipc/handlers/team.ts
src/main/preload/team.ts
src/main/team/output-capture.ts
src/main/team/report-events.ts
src/main/team/runtime.ts
src/main/team/scheduler.ts
src/main/utils/capture-page.ts
src/renderer/global.d.ts
src/renderer/utils/modelFamily.ts
src/shared/checkRun.ts
src/shared/modelFamily.ts
src/shared/team/ledger.ts
src/shared/team/policy.ts
src/shared/team/prompts.ts
src/shared/team/report.ts
src/shared/team/schemas.ts
src/shared/team/types.ts
```
