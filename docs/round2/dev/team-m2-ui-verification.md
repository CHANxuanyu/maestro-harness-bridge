# M2 team UI verification

Artifact: uncommitted source above merge `eb53faa0a` in the UI worktree. No commit,
Electron execution, screenshot capture, installer, release or real-provider run was made locally.

The M1 UI stall was a synthetic-seat routing error. M2 dispatches an owner-message
turn while baseline confirmation is open. The sequential M1 PM script consumed
its next review response for that turn, which fails message-report validation and
leaves the note pending. `nativeTeamScene()` now routes that assignment through
the shared M2 message script without consuming a scheduled M1 response. The
scheduler regression queues the note, records delivery, confirms the baseline,
then accepts the scripted handled receipt and verifies entry into implementation.
Production scheduling still requires the owner note to be handled.

The merge review retained both M2 handled receipts and M1 owner-message counters,
readable baseline and progress-report bodies, baseline diffs, account-scoped seat
transcripts, and both sets of scheduler tests. Remaining discussion, permission
and acceptance JSON bodies moved into typed payloads. The CLI still reads human
bodies and exposes structured payloads. Baseline editing now accepts optional
proof source and proof method through the existing IPC, preload and CLI path.

## Surfaces

- Discussion: the prototype's four-step fold updates at one feed location. Seat
  submissions stay sealed through proposal; response assignment opens them.
  Decisions use the shared layer policy and show dissent, next actions and the
  contested flag. Reference votes are explicitly advisory.
- Decisions: separate newest-first team and owner sections, actual basis,
  discussion links that expand enclosing phase folds, and standard-change history.
- Baseline: inline text, proof and method editing; version labels; minimal diffs
  with deleted text struck through; return with a note. Historical cards keep
  their original brief and diff. Actions go through the bridge and ledger mirror.
- Standard change: existing and proposed text side by side, reason, failing-check
  notice and approve/keep controls. The old criterion remains effective until an
  approved ledger change. Team additions and tightening are informational entries.
- Review: location, confirmed criterion, impact and expected result for each
  problem; a quieter suggestions list; retrospective approach, basis, difference
  and progress; the PM review attempt record in the Progress tab.
- Output/demo: captured previews and file links, exact `beforeOutputId` comparison,
  output first, then evidence, decisions and changes. Demos replay their original
  ledger position; subsequent demos restrict evidence and changes to their delta.
  Accept uses the shared readiness policy. Paths and evidence captions hide
  storage paths and transport identifiers.
- Messages/member view: queued, delivered and handled receipts appear in the feed
  and composer. Native transcripts remain read-only, with transport report fences
  removed by `teamReplyMessage()`. Ledger assignments and produced domain records
  accompany the transcript; sealed positions stay sealed here too. Esc and seat
  focus restoration are preserved. New controls and labels have English and Chinese
  translations. Prior sidebar, header, phase-strip, tab and terminal-composer fixes
  remain in place.

## Screenshot follow-up

The owner reported 12 of 15 native scenarios passing outside the sandbox. The
supplied failure screenshot and trace show an open, focused criterion textarea:
its wrapping label also contained its initial text, so Playwright's exact label
query did not match. Baseline fields now use explicit label/control associations,
and the scenario checks the named textbox is editable before filling it. Native
readiness reads the saved UI language and the app's locale tables for the empty
state, project button and both conversation placeholders. The M1 message check
waits for handled UI state and checks delivered-before-handled ledger sequence.

The supplied discussion and standard-change screenshots were inspected directly;
no images were copied or added. Discussion headers distinguish pending authority
from an actual decision, omit empty segments and name the app naturally. The
current step is visible even when folded; future sections are absent. Proposal
rounds are numbered, with revised text or an explicit unchanged-text note. Status
cells use one label line and one truncated value line, preserving a visible
additional-item count and the full value in a tooltip. Standard-change buttons
explain approval versus retaining a failing standard; the CLI receives the same
human consequences. Approval of a modified criterion still requires fresh
verification; it does not manufacture a passing check. The five scripted scheduler
flows now have the requested explicit 60-second timeout for loaded or Windows
hosts, with their assertions unchanged.

## Edit-and-return follow-up

The owner reported 13 of 15 native scenarios passing externally, with only the
English and Chinese review paths failing at the returned brief. Both supplied
ledgers contain `baseline_returned` at sequence 46, the completed return discussion
at 75, and unfinished PM/dev `message` assignments at 79/80 with empty `messages`
arrays. There is no later PM `respond` assignment or `brief_published` event. The
owner edit produced version 3 with A1 still first and E1 still second; no PM revision
was overwritten or applied to the wrong criterion.

The synthetic message gate was holding every `message` turn, including the
read-only preparation actions following the discussion. Both scheduler slots were
occupied until a gate release scheduled after baseline confirmation, so the PM
revision could never start. The fixture now gates only turns carrying actual
messages. Production scheduling, prompt data and the UI scenario assertions are
unchanged. A new scheduler regression uses the same gated seat script for edit,
return, discussion and preparation; checks the subsequent PM prompt's actual
`baselineReturns` field; and verifies version 4 preserves the owner's A1 text and
adds the footer to E1. It also checks the next baseline card, the E1-only diff and
that real message delivery still waits for explicit gate release before handling.
The regression failed before the fixture fix at the PM preparation gate, then
passed after it (1 passed, 56 skipped; 642 ms).

```sh
npx vitest run --configLoader runner --no-cache src/__tests__/main/team/scheduler.test.ts -t 'revises the baseline after an owner edit and return'
```

Second follow-up results for the full-suite, four TypeScript, lint, formatting and
document commands below: 353 tests passed in 17 files (15.37 s); all four TypeScript
projects exited 0; both ESLint passes and Prettier exited 0; docs:verify checked
739 paths with 0 missing; `git diff --check` and the forbidden-dash scan passed.
The renderer-only, readiness-only and discovery results below belong to the first
screenshot follow-up. No Electron scenario was run locally in either follow-up.

## Commands

```sh
npx vitest run --configLoader runner --no-cache src/__tests__/renderer/components/Team src/__tests__/main/team src/__tests__/shared/team src/__tests__/cli/commands/team.test.ts src/__tests__/scripts/native-app-readiness.test.ts
npx vitest run --configLoader runner --no-cache src/__tests__/renderer/components/Team
npx vitest run --configLoader runner --no-cache src/__tests__/scripts/native-app-readiness.test.ts
npx tsc -p tsconfig.lint.json --noEmit
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.cli.json --noEmit
npx tsc -p e2e/tsconfig.team.json --noEmit
git ls-files -z --modified --others --exclude-standard -- '*.ts' '*.tsx' '*.cjs' ':!:src/__tests__/**' | xargs -0 npx eslint
git ls-files -z --modified --others --exclude-standard -- 'src/__tests__/**/*.ts' 'src/__tests__/**/*.tsx' | xargs -0 npx eslint -c eslint.dashes.config.mjs
git ls-files -z --modified --others --exclude-standard | xargs -0 npx prettier --check
npm run docs:verify
git diff --check
npx playwright test e2e/native-team.spec.ts e2e/native-team-ui.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m2-ui.spec.ts --project=native --list
```

Screenshot-follow-up results: Vitest 17 files, 352 tests passed (10.74 s); the renderer-only
check passed 67 tests in 3 files (7.49 s). After switching readiness to the canonical
translator, its final focused check passed 2 tests in 1 file (556 ms). ESLint production/scenario
and test-file passes exited 0 with no diagnostics; Prettier passed; docs:verify
checked 739 asserted paths with 0 missing; diff whitespace check passed; native
scenario discovery found 15 tests in 4 files. All four TypeScript projects exited 0 with no diagnostics and no emitted output. The earlier verification hit the scheduler review test's default 10-second limit
under concurrent compiler load. This follow-up applies the requested per-flow
60-second limit rather than depending on an unloaded machine.

The CLI reference was generated with `npm run gen:cli-reference` and formatted
with Prettier. The first default invocation was refused by the product-data guard.
A second invocation with `MAESTRO_DEMO_DIR` set to an isolated temporary directory
containing only a matching product marker and English settings succeeded; that
directory was then removed. This built the development CLI bundle only.

## Unverified native acceptance

```sh
MAESTRO_E2E_SHOTS=/tmp/team-m2-ui-shots node scripts/native-e2e.mjs e2e/native-team.spec.ts e2e/native-team-ui.spec.ts e2e/native-team-m2.spec.ts e2e/native-team-m2-ui.spec.ts
```

The wrapper rebuilds main, renderer, web desktop and CLI before launching the native
project. The seven new UI scenarios cover the six scripted M2 paths plus a Chinese
review run. They use UI actions for baseline edit/return/confirm, commitment and
standard-change decisions, busy-seat messaging, requesting a second demo, acceptance
and member-view navigation, then assert ledger facts. Shared gates hold sealed
positions, message delivery and the third review for stable observations. Optional
screenshots capture sealed positions, a contested decision, baseline diff, standard
change, the retro after two rejections and the second demo. Filenames include the
scenario and language. The follow-up needs a fresh external run of Electron layout, screenshots and
end-to-end interactions; listing and type
checking scenarios are not execution.
