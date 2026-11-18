# M3 backend verification, 2026-11-18

## M3 fix2/fix3 merge integration, 2026-11-18

Artifact: `838f3d31a` plus the in-progress merge of `f65c6933b` and this
integration. The owner reported 40/40 native scenarios passing on `838f3d31a`;
that is not a native run of this merge. No staging, commit or Electron execution
was performed here. Fix4 QA location resolution and efficiency work are excluded.

The initial full team run reproduced exactly five failures (496 passed).
The hard dispatch budget and two-round challenge policy already held in the
merged scheduler. The integration restores the typed card contract and corrects
these stale test assumptions without relaxing scheduling or message assertions:

- Baseline objections are structured `payload.challenges`, not serialized body
  text. The cap/restart test now checks the exact objection and second-round
  scope in that payload; it still checks the human boundary question and four
  challenge dispatches across restart.
- Both 20-turn tests now check `payload.generatedBy: app` and the human report
  distinction instead of parsing `body` as JSON. Their exact dispatch/usage limit
  and no-recovery assertions remain intact, with and without a recorded wrap-up.
- The T7 PM acknowledgment fixture had restored the pre-edit `how` field while
  acknowledging the new text. That is a real criterion change under fix2 and
  correctly required another challenge. The fixture now acknowledges both owner
  fields, and adds a final assertion that the new proof method survives. The
  two-canary, immutable-history and confirmation assertions remain intact.
- The edit/return test previously returned immediately after editing. Fix2 now
  starts a fresh full challenge and supersedes the old confirmation card. The
  test completes that new round before returning, matching the UI scenario's
  existing wait for the next card. It still verifies the exact return note in
  the PM prompt, the next published version, preserved owner text, footer
  revision, minimal diff and delivered/handled message order with the gate closed.

The baseline payload now types its challenge/response/decision history and stores
the shared `teamChallengeRound()` scope at card creation. The renderer labels
the full or changed-criteria round and folds the captured objections, QA plans,
PM answers and decisions. A later cycle cannot replace that card's captured
history. The discussion payload's boundary sentence renders once through the
existing presentation adapter, with localized app wording. New English/Chinese
tests cover the frozen round and scope; standard-change tests additionally check
the single localized boundary explanation. No raw JSON is rendered.

```sh
npx vitest run --configLoader runner --no-cache src/__tests__/main/team/scheduler.test.ts -t 'PM revisions cap|T7 owner baseline|revises the baseline after|real-run budget 20'
# Before: 5 failed. After: 5 passed, 93 unselected, 1.28 s.
npx vitest run --configLoader runner --no-cache src/__tests__/renderer/components/Team/M2.test.tsx
# 26 passed, 1 file, 6.85 s.
npx vitest run --configLoader runner --no-cache src/__tests__/shared/team src/__tests__/main/team src/__tests__/renderer/components/Team src/__tests__/cli/commands/team.test.ts src/__tests__/shared/progressRules.test.ts
# 503 passed, 19 files, 35.37 s.
npx vitest run --configLoader runner --no-cache src/__tests__/renderer/i18n/messages.test.tsx
# 9 passed, 1 file, 1.38 s.
npx tsc -p tsconfig.lint.json --noEmit
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.cli.json --noEmit
npx tsc -p e2e/tsconfig.team.json --noEmit
# All four exit 0 with no diagnostics.
```

ESLint/Prettier use the executable changed-file selection below, relative to
HEAD and including incoming merge files. All three ESLint scopes pass, and
`npx prettier --check` passes all 31 changed/added files. `npm run docs:verify`
checks 742 asserted paths with 0 missing. `git diff --check` passes; scans find
0 conflict markers and 0 added forbidden dash characters.

Files edited for this integration, beyond the incoming merge:

- `src/shared/team/types.ts`: Type baseline history/scope and discussion boundary text with compatibility for older cards.
- `src/main/team/scheduler.ts`: Freeze the shared challenge scope in the baseline payload.
- `src/renderer/components/Team/TeamBaseline.tsx`: Render the round summary and captured challenge/response fold.
- `src/renderer/components/Team/OwnerCard.tsx`: Mount baseline history and the single boundary explanation.
- `src/renderer/services/teamClient.ts`: Localize the structured commitment boundary without duplicate prose.
- `src/renderer/i18n/locales/en/team.ts`: Add English challenge scope and objection outcomes.
- `src/renderer/i18n/locales/zh-CN/team.ts`: Add matching Chinese strings.
- `src/__tests__/main/team/scheduler.test.ts`: Align old flow fixtures with full owner-edit challenges and human card payloads, preserving behavior assertions.
- `src/__tests__/renderer/components/Team/M2.test.tsx`: Verify frozen challenge scope/history and localized boundary rendering.
- `CHANGELOG.md`: Record card presentation and remove the obsolete duplicate quota-budget exemption.
- `docs/worklog.md`: Record this merge integration and its validation.
- `docs/round2/dev/team-m3-verification.md`: Record the reproduced failures, precise adjustments and checks.

Native execution and visual layout remain unverified for this merge. External command:

```sh
MAESTRO_E2E_SHOTS=/tmp/maestro-m3-integration-shots node scripts/native-e2e.mjs e2e/native-team.spec.ts e2e/native-team-ui.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m2-ui.spec.ts e2e/native-team-m3.spec.ts e2e/native-team-m3-ui.spec.ts
```

## M3 UI external review follow-up, 2026-11-18

The owner ran all six native team specs externally: 38 passed, 2 failed. This
round inspected the supplied failure screenshots, trace and retained M1 fixture
ledger, plus the quota/takeover and Chinese unfinished-report screenshots. No
Electron or screenshot run was performed here. The same merge remains resolved
in file contents and unstaged; no commit was made.

The failed M1 ledger ended after QA opened the defect. Dev had already repaired
its malformed challenge report and completed implementation successfully. The
new failure cooldown selected the successful repair because its accepted report
belongs to the original dispatch, leaving the repair's `turn.report` empty.
Its `turn_finished.report` was valid. The cooldown now excludes that successful
receipt (and canceled turns), while retaining the guard for actual failures.
The scheduler regression follows repaired PM/dev reports, an owner note during
the baseline checkpoint, confirmation, work, QA issue, dev fix and QA reverify,
without advancing past the cooldown. It failed at the absent fix dispatch before
the correction. The M1 scenario's polling and issue-order assertions are unchanged;
it now also saves `ledger.json` on failure. The inspected ledger is retained only
in the ignored failure-artifact directory, with no private paths in this record.

Login cards now name the vendor display name and the host-resolved account
directory in their human body. `payload.provider` retains the provider ID and
`payload.accountDir` carries the directory, never credential contents. The native
login assertion now checks the existing structured `provider: claude-code`,
`accountSeat`, resolved directory and human `Claude Code` text instead of requiring
the provider ID in prose. Scheduler coverage verifies the same account resolver.

Recovery receipts and waits use the single client presentation adapter. Takeover
and restart explanation cards are not repeated by the recovery receipt. Quota
waits name the provider, known reset and next check in the UI language. Known
application instructions are mapped to human text; member-authored rationale and
editable criterion proof methods remain content. Members labels developer/QA
worktrees instead of showing lone directory names. Sidebar coverage is one line,
with its actual catalog model and effort in the tooltip. Budget exhaustion takes
precedence over a paused flag in the header and status strip and removes the
pause/resume control; the unfinished report remains the decision point. Ordinary
owner pauses still offer Resume and queue composer input. Twelve new jsdom cases
cover these changes in English and Chinese.

Checks:

```sh
npx vitest run --configLoader runner --no-cache src/__tests__/main/team/scheduler.test.ts -t 'M1 repaired reports|M3 still-working is not'
# Before: 2 failed. After: 2 passed, 84 unselected, 706 ms.
npx vitest run --configLoader runner --no-cache src/__tests__/shared/team src/__tests__/main/team src/__tests__/renderer/components/Team src/__tests__/cli/commands/team.test.ts src/__tests__/shared/progressRules.test.ts
# 466 passed, 19 files, 25.30 s.
npx vitest run --configLoader runner --no-cache src/__tests__/renderer/components/SessionList/ProjectSessionSidebar.test.tsx src/__tests__/renderer/components/ProjectSessionTree.test.tsx src/__tests__/renderer/i18n/messages.test.tsx
# 70 passed, 3 files, 14.71 s.
npx tsc -p tsconfig.lint.json --noEmit
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.cli.json --noEmit
npx tsc -p e2e/tsconfig.team.json --noEmit
# All four exit 0, including the six scenario files and their imported fixtures.
```

ESLint passes all changed source, test and scenario files using the same
changed-file selection command recorded below. `npx prettier --check` passes all
63 changed/added files. `npm run docs:verify` checks 740 asserted paths with 0
missing. `git diff --check` passes. The complete working diff includes the
uncommitted merge and both UI rounds, so formatting covers that whole file set.

Files changed in this follow-up:

- `src/main/team/scheduler.ts`: Ignore successful repair receipts in the failure cooldown; name the resolved login account.
- `src/shared/team/types.ts`: Type the login payload's resolved account directory.
- `src/__tests__/main/team/scheduler.test.ts`: Extend the M1 repair regression through the issue chain and verify login identity.
- `e2e/native-team-ui.spec.ts`: Save the full ledger when the M1 UI scenario fails.
- `e2e/native-team-m3.spec.ts`: Assert structured provider identity and readable vendor/account text.
- `src/renderer/services/teamClient.ts`: Share localized recovery and wait presentation; map application prose safely.
- `src/renderer/components/Team/TeamHealth.tsx`: Show resolved login details and compact coverage identity.
- `src/renderer/components/Team/TeamPrimitives.tsx`: Keep catalog model/effort in compact tag tooltips.
- `src/renderer/components/Team/TeamSidebar.tsx`: Use compact, nonwrapping coverage labels.
- `src/renderer/components/Team/TeamProgress.tsx`: Present provider/reset waits with the shared adapter.
- `src/renderer/components/Team/TeamPanel.tsx`: Label developer and QA workspaces.
- `src/renderer/components/Team/TeamView.tsx`: Distinguish exhausted budget from owner pause and localize the next wait.
- `src/renderer/components/Team/TeamFeed.tsx`: Localize recovery receipts and keep one takeover explanation.
- `src/renderer/components/Team/TeamEscalation.tsx`: Show the resolved login account and readable escalation context.
- `src/renderer/components/Team/OwnerCard.tsx`: Route displayed rationale through the human-text adapter.
- `src/renderer/components/Team/TeamDiscussion.tsx`: Apply the adapter to displayed response and wait text.
- `src/renderer/components/Team/TeamDecisions.tsx`: Apply the adapter to displayed standard-change reasons.
- `src/renderer/i18n/locales/en/team.ts`: Add human English recovery, wait, budget and workspace wording.
- `src/renderer/i18n/locales/zh-CN/team.ts`: Add the corresponding Chinese wording.
- `src/__tests__/renderer/components/Team/M3.test.tsx`: Add both-language state, receipt, wait, workspace and compact-row coverage.
- `CLAUDE.md`: Index the shared recovery/wait presenters.
- `docs/agent-guides/CANONICAL-UTILITIES.md`: Document the presentation boundary and reuse rules.
- `CHANGELOG.md`: Record the user-facing corrections.
- `docs/worklog.md`: Record this follow-up and its verification.
- `docs/round2/dev/team-m3-verification.md`: Preserve the external evidence, diagnosis and exact checks.

Still unverified here: Electron layout, live account login and the corrected
native scenarios. The external rerun command remains:

```sh
MAESTRO_E2E_SHOTS=/tmp/maestro-m3-ui-fix1-shots node scripts/native-e2e.mjs e2e/native-team.spec.ts e2e/native-team-ui.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m2-ui.spec.ts e2e/native-team-m3.spec.ts e2e/native-team-m3-ui.spec.ts
```

## M3 UI integration, 2026-11-18

Artifact: `744410cc8` plus the in-progress merge of `d0e1698c5` and the M3 UI
working-tree changes. All conflict markers are resolved. The index deliberately
remains unmerged: no staging or commit was performed. Earlier backend records
below describe their own artifacts, not an Electron run for this UI change.
The separate backend follow-up for dispatch hard stops, position references and
challenge limits was not reimplemented.

The pre-renderer merge gate passed 427 tests in 18 files (34.60 s) and all four
TypeScript projects. The merged runtime retains quota sampling, model-aware
launch options and account resolution for takeover transcripts. M2 human
checkpoint bodies, structured payloads, baseline returns and message handling
remain covered by the suite. A focused account/transcript regression run passed
3 tests with 81 unselected. Restart inspection now has a distinct durable receipt
from an earlier retry inspection, so that prior receipt cannot hide recovery
from the UI. Both real-workspace restart cases failed before this correction
and pass afterward (2 passed, 84 unselected, 1.23 s).

### Surfaces and prototype mapping

- Seat rows and Members use the same health projection: active work, bounded
  retry, missing/bad report, broken conversation, unavailable model, expired
  login, idle turn and normal wait. Held faults have a dot and details instead
  of a busy spinner. Coverage uses the actual binding's catalog model and
  account source. Members explains automatic switchback and retains fault
  history. Login opens the existing account-scoped reauthentication dialog;
  confirming recovery is a separate owner action.
- The prototype's temporary-PM explanation and normal wait become ledger-derived
  feed entries. An unavailable PM also exposes the app-generated status card,
  including evidence coverage, missing reasons, open work, waits and budget.
  Waits show the recorded next check, with the initial 20-minute and subsequent
  10-minute cadence; internal application job identifiers stay out of the UI.
- The prototype's authorization and unavailable-PM decision cards use generic
  owner cards with one boundary label, attempted paths, costs, recommendation
  and budget. Permission detail names the action class, exact action, task
  branch, no-main boundary and decline effect. Grants appear in Members and
  rules. Declining a requested publication records a failed receipt and skips
  that action without stopping independent work.
- The header retains the compact layout, always shows budget usage and, when
  set, time remaining to deadline. Paused state is explicit and the composer
  continues to queue. The 80-percent wrap-up plan is informational.
- The deadline/budget simulation renders a distinct progress report, beginning
  with the report-versus-demo disclaimer. It shows the captured output, missing
  evidence and reasons, recorded attempts, changes and recommendation. Owner
  choices extend the proposed time/turns, accept the listed gaps or stop while
  retaining branch and ledger. Report snapshots retain their recorded attempts
  and output rather than silently substituting later work.
- The terminal collaboration summary covers accepted, accepted with gaps and
  stopped using actual reducer statistics. Gap items remain unmet and have
  editable follow-up owners. Assignment appends an event through the shared
  IPC and CLI path; it does not mark evidence passing.
- Progress renders the prototype's problem attempt ledger with numbered
  attempts, basis, difference, expected evidence, progress/no-progress/repeat
  or diagnosis verdicts. The restart simulation renders one inspection note
  per dispatch, while preserving the backend's reconciliation and work effects.
- Members adds per-seat and total turns, input/output tokens, recorded cost and
  member time, plus team wall time and cost coverage. Values use the same
  reduced usage as `team show cost`. Existing output, discussion, baseline,
  review, demo, message handling and terminal composer behavior remain intact.

### Checks for the integrated source

```sh
npx vitest run --configLoader runner --no-cache src/__tests__/shared/team src/__tests__/main/team src/__tests__/renderer/components/Team src/__tests__/cli/commands/team.test.ts src/__tests__/shared/progressRules.test.ts
# 454 passed, 19 files, 17.82 s. Includes 23 new M3 renderer cases.
npx vitest run --configLoader runner --no-cache src/__tests__/renderer/components/SessionList/ProjectSessionSidebar.test.tsx src/__tests__/renderer/components/ProjectSessionTree.test.tsx src/__tests__/renderer/i18n/messages.test.tsx
# 70 passed, 3 files, 6.65 s.
npm run test:e2e:fixtures -- --configLoader runner e2e/fixtures/native/team-m3.test.ts
# 1 passed, 1 file, 594 ms. Does not launch Electron.
npx tsc -p tsconfig.lint.json --noEmit
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.cli.json --noEmit
npx tsc -p e2e/tsconfig.team.json --noEmit
# All four exit 0; no diagnostics.
npx playwright test e2e/native-team-m3-ui.spec.ts --project=native --list
# 7 tests discovered; discovery only.
MAESTRO_USER_DATA=/tmp/maestro-m3-ui-reference npm run gen:cli-reference
# Exit 0; includes the CLI build and generated residual assignment reference.
```

ESLint and Prettier use the complete changed-file set relative to HEAD, including
incoming merge files and new files. The executable command is recorded here so
it does not depend on a private temporary helper:

```sh
python3 - <<'CHECKS'
import pathlib
import subprocess
files = sorted(set(
    subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], text=True).splitlines()
    + subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], text=True).splitlines()
))
files = [p for p in files if pathlib.Path(p).is_file() and not p.endswith('.png')]
source = [p for p in files if p.startswith('src/') and not p.startswith('src/__tests__/') and p.endswith(('.ts', '.tsx'))]
tests = [p for p in files if p.startswith('src/__tests__/') and p.endswith(('.ts', '.tsx'))]
scenarios = [p for p in files if p.startswith('e2e/') and p.endswith(('.ts', '.cjs'))]
for command in [
    ['npx', 'eslint', *source],
    ['npx', 'eslint', '-c', 'eslint.dashes.config.mjs', *tests],
    ['npx', 'eslint', *scenarios],
    ['npx', 'prettier', '--check', *files],
]:
    subprocess.run(command, check=True)
CHECKS
npm run docs:verify
git diff --check
```

All three ESLint scopes and Prettier pass (59 changed/added files checked for
formatting). `docs:verify` checks 740 asserted paths with 0 missing.
`git diff --check` passes; conflict-marker and added-text scans find no markers
and no forbidden dash characters. No screenshots were added.

### Native verification still required

No Electron run, new screenshot, real login, live quota reset, real paid model
or publication was performed for this UI round. Layout, focus and real
reauthentication still need native verification. Run on an Electron-capable host:

```sh
MAESTRO_E2E_SHOTS=/tmp/maestro-m3-ui-shots node scripts/native-e2e.mjs e2e/native-team.spec.ts e2e/native-team-ui.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m2-ui.spec.ts e2e/native-team-m3.spec.ts e2e/native-team-m3-ui.spec.ts
```

The seven new scenarios cover permission, quota escalation/takeover, login
expiry, missing report, limits in English and Chinese, and no-progress attempts.
Owner actions use UI controls and assert ledger state: permission, takeover,
baseline confirmation, pause/resume, extension, acceptance with gaps and residual
assignment. Screenshots are optional via `MAESTRO_E2E_SHOTS` and include the three
fault families, app status, permission/escalation, unfinished report, gaps
summary, attempts and cost table. Clock advances and prior attempt history use
the existing stopped-fixture technique, not a claim of live 20-minute waits or
three real provider failures. Login screenshots do not attempt real credentials.

### Changed-file manifest

This lists the whole diff against HEAD; entries marked incoming are preserved
M3 backend work, not a second implementation of it.

- `CHANGELOG.md`: Retain both merge entries and add the user-facing M3 UI change.
- `docs/agent-guides/CANONICAL-UTILITIES.md`: Retain incoming team recovery, quota and progress utility guidance.
- `docs/agent-guides/CLI-UI-PARITY.md`: Merge both audits; document M3 owner actions, login and residual assignment parity.
- `docs/cli-reference.md`: Regenerate CLI help including residual owner assignment.
- `docs/round2/dev/team-m3-verification.md`: Preserve backend evidence and record this merge, UI surfaces, checks and limitations.
- `docs/round2/dev/team-model.md`: Merge M2/M3 model documentation and describe the renderer contract.
- `docs/worklog.md`: Record this round and its source-only verification.
- `e2e/fixtures/native-team-m3.ts`: Share M3 isolated setup, stopped-app mutation and attempt history between specs.
- `e2e/fixtures/native/cli.cjs`: Dispatch M1, M2 and M3 through the same native team scene helper.
- `e2e/fixtures/native/team-m3.cjs`: Retain M3 scripted seats; add optional repair/takeover screenshot gates.
- `e2e/fixtures/native/team-m3.test.ts`: Retain the incoming real child-process restart gate test.
- `e2e/native-team-m3-ui.spec.ts`: Add seven owner-driven UI scenarios with ledger assertions and optional screenshots.
- `e2e/native-team-m3.spec.ts`: Reuse the shared M3 fixture without changing backend scenario assertions.
- `e2e/tsconfig.team.json`: Include every M1/M2/M3 backend and UI scenario.
- `src/__tests__/cli/commands/team.test.ts`: Retain M3 command coverage and test residual assignment arguments.
- `src/__tests__/cli/services/session-command.test.ts`: Retain incoming CLI error-envelope and stderr coverage.
- `src/__tests__/main/team/ipc.test.ts`: Retain M3 handlers and add the residual assignment channel.
- `src/__tests__/main/team/quota.test.ts`: Retain incoming provider quota/reset tests.
- `src/__tests__/main/team/scheduler.test.ts`: Merge all regressions; test takeover accounts, structured payloads, declined publication and residual ownership.
- `src/__tests__/main/team/turn-dispatcher.test.ts`: Retain incoming M3 dispatch failure and usage tests.
- `src/__tests__/main/team/workspaces.test.ts`: Retain incoming inspection and publication tests.
- `src/__tests__/renderer/components/Team/M3.test.tsx`: Cover M3 health, cards, permissions, attempts, terminal states, ownership, login, restart and costs.
- `src/__tests__/shared/progressRules.test.ts`: Retain incoming repeat/progress diagnosis coverage.
- `src/__tests__/shared/team/ledger.test.ts`: Retain incoming quota, usage, residual and terminal reduction tests.
- `src/__tests__/shared/team/policy.test.ts`: Retain incoming takeover and authorization policy coverage.
- `src/cli/commands/team.ts`: Retain M3 commands; add team residual assign and its help.
- `src/cli/services/session-command.ts`: Retain incoming machine-readable CLI failure behavior.
- `src/main/ipc/handlers/team.ts`: Merge imports and M3 handlers; add residual assignment.
- `src/main/preload/team.ts`: Merge M2/M3 wire types; expose residual assignment.
- `src/main/team/quota.ts`: Retain incoming account-scoped quota sampling.
- `src/main/team/report-events.ts`: Retain incoming wrap-up, waiting and recovery event mapping.
- `src/main/team/runtime.ts`: Combine quota, model-aware launch options and actual-source transcript account lookup.
- `src/main/team/scheduler.ts`: Preserve both schedulers; structure M3 card payloads, distinguish restart inspection and support residual assignment/decline.
- `src/main/team/turn-dispatcher.ts`: Retain incoming fault classification, recovery and usage handling.
- `src/main/team/workspaces.ts`: Retain incoming workspace inspection and authorized publication.
- `src/renderer/components/Team/OwnerCard.tsx`: Render structured escalation/report detail while preserving single boundary labels and option behavior.
- `src/renderer/components/Team/TeamEscalation.tsx`: Add permission, attempted-path and unfinished-report presentations.
- `src/renderer/components/Team/TeamFeed.tsx`: Render M3 fault, takeover, wait, wrap-up, app status and restart entries.
- `src/renderer/components/Team/TeamHealth.tsx`: Share seat health, coverage identity, provider details and account login controls.
- `src/renderer/components/Team/TeamPanel.tsx`: Add progress attempts/waits/residuals and member health/grants/costs.
- `src/renderer/components/Team/TeamPrimitives.tsx`: Allow seat tags to use takeover source catalogs and omit repeated role labels.
- `src/renderer/components/Team/TeamProgress.tsx`: Add waits, app status, attempt history, cost bill, residual owners and wrap-up.
- `src/renderer/components/Team/TeamSidebar.tsx`: Display actual seat health and coverage in left-bar member rows.
- `src/renderer/components/Team/TeamSummary.tsx`: Keep actual terminal statistics and add costs plus assignable unmet follow-ups.
- `src/renderer/components/Team/TeamView.tsx`: Show paused state and remaining deadline alongside budget usage.
- `src/renderer/components/Team/deriveTeamFeed.ts`: Group M3 wrap-up/inspection events and avoid duplicate wrap-up reports.
- `src/renderer/global.d.ts`: Retain merged team bridge contract and type residual assignment.
- `src/renderer/i18n/locales/en/team.ts`: Add English M3 state, action, report and cost strings.
- `src/renderer/i18n/locales/zh-CN/team.ts`: Add matching Chinese M3 strings and prototype terminology.
- `src/renderer/services/teamClient.ts`: Keep one adapter for human card prose, structured payloads and relative display text.
- `src/renderer/stores/teamStore.ts`: Add residual assignment through the existing pending/error action path.
- `src/shared/progressRules.ts`: Retain incoming attempt classification and shared diagnostic behavior.
- `src/shared/retryClassification.ts`: Retain incoming quota, login and session fault classification.
- `src/shared/team/ledger.ts`: Preserve M2/M3 reduction; replace a residual item when its owner changes.
- `src/shared/team/policy.ts`: Retain incoming quota-aware binding, takeover and action policies.
- `src/shared/team/prompts.ts`: Retain incoming wrap-up, waiting and recovery prompt contracts.
- `src/shared/team/schemas.ts`: Retain incoming M3 report schemas.
- `src/shared/team/status.ts`: Retain incoming M3 status and cost projections.
- `src/shared/team/types.ts`: Retain M2/M3 contracts; type escalation/report/permission payloads and inspection reason.

Artifact: `d50dba3f49c8b5c7a975a8a545dd442f603341ff` plus the uncommitted M3
worktree changes. Verification targets source and development builds, not an

Latest artifact: `ee282fec1` plus the uncommitted third real-model follow-up changes.

Latest artifact: `f65c6933b` plus the uncommitted fourth real-model follow-up changes.
Earlier M3 records below used `d50dba3f49c8b5c7a975a8a545dd442f603341ff` plus
the then-uncommitted M3 work. Verification targets source and development builds, not an
installed release. No commit, tag, release, paid model invocation or real GitHub
publication was performed. Existing private survey material is not part of this
change.

## Fourth follow-up: QA output locations and app capture faults

Read the owner's 143-event, 19-turn real-run ledger in place. It had no rejected
reports or repairs and one decider normalization. The new fixture retains only
the synthetic C2 criterion from the confirmed brief, including both README and
`qa/clamp.qa.test.cjs` locations; no raw capture or account paths were copied.

1. **Wrong workspace:** `captureTeamOutput()` accepted only dev's cwd and resolved
   every file against it, even QA-owned `qa/...` files. Every scheduler capture
   now supplies the QA binding. Shared `teamOutputLocation()` routes `qa/...` and
   absolute paths inside QA's `qa/` to QA, other relative paths to dev, independent
   of the criterion's proof or author. Captures identify the workspace and resolved
   source. Normalization uses the same rule and keeps explicit workspace identity.
   Physical boundaries still reject traversal and escaping symlinks; a missing QA
   binding cannot fall back to a dev file. Tests use the actual C2 shape with its
   test file present only in QA and README only in dev. Both new capture tests
   failed against the old implementation before the fix. File copies now include
   workspace and content hash so QA changes at an unchanged dev revision preserve
   both versions instead of reusing stale bytes.
2. **Wrong fault classification:** the verify gate converted `missingOutputLocations()`
   into app-authored standard issues. The next scheduler pass therefore woke PM
   to change a confirmed criterion. That conversion is removed. A missing capture
   records one app-owned `output_observation` per capture, visible through status,
   CLI and the app-generated progress report. Review remains blocked until real
   output is available; criterion evidence stays intact. App-only recapture occurs
   after QA writes, a new verification of a missing location, changed standards,
   resume/extension, or the 10-minute recheck interval. Unchanged wakes and restart
   neither duplicate the observation nor spend model turns. Successful newer
   output clears the active observation while retaining history. Genuine
   member-reported standard issues still use the existing PM path. The old unit
   expectation that a missing viewer creates a standard issue was replaced because
   it contradicts this explicit product correction, not to bypass a proof check.
3. **Efficiency audit:** the second challenge round was justified. The first PM
   revision changed both C1 and C2: C1 added untracked-file and byte-identity checks;
   C2 added an explicit validation-out-of-scope requirement, the dev-module source
   and concrete QA cases/checklist. The diff rule therefore correctly requested
   the one permitted additional round. No challenge rule changed. The later PM
   `message` had no owner message to process; its recorded note asked PM to resolve
   the app-created standard issue. Removing that issue removes this wasted turn
   and its seven discussion turns. The observed run also spent one wrap-up turn
   after that detour reached 80%. The direct scheduler regression proceeds from
   QA verify to PM review with C1/C2 passing, unchanged locations and no issue,
   discussion, owner card or redundant capture. Actual real-model acceptance is
   still unverified; the synthetic result does not predict the next model's review.

Final validation commands for this artifact:

```sh
npm test -- --configLoader runner src/__tests__/shared/team src/__tests__/main/team src/__tests__/cli/commands/team.test.ts src/__tests__/cli/services/session-command.test.ts src/__tests__/shared/progressRules.test.ts src/__tests__/shared/retryClassification.test.ts src/__tests__/main/follow-ups.test.ts src/__tests__/main/check-runner.test.ts
npm run lint
node node_modules/typescript/bin/tsc -p e2e/tsconfig.team.json --pretty false
node node_modules/eslint/bin/eslint.js src/main/team/{scheduler,output-capture}.ts src/shared/team/{policy,report,types,ledger,status}.ts
node node_modules/eslint/bin/eslint.js -c eslint.dashes.config.mjs src/__tests__/main/team/{scheduler,output-capture}.test.ts src/__tests__/shared/team/{policy,status}.test.ts
git diff --name-only -z --diff-filter=ACM | xargs -0 node node_modules/prettier/bin/prettier.cjs --check
node node_modules/prettier/bin/prettier.cjs --check src/__tests__/shared/team/real-output-criterion.json
npm run docs:verify
npm run lint:doc-refs
git diff --check
```

All listed commands exited 0. **463 tests in 19 files passed**, including the
existing scripted M2 flows and the new actual-C2 capture, fault/restart/retry and
deadline-report cases. All three production TypeScript projects and all three
Electron scenarios type-check. ESLint has no errors or warnings. Prettier passes
all 18 changed tracked files plus the new JSON fixture. Documentation checks
report 724 asserted paths with none missing and valid references across 39 docs.
`git diff --check` and the added-line/new-fixture forbidden-dash scan pass.
The focused run initially exposed two wrong field names in the new scheduler
test setup (`version`/`phase` instead of `briefVersion`/`to`); these were corrected
before the final run. Native scenario files and assertions were not changed.

Builds and native attempt:

```sh
npm run build:main
npm run build:cli
node --input-type=module -e 'globalThis.__dirname = process.cwd(); const { build } = await import("vite"); await build({ configLoader: "runner" }); await build({ configFile: "vite.config.web-desktop.mts", configLoader: "runner" });'
node node_modules/@playwright/test/cli.js test --project=native e2e/native-team.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m3.spec.ts --output e2e-results/m3-output-routing --max-failures=1 --reporter=line
```

Main/preload, CLI, renderer and web-desktop builds exited 0. The Vite runner
command uses the already documented sandbox workaround for the shared
`node_modules` config cache and supplies the configs' expected `__dirname`;
build configs were not changed. Existing chunk-size and mixed import warnings
remain. Playwright exited 1 because Electron failed to launch before the first
scenario's assertions: **1 launch failure, 24 unrun**. The new error context is
under `e2e-results/m3-output-routing/`; earlier artifacts are preserved. This is
not a native pass or an observed scenario regression. Real models were not run.
Outside the restricted host, the outstanding verification commands are:

```sh
node scripts/native-e2e.mjs e2e/native-team.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m3.spec.ts
node scripts/native-e2e.mjs e2e/real-team.spec.ts --grep 'team small task'
```

The real-model command requires the documented owner-run opt-in account setup.
No commit or external publication was performed.

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
