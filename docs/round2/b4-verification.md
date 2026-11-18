# B4 conversation follow-ups and acceptance verification

Tested artifact: the uncommitted B4 worktree source on 2026-11-18. No release,
tag, commit, packaging or deployment was performed. The pre-existing local survey
was read but not changed.

## Second follow-up: owner-facing automation turns

The owner's external rerun of the previous artifact passed 5 of 7 scenarios:
both F1 cases, F2, F3 and F4. Both F6 cases stopped on duplicate expiry cards.
The two F6 failure screenshots were reviewed locally without copying captures
or private IDs into this record. The native specs and assertions remain unchanged.

The prompt-display defect was that delivery used the normal queued user entry
without presentation metadata, while native history restored that same prompt
as another user entry. A shared envelope reader now identifies app-authored
turns in both paths and in older cached entries. The self-contained app marker
shows a localized reason, late note or expiry label, with an expandable readable
observation. Queue previews use the same marker. Raw prompt editing/copy controls
are absent for these app-authored entries. The original text still reaches the
agent byte for byte and remains available for provider reconciliation. Naming
skips these turns and old prompt-derived titles, allowing the first owner message
to establish the title even when automation ran first.

The duplicate expiry card came from mounting the same decision component in the
transcript and side panel. Only the latest transcript turn now hosts expiry
Extend/Stop actions; the Follow-ups row shows Expired and a link that scrolls and
focuses that decision. Duration controls previously divided milliseconds into
fractional hours/minutes; the canonical duration engine now supplies localized
labels for limits, waits and ledger/expiry budgets. The delivery bar's no-list
fallback chip was incorrect under PRD D5/F3 and has been removed. Passed counts
require app-run evidence; a batch containing only not-run outcomes stays unverified.

The new jsdom regressions exercise queued turn construction, native conversion
inside the embedded system envelope, legacy cached entries, actual LogItem and
queue rendering, readable observations, title selection, one expiry action set,
panel navigation, short/normal English and Chinese durations, and absent checks.
The full targeted B4 run below passes 28 files and 1,154 tests. No Electron process
was launched in this sandbox; the current source still needs the native rerun below.

## First follow-up investigation after native failures

The owner ran the native command below against the previous artifact: F3 passed,
six scenarios failed. The failure contexts and F4 screenshot were reviewed from
the ignored `e2e-results` directory; no raw capture or private local state was
copied into documentation.

Delivery defect: `getWindowForSession()` returns only explicit assignments.
New primary-window conversations are implicitly owned by the primary window,
as already implemented by WindowContext and the windows IPC handlers. The turn
adapter required an explicit assignment both when pumping and acknowledging,
so those conversations could never receive a turn even after renderer readiness.
Both paths now use the existing ownership rule. An explicit secondary owner
still wins, and an unavailable explicit owner never routes to the primary or to
an active tab. The regression constructs `registerConversationAutomation()` with
real follow-up, automation and turn stores, real WindowRegistry, mocked Electron
transport, and the same caller-bearing execute handler used by the CLI. It also
mounts the real WindowProvider, preload API, listener and queued-prompt path.

F4 defect in the reproduced flow: the first fix turn was blocked by that same
ownership lookup. The decision remained its initial `gather`, with no attempts
and streak 0, matching the empty native transcript. Restoring delivery lets the
real check runner and Git snapshot path record first/second/first workspace
contents: the first and third fingerprints match, all failure signatures match,
`knownAfter` is `[0, 0, 0]`, and verdicts are `first`, `none`, `dup`. The next
turn is diagnosis, with four distinct delivery intents total. `progressRules`
and the native scenarios' assertions were not changed. The native kept F4
ledger was not available here, so this is a reproduced cause, not a claim to
have inspected that ledger.

Evidence limit: the reported absence of `conversation-turns.json` in the first
native F1 run is not explained by the ownership defect, which occurs after the
durable write. The real-wiring test confirms that distinction. A separate
injected write failure reproduces a fired follow-up with no persisted turn and
asserts the contextual main logger error. The original missing-file cause remains
unverified pending the native rerun or its retained state. Persisted automation
`deliveries: []` alone is not proof of a missing turn: that field is a projection
filled by `status`/`list` from the separate turn store.

Observability now includes follow-up id, target, stage and stack for listener,
automation, persistence, owning-window send and renderer failures. Readiness,
receipt, turn start and fix decisions are logged without prompts or output
tails. Listener promise rejections are caught; a window send failure retains its
durable intent for the next ready signal. Tests also reject renderer persistence,
then retry and verify one queue item and acknowledgement only after persistence.
The native fixture now attaches `conversation-automation-<boot>.json` before
closing a failed app, containing the FollowUps and ConversationAutomation logger
buffers (or the capture error). This capture is type-checked but has not been
executed in Electron here. On a live failed run, the existing Log Viewer or these renderer console calls
retrieve the main logger buffer (file logging is not on by default on macOS):

```js
await window.maestro.logger.getLogs({ context: 'FollowUps' });
await window.maestro.logger.getLogs({ context: 'ConversationAutomation' });
```

Red check: with only the owner lookup restored to its previous explicit-only
behavior, this command exited 1 with 3 failed and 4 filtered out. The final
ownership fix was restored before the green commands below.

```sh
./node_modules/.bin/vitest run --configLoader runner src/__tests__/main/conversation-automation-runtime.test.tsx -t 'exact primary owner|mounts the renderer listener|native F4 sequence'
```

## Behavior and ownership

The main-process conversation service owns check lists, project grants, check
evidence, attempt decisions, follow-ups and the shared absolute time limit.
Both shells and the CLI reach this service. The new shell adds Checks and
Follow-ups beside Changes, a CI waiting label in the conversation tree, and
app-produced check counts and failure tails in the delivery bar.

Delivery intent is persisted before dispatch through the exact WindowRegistry
owner. The renderer persists an exact-target queue item before acknowledging it.
Busy turns finish first. Missing targets are reported as undeliverable; literal
mentions in reasons or tool output do not route work to other agents. Replayed
fire records use stable delivery IDs. Late startup firings include a late note.

Checks are authorized once for the physical project and host. Scope is reviewed
again before every run, including package scripts, hooks and existing symlink
arguments. Outside-project, network and opaque commands require one-use approval.
Evidence comes only from the app runner. Cannot-start, timeout and canceled runs
remain unverified and never count as code failures.

Fix turns ask for basis, difference and expectation. The app fingerprints the
workspace and failing signatures, then uses the shared progress rules. Three
attempts without progress, including a repeat, cause diagnosis. Repeated candidate
fingerprints are not selected again. Only a concrete boundary pauses for an owner
choice. Unchanged CI polls never enter the failure ledger.

A single wait defaults to 20 minutes. Pending CI is re-registered at ten-minute
intervals after that wait. Follow-ups and fixes share a two-hour default total.
Expiry cancels automatic work, makes a final observation and persists a report
with extend-one-hour and stop choices. The report resumes if interrupted by a
restart.

## Verification commands

Run from the repository root. The runner config loader avoids Vite attempting to
write its temporary config through the shared node_modules symlink.

```sh
./node_modules/.bin/vitest run --configLoader runner \
	src/__tests__/main/conversation-automation-runtime.test.tsx \
	src/__tests__/main/conversation-turns.test.ts \
	src/__tests__/main/conversation-automation.test.ts \
	src/__tests__/main/check-authorization.test.ts \
	src/__tests__/main/follow-ups.test.ts \
	src/__tests__/main/check-runner.test.ts \
	src/__tests__/main/git/changes.test.ts \
	src/__tests__/shared/progressRules.test.ts \
	src/__tests__/shared/newShellPanel.test.ts \
	src/__tests__/shared/uiSurfaces.test.ts \
	src/__tests__/shared/i18n.test.ts \
	src/__tests__/renderer/services/queuedPrompt.test.ts \
	src/__tests__/renderer/components/ConversationAutomationCards.test.tsx \
	src/__tests__/renderer/stores/agentStore.test.ts \
	src/__tests__/renderer/hooks/useQueueProcessing.test.ts \
	src/__tests__/cli/commands/conversation-automation.test.ts \
	src/__tests__/cli/commands/project-settings.test.ts \
	src/__tests__/renderer/components/TerminalOutput/TurnActivityBar.test.tsx \
	src/__tests__/renderer/components/ConversationAutomationTurn.test.tsx \
	src/__tests__/renderer/services/tabAutoNaming.test.ts \
	src/__tests__/shared/duration.test.ts \
	src/__tests__/renderer/components/QueuedItemsList.test.tsx \
	src/__tests__/renderer/components/ExecutionQueueBrowser.test.tsx \
	src/__tests__/renderer/utils/tabHelpers.test.ts \
	src/__tests__/renderer/utils/executionQueue.test.ts \
	src/__tests__/renderer/utils/transcriptMessages.test.ts \
	src/__tests__/renderer/utils/logEntries.test.ts \
	src/__tests__/renderer/components/TerminalOutput/foldTurnActivity.test.ts
```

Result: exit 0; 28 files, 1,154 tests passed (24.62 seconds). This includes
the real runtime wiring, adapter, CLI, checks and progress regressions from the
first follow-up as well as the new presentation regressions.

```sh
./node_modules/.bin/tsc -p tsconfig.main.json --noEmit
```

Result: exit 0.

```sh
./node_modules/.bin/tsc -p tsconfig.lint.json --noEmit
```

Result: exit 0.

```sh
./node_modules/.bin/tsc -p tsconfig.cli.json --noEmit
```

Result: exit 0.

```sh
./node_modules/.bin/tsc -p e2e/tsconfig.follow-ups.json --noEmit
```

Result: exit 0.

```sh
git ls-files -m -o --exclude-standard | rg -v '^\.survey-A0\.md$' | rg '\.(ts|tsx|js|cjs|mjs)$' | xargs ./node_modules/.bin/eslint --no-warn-ignored
```

Result: exit 0.

```sh
git ls-files -m -o --exclude-standard | rg '^src/__tests__/.*\.(ts|tsx)$' | xargs ./node_modules/.bin/eslint -c eslint.dashes.config.mjs
```

Result: exit 0.

```sh
git ls-files -m -o --exclude-standard | rg -v '^\.survey-A0\.md$' | xargs ./node_modules/.bin/prettier --check
git diff --check
npm run gen:cli-reference
```

Results: exit 0; all 88 changed files pass Prettier and `git diff --check` passes.
CLI reference generation passed in the initial B4 run. The
reference includes already-present team and project commands from this branch.

The initial B4 tests incorrectly required an unchecked-completion chip without
a check list. The corrected jsdom assertions require its absence under PRD D5/F3,
while preserving file counts, plans, turn navigation and explicit check slots.
No native assertions were altered. Two new test-only expectations were corrected
during this pass: Chinese budget punctuation and excluding non-visible stylesheet
braces from the queue text assertion.

## Native acceptance status

The first follow-up artifact passed 5 of 7 scenarios in the owner's external
rerun; the two F6 failures identified the presentation defects above. The current
source and native specs were type-checked only in this sandbox, as requested.
Both spec hashes still match the pre-fix record. The second follow-up artifact
still needs a native rerun. No native Electron launch, real provider invocation
or live CI observation is claimed for this revision. Outside the sandbox:

```sh
node scripts/native-e2e.mjs e2e/native-follow-up.spec.ts e2e/native-checks.spec.ts
```

This builds the main, renderer, web-desktop and CLI artifacts, then runs the
synthetic native project. It covers the 20-second wake tolerance, exit-1 command
tail, unknown-event rejection, forced quit with a late 60-second wake, cancel,
project authorization, app evidence despite an assistant success claim, repeated
attempt diagnosis, lower-frequency CI waits and total-limit expiry.

The current synthetic native checks use POSIX commands and a synthetic gh
executable. Windows command syntax and live SSH execution remain unverified.
To exercise the shared runner on an existing SSH conversation, use exact IDs
from that app, review its project card, and run:

```sh
node dist/cli/maestro-cli.js checks set --agent "<agent-id>" --tab "<tab-id>" --command "git status --short" --json
node dist/cli/maestro-cli.js checks authorize project --agent "<agent-id>" --tab "<tab-id>" --json
node dist/cli/maestro-cli.js checks run --agent "<agent-id>" --tab "<tab-id>" --json
node dist/cli/maestro-cli.js checks status --agent "<agent-id>" --tab "<tab-id>" --json
```

Scope review is a conservative command policy, not an OS sandbox. Opaque programs
and remote package scripts require one-use approval. Project tools and their
configuration execute with the app user's privileges. Incomplete, binary or
unavailable Git snapshots prevent checks from being attributed to a verified
workspace; those runs are recorded as not run. Native timing and pixel-level
prototype fidelity remain pending the native command above.

## Files changed in the second follow-up

Earlier B4 edits remain in the worktree. This follow-up changed these files:

- `CHANGELOG.md`
- `docs/agent-guides/CANONICAL-UTILITIES.md`
- `docs/agent-guides/CLI-UI-PARITY.md`
- `docs/agent-guides/SHARED-UTILS.md`
- `docs/round2/b4-verification.md`
- `docs/worklog.md`
- `src/shared/conversationAutomation.ts`
- `src/shared/conversationAutomationPrompt.ts`
- `src/shared/duration.ts`
- `src/shared/formatters.ts`
- `src/shared/transcriptEntries.ts`
- `src/renderer/types/index.ts`
- `src/renderer/utils/conversationTitle.ts`
- `src/renderer/utils/logEntries.ts`
- `src/renderer/utils/tabHelpers/index.ts`
- `src/renderer/services/tabAutoNaming.ts`
- `src/renderer/components/ChecksPanel.tsx`
- `src/renderer/components/ConversationAutomationCards.tsx`
- `src/renderer/components/ConversationAutomationTurn.tsx`
- `src/renderer/components/ConversationCheckDelivery.tsx`
- `src/renderer/components/ExecutionQueueBrowser.tsx`
- `src/renderer/components/FollowUpObservation.tsx`
- `src/renderer/components/FollowUpsPanel.tsx`
- `src/renderer/components/QueuedItemsList.tsx`
- `src/renderer/components/TerminalOutput/components/LogItem.tsx`
- `src/renderer/i18n/locales/en/conversationAutomation.ts`
- `src/renderer/i18n/locales/zh-CN/conversationAutomation.ts`
- `src/__tests__/renderer/components/ConversationAutomationCards.test.tsx`
- `src/__tests__/renderer/components/ConversationAutomationTurn.test.tsx`
- `src/__tests__/renderer/components/ExecutionQueueBrowser.test.tsx`
- `src/__tests__/renderer/components/QueuedItemsList.test.tsx`
- `src/__tests__/renderer/components/TerminalOutput/TurnActivityBar.test.tsx`
- `src/__tests__/renderer/services/tabAutoNaming.test.ts`
- `src/__tests__/shared/duration.test.ts`
