# CLI / UI Parity Audit

Rule (constitutional, see CLAUDE.md): anything a person can do by pointing and
clicking in Maestro, an agent MUST be able to do through `maestro-cli`, through
the same code path. A UI action ships with its CLI verb. This file records where
that holds today, where it does not yet, and why.

Audited 2026-08-19 against the three surfaces that define "clickable": the
keyboard shortcut registry (`src/renderer/constants/shortcuts.ts`), the Quick
Actions command builders (`src/renderer/components/QuickActionsModal/commands/`),
and the Left Bar context menus (`src/renderer/components/SessionList/`). The
authoritative CLI surface is `docs/cli-reference.md`, generated from the
Commander tree by `npm run gen:cli-reference`.

The HB DeepSeek preset (2026-10-31) adds `create-agent --preset deepseek` with
`--api-key-env` or `--api-key-stdin`. Both CLI and the pending UI call the same
main-process preparation service; account isolation, model catalog and the Opus
handoff are recorded in [core-experience-contracts.md](../core-experience-contracts.md).

The HB About Me export (2026-11-01) adds `about-me show|set|status|apply`.
Desktop `settings.aboutMe` and the CLI `about_me` request share the same service
for native instruction discovery, exact managed blocks and explicit file consent.
`set` only stages the existing `conductorProfile`; `apply` performs approved writes.
The Settings page (2026-11-02) saves through `set`, lists `status`, and writes with
`apply` plus the per-file confirmations the user ticked, so a page write and
`about-me apply --confirm <real file>` reach the same checks. Conflict,
partial-result and long-profile cases are in
[core-experience-contracts.md](../core-experience-contracts.md#关于我).

The native startup check (2026-11-02) is an internal read, not a user action.
`settings.aboutMe({ action: 'native', agent })` and the CLI `about_me` transport
use the same serialized service. No `status --agent` verb is needed: the existing
`status --json` returns each file's `agentIds` and optional DeepSeek provenance,
while startup needs the live spawn configuration, including unsaved environment
values. Standalone CLI prompts reuse `inspectNativeAboutMe()` without a desktop
connection. A confirmed, current, nonempty native block replaces duplicate prompt
text with `nativeAboutMePointer()`; every uncertain result retains the body.
Desktop spawns ask the same read through `conductorProfileForAgent()`; the
wizard prompts still inject the body.

## Stop and read-only resume corrections (2026-11-06)

No UI action or CLI verb is added. `tab permission <tab> readonly` and
`tab read-only <tab> true` retain the existing permission implementation;
`send` and `dispatch` into an open conversation still reach `useInputProcessing`.
That path now uses `appendReadOnlyPrompt()` in `src/shared/readOnlyPrompt.ts`.
Resume, backfill and refresh decode the same suffix in
`transcriptMessagesToLogEntries()`, including history written by older builds.
Standalone CLI and Auto Run contain no copy of this suffix and are unchanged.
Native files remain untouched. The CLI's raw native-history read still returns
provider content rather than the renderer's normalized conversation entries.

Stop forwards the existing `ManagedProcess.interrupted` flag through exit IPC,
so the exit listener does not request a synopsis after deliberate cancellation.
The existing CLI Stop gap below remains open. A new command cannot simply reuse
the old remote interrupt callback: it constructs a legacy process id and does
not share the desktop handler's multi-tab, queue and synopsis cancellation work.
Closing that gap requires an acknowledged command routed to the same owner and
interrupt implementation. This correction adds no separate stop implementation.

The review follow-up keeps these same actions. Consecutive refreshes preserve
genuine repeated sends; an old cached internal prompt outside the newest 500
messages makes the same read-only service widen its window. `withMentionTurnNotes()`
now uses the shared `appendTurnNote()` envelope, including editable templates;
`stripTurnPrompt()` decodes it and the historical default note order before
native messages enter resume, backfill or refresh. No new CLI verb or UI control
is added. The native refresh and Stop entries under Open gaps remain open, and
raw native-history reads still expose provider wire content. Old custom notes
without the new envelope cannot be identified safely and remain unchanged.

The third-round Electron correction changes acceptance checks only. Full
conversation assertions cover both repaired sends and their distinct identities;
the persisted cache is checked against its exact 100-entry tail, followed by
native backfill after restart. Selecting the conversation still uses the existing
refresh service. No UI action, CLI verb or production implementation changes,
and the native refresh and Stop gaps below remain open.

## New shell cleanup, batch 1

The new shell permission menu and the phone options sheet share `permissionModes()`
and `permissionModeFields()` with the existing permission cycle. The new
`tab permission <tab-id> <full|standard|readonly>` command uses the allowlisted
`update_session_config` path, validates provider capabilities and applies the same
field patch. `tab show <tab-id> --json` and `session list --json` return the effective
`permissionMode`, including the legacy read-only fallback. Existing `tab read-only`
commands and keyboard bindings are unchanged.

The conversation row menu uses `requestAiHandoff()`. Its CLI equivalent remains
`handoff <source-tab> <provider>` for a draft, with `--list-targets` for discovery.
Handoff and review reuse a target runner's sole tab only when it is idle with no
messages, native session, draft, images, deferred history or queued work. The
shared renderer service names the tab from the captured source conversation
title. `handoff` returns that name as `title` in JSON and `Title:` in text output;
the draft and explicit-send payload are unchanged. Both shells share this behavior.
Moving account configuration to the project menu keeps `create-agent <name>` with
`--cwd`, `--type`, `--group` or `--preset`. The footer and menu reuse `open settings`,
`open notification-center`, `notify inbox` and `open feedback`. Hiding a control
does not remove its command or write a saved preference.

## New shell conversation permissions, T1

| UI action                                          | CLI                                                                    | Shared implementation                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| New conversation in the current conversation       | `tab new --agent <id>` uses project recency as specified for CLI entry | `createTab()`, `newConversationPermissionFields()`                                    |
| Project plus, palette or new conversation shortcut | `tab new --agent <id> [--prompt <text>]`                               | `resolveProjectConversationPermission()`, `createTab()`, both remote new tab handlers |
| Select a conversation, then create                 | `focus-agent <agent> --tab <tab>` followed by `tab new --agent <id>`   | `setActiveTab()`, also used by unified keyboard navigation                            |
| Pick a tool for a new conversation                 | `tab new --agent <id> --provider <provider>`                           | `context:conversation`, `openHandoffTarget()`                                         |
| Change tool in an empty conversation               | `tab new --agent <id> --provider <provider> --replace-empty <tab>`     | `readHandoffSource()`, `openHandoffTarget()`                                          |
| Prepare handoff or review                          | `handoff <source-tab> <provider> [--review]`                           | Source permission snapshot and `openHandoffTarget()`                                  |
| Deliberately change permission                     | `tab permission <tab-id> <full\|standard\|readonly>`                   | `permissionModeFields()`; read with `tab show <tab-id> --json`                        |

Inheritance is gated by `newShell`. Conversation buttons carry the exact source.
The browser sends `sourceTabId` to the owner and adopts the returned permission
fields, including when an inventory update arrives before the response. A missing
explicit source refuses creation. CLI creation retains the specified project scope.

Project creation uses `resolveProjectConversationPermission()`. Main requests the
compact permission and activity snapshot from each session's owning window in
parallel, with a 250 ms limit. Unassigned sessions follow the existing primary
window ownership rule. It checks the replying window and rejects a reply
if ownership moved. Complete replies select the newest selection, message or
creation time. Missing or timed out replies use the strictest known mode across
local project copies and successful replies, including retained closed tabs.
Projects on different SSH hosts remain separate; remote paths are not resolved
locally. The provider creation route also bounds its source metadata hop to
250 ms and lets the target use the same resolver after a missing reply.

Closing the last tab preserves its permission in the automatic replacement.
Provider changes preserve supported modes, tighten unsupported standard to readonly,
and refuse a target without an equally strict mode. Handoff snapshots carry the
source permission. Manual changes only patch the new tab. Native history imports,
compaction and the classic shell keep their existing behavior. No new CLI verb,
permission confirmation or user-facing text is introduced.

Open gaps: local fallback cannot know a restriction that no reachable window or
local copy has ever reported. It uses the strictest known mode as specified by the
review, rather than claiming the unavailable owner's current permission is known.
Electron and browser acceptance scenarios require an external run.

## New shell project opening, batch 2

| UI action                                                      | CLI                                            | Shared implementation                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Start screen recent projects                                   | `maestro-cli native-history projects [--json]` | `agentSessions:projects`, `createNativeProjectDiscovery()`                                                             |
| Sidebar, start screen, menu, palette, Cmd/Ctrl+O: open project | `maestro-cli open-project <path> [--json]`     | `agentSessions:openProject`, `createProjectOpener()`, renderer `openProjectTarget()` and existing `createNewSession()` |

Both verbs require the running desktop bridge. Project discovery is read-only,
account-aware and bounded, with a 30-second in-memory cache. Its session counts
cover the files scanned within the budget, and activity is the transcript mtime.
Opening requires `newShell`; it focuses the existing local project owner, resolving
symlink aliases, or silently creates one using the first available provider.
Non-Git directories are supported. No installed provider means no creation.
The returned session ID is acknowledged after persistence, and opening never
sends a prompt. Cmd/Ctrl+O is scoped to opening in the new shell and to the existing
agent switcher in the classic shell, without overwriting saved shortcuts.
This opens a project, not a particular archived conversation; the native resume
and refresh gaps below remain separate.

## New shell terminal and tasks panels (hb.8)

| UI action                                   | CLI                                                                                                                   | Shared implementation                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Open Terminal or Tasks                      | `tab panel <conversation> terminal` / `tasks`; `open terminal-panel` / `open tasks-panel` for the active conversation | `newShellPanel`, `openUiSurface`, right panel                                                                       |
| Open an additional terminal                 | `open-terminal --agent <id> [--cwd <path>] [--background]`                                                            | `openPanelTerminal()`, `terminalTabHelpers`, `terminalSpawn`                                                        |
| Select a terminal in the directory dropdown | `tab panel <conversation> terminal-select --terminal <id>`                                                            | `selectPanelTerminal()`                                                                                             |
| Close a terminal                            | `tab panel <conversation> terminal-close [--terminal <id>]`                                                           | `tabStore.closeTerminalTab()`; GUI checks whether a command is busy, CLI explicitly closes the named terminal       |
| Restart an exited terminal                  | `tab panel <conversation> terminal-restart --terminal <id>`                                                           | `tabStore.restartTerminalTab()` resolves the real owner, checks its host and window, and retains the mounted output |
| Read or write terminal output               | `list terminals [--agent <id>]`, `read-terminal [--tab <id>]`, `send-terminal [--tab <id>]`                           | Existing terminal resolver, PTY and mounted `TerminalView` buffer                                                   |
| Collapse the panel                          | `tab panel <conversation> close`                                                                                      | Persisted `newShellPanel.open`                                                                                      |

Terminal and Tasks entries require `newShell`; classic tabs and bindings keep their
existing behavior. Cmd/Ctrl+J opens the directory terminal panel, and
Cmd/Ctrl+Shift+7 opens Tasks. Both have palette entries and right-panel buttons;
these are in-place panel switches, so they use the menu exception in UI-PATTERNS.
The panel width uses the existing persisted `rightPanelWidth`. Escape from panel
chrome or Tasks collapses the panel; while xterm owns input, Escape retains its
terminal meaning. The existing panel-collapse shortcut remains available there. While Terminal has
focus on macOS, Cmd+W closes its selected terminal and Cmd+F opens its existing search
bar. On Windows and Linux, focused xterm intentionally retains Ctrl+W, Ctrl+F and
Ctrl+J as shell input. The clear-terminal binding clears its buffer through TerminalView.

The default terminal is shared by normalized working directory and SSH remote ID
within one window, with worktrees kept separate. The owner must still use the
terminal's original host. `panelTerminals()` and the CLI terminal resolver share
this rule; `WindowContext.ownsSession` supplies ownership. An explicit additional
terminal always belongs to the current conversation's agent. `--cwd` determines
its pool, even when the owner's directory differs. Starting or restarting refuses
a changed host. The owner's panel shows how many terminals are still running on
the previous host and offers Close, with one busy confirmation for the batch.
Those terminals are excluded from selection, restart and input. From the owner's
conversation, `terminal-close --terminal <id>` explicitly closes them;
`terminal-select` and `terminal-restart` explain that only closing is available.
`list terminals` includes them, and `list terminals --agent` includes both the
agent's eligible directory pool and its own terminals still running on the previous
host, with their actual owner IDs and no active marker on the previous host.
Panel mutations use the existing window registry lookup to reach the agent's
window, falling back to the primary window when no owner is found. A terminal in
another window is rejected with an ownership error. Restart republishes the
retained xterm's current grid when its new PID arrives.

Closing clears references without changing the panel tab or open state. Automatic
opening happens once per visit, when the panel becomes visible or the conversation
changes. Ownership refresh may complete a pending opening but cannot reopen a
terminal closed during that visit. Failed ownership reads permit classic terminal
startup and show an error without starting a terminal in the new shell.
`tab show --json` returns `newShellPanel`, including the selected
terminal ID. Tasks are read-only, extracted from the latest top-level TodoWrite or
update_plan in the conversation; native-history reads expose the source tool data.

Codex plan verification (2026-11-06): enabling `newShell` via `settings set newShell true`
also opts desktop Codex conversation spawns into `tools.update_plan.enabled=true`.
`dispatch <agent> <message> --tab <conversation>` uses that same spawn path and
`buildAgentArgs()` as Send, including resume and SSH. Custom CLI config overrides
remain last. Opening Tasks still uses `tab panel <conversation> tasks`; this change
adds no UI action or CLI verb. `native-history read <agent> <native-id>` exposes the
same read-only transcript used by the panel. The default-skipped real diagnostic is
documented in [Codex plan verification](../verification/codex-plan.md).
The review fix uses the same StdoutHandler for Send and `dispatch`: plan updates
and completion snapshots preserve the pending final answer. No new UI action or
CLI verb is added. The default synthetic Electron case sends two messages via
`NativeApp.send` and opens Tasks via `tab panel`. The real diagnostic fills the
same composer and presses Enter once, preserving its plan prompt without the
generic real-workload suffix. `NativeApp.cli` appends `--json`, which `dispatch`
does not accept, so neither scenario submits messages through that wrapper.
The opt-in login diagnostic uses `--ephemeral` and does not test native-history
recovery. Product Send and CLI `dispatch` still share their existing implementation.

Open gap: there is no CLI result containing the normalized live Tasks panel list or
its empty-state text. `tab show` exposes the panel selection, and native history
exposes source tool calls; neither is a live panel snapshot. Standalone offline CLI
jobs do not inherit the new shell tool opt-in.

## New shell daily completion

| UI action                          | CLI                                         | Shared implementation                                                                      |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Compact context in either shell    | `tab compact <tab-id>`                      | `summarize_context`, owner window routing, `useSummarizeAndContinue()`                     |
| Open worktree cleanup confirmation | `open worktree-cleanup`                     | `getModalActions().setDeleteWorktreeSession()` and the existing cleanup modal and handlers |
| Pin or unpin an open conversation  | `tab star <tab-id>` / `tab unstar <tab-id>` | `tabStore.starTab()` and `persistTabStarred()`                                             |

Compaction resolves the named tab without selecting its agent. It defaults to
background placement; `--focus` selects the compacted conversation when ready.
The reply acknowledges acceptance, not model completion. Missing, busy, already
compacting and undersized targets are rejected. Completion and failure use the
existing notifications, and `session list --json` exposes the resulting tab.
The new conversation preserves optional execution overrides without replacing
absent fields with defaults, including the legacy read-only permission flag.
The composer command mode and native conversation identity are not copied.

Cleanup opens the current worktree agent's existing confirmation. To target a
specific owner, use `focus-agent <agent-id>` first. Opening does not remove files
or confirm deletion. The conversation menu passes its own worktree owner into
the same flow without changing selection; non-worktree conversations omit it.
Pinning accepts conversations without a native ID and preserves the current
selection. Open tab state takes precedence over a stale history star.

## Focus belongs to the human (`--background` / `--focus`)

An agent may create a surface. It may not decide the human should be looking at
it. Every verb that can move the Maestro view or raise a notice carries a
`background` bit so a caller that wants to stay out of the way has a way to say
so, and the bundled system prompt tells agents to pass it by DEFAULT.

`background: true` means exactly two things, everywhere: the active **agent**
does not change, and the active **tab** inside any agent does not change. The
surface is still created and still addressable - it lands in the tab bar the way
a browser opens a background tab. "Created but invisible" is a different bug and
must never pass as background placement.

### The flag is ADDITIVE. One verb's default changed.

The defect was that an agent which wanted to be polite had no way to ask. It was
**not** that the verbs focus. Every verb behaves exactly as it did before when
the flag is absent, so no existing script, playbook, Cue prompt, or
muscle-memory invocation changes - what changed is the guidance, which now says
to pass the flag rather than leaving each agent to guess.

That split matters: flipping the CLI defaults would silently rewrite behaviour
for every caller that has already shipped, including the web and mobile clients,
which send the same messages and legitimately DO want to focus. Flipping the
guidance changes only what new calls ask for.

The one exception is `refresh-auto-run`, whose CLI default is now background.
Its focusing default only switched agents when the target was NOT on screen, so
it fired exactly when the user was looking elsewhere: every Cue script or agent
turn that ended with an unflagged refresh yanked the user to that agent. The
flip is CLI-side (`CLI_BACKGROUND_DEFAULTS`), so a web client that omits the
field still gets the old behaviour, and `--focus` restores it from the CLI.

| Verb                                              | Message                                               | Default (unchanged)                     |
| ------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| `open-file`                                       | `open_file_tab`                                       | focuses                                 |
| `open-terminal`                                   | `open_terminal_tab`                                   | focuses                                 |
| `open-browser`                                    | `open_browser_tab`                                    | focuses                                 |
| `tab new`                                         | `new_tab` / `new_ai_tab_with_prompt`                  | focuses                                 |
| `dispatch --new-tab`                              | `new_ai_tab_with_prompt`                              | **background** (as it always was)       |
| `dispatch` (no `--new-tab`)                       | `send_command`                                        | selects the target agent                |
| `create-agent`                                    | `create_session`                                      | selects the new agent                   |
| `create-worktree`                                 | `create_worktree_session` + `send_command`            | selects the new agent                   |
| `switch-mode`                                     | `switch_mode`                                         | switches                                |
| `refresh-auto-run`                                | `refresh_auto_run_docs`                               | **background** (flipped; `--focus`)     |
| `refresh-files`                                   | `refresh_file_tree`                                   | **already quiet**; flag accepted, no-op |
| `focus-agent`, `send --tab`, `open`, `open-graph` | `select_session`, `open_modal`, `open_document_graph` | **always foreground, no flag**          |

`focus-agent`, `send --tab`, `open` and `open-graph` exist TO move the view - the
caller named that intent, and the graph is a full-window overlay whose only
effect IS being looked at, so a background one would do nothing. They are
deliberately absent from the table and must stay that way.

`--focus` ships on every verb even where it currently just names the default,
because a future default flip needs the escape hatch to already exist.

### Two verbs of one command name: `dispatch`

`dispatch --new-tab` is background by default and `dispatch` (writing to an
existing tab) is not. Both are correct - one creates a surface the caller will
address by id, the other writes into a conversation - and they are why the table
is keyed by **verb** rather than by message. `send_command` is also what
`create-worktree` uses to deliver its optional `--message`, and that call carries
the placement the CALLER resolved for `create-worktree` rather than re-resolving
as `dispatch`. Without that, `create-worktree --background --message "..."`
created the agent quietly and was then yanked onto it one message later, which
reads as the flag not working.

### `ask` is not `dispatch --background`

`--background` decides where the VIEW lands. It does not decide which
conversation the prompt joins. A backgrounded `dispatch` still writes into the
target's active tab, so a question sent that way lands in the middle of whatever
the user has open with that agent - quietly, which is worse, because they find it
later with no idea where it came from.

`maestro-cli ask` is the verb for a question. It routes to the cross-agent
consult path (`cross_agent_ask` -> `consultAgent` -> `runCrossAgentAsk` ->
`sendCrossAgentRequest`), the same one a typed `@mention` takes: a hidden tab on
the target, a fresh context, no focus, no unread, and the answer returned to the
caller. It carries no `--background` flag because there is no foreground form of
it - a consult that took over the screen would not be a consult.

The rule for a new agent-to-agent verb: if the caller wants an ANSWER, it rides
the consult path; if it wants the other agent to DO something, it rides dispatch
and the placement flags apply.

### Verbs that accept the flag and ignore it

`refresh-files` renders no notice and moves no selection: the Files panel it
refreshes is only drawn for the agent already on screen. It still accepts
`--background`, and `ALREADY_QUIET_VERBS` in `shared/focusPlacement.ts` is where
that is recorded.

This is not a placeholder. The guidance agents are given is "pass `--background`
unless the user asked to be taken there", and commander **rejects an unknown
option** - so one verb that refused the flag would turn a polite habit into a
failed command, and the rule would have to be taught as a lookup table instead of
a sentence. A verb belongs on that list only while it is genuinely quiet; the
moment one grows a notice or a selection change it moves into
`CLI_BACKGROUND_DEFAULTS` and the flag starts meaning something, with no change
to anything already calling it.

### Placement is not error suppression

A failed command still raises its toast with `background: true` set. The flag
says where a surface goes, not whether the user gets to hear that something
broke - `openTerminalTab`'s "Failed to start terminal" and `configureAutoRun`'s
"Worktree Error" toasts are deliberately ungated.

### The contract lives in one module

`src/shared/focusPlacement.ts`, imported by both ends:

- CLI: `resolveBackgroundFlag(flags, verb)` turns `--background` / `--focus`
  into the bit that goes on the wire. Keyed by **verb, not message**: `tab new
--prompt` and `dispatch --new-tab` both send `new_ai_tab_with_prompt` and
  disagree about the default, so keying by message would force one of them to
  change behaviour.
- Main process: `readBackgroundField(message)` reads it back, and it is an
  **opt-in** - only a literal `true` counts.

> [!WARNING]
> Never write `message.background !== false` in a handler. That reads an absent
> field as an opt-in and silently stops the verb from focusing, which breaks
> every existing caller at once. It is the single most likely way this change
> regresses, and it is why the read goes through one shared function.

### `--no-switch` is NOT a spelling of `--background`

They coexist on `open-file` and mean different things:

- `--no-switch` stays on the current agent and **still activates the tab there**.
  If you were already on that agent, your view still changes.
- `--background` changes nothing currently rendered, on any agent.

Passing both is fine; `--background` is strictly stronger and wins. Folding the
first into the second would silently change behaviour for everyone already
passing it. Worth knowing regardless: `--no-switch` reads like it means
`--background` and does not, so anyone who reached for it probably wanted the
stronger one.

### Renderer side

Background placement is the absence of a focus patch: the four `*FocusFields`
helpers in `src/renderer/utils/tabHelpers/focusFields.ts` are what make a tab visible, so
`createTab({ activate: false })`, `addTerminalTab(s, tab, { activate: false })`
and `handleOpenFileTab(file, { activate: false })` simply do not spread one.
`open_file_tab` is the one three-state path, because it has to serve both flags:

```
neither       -> switch agent, activate tab   (default)
--no-switch   -> stay on agent, activate tab
--background  -> touch nothing rendered anywhere
```

### Verifying

Use `Claude/Tools/focus_watch.py`, never your eyes: it logs every focus
transition, so an inert flag cannot pass as a fix. **Two runs per verb:**

1. **With `--background`**, against a _different_ agent than the focused one:
   the log stays empty, and the surface still exists (`tab show`,
   `session list`, `list terminals`).
2. **Without the flag**: the log records exactly the jump it recorded before.
   Since no default changed (except `refresh-auto-run`), an unflagged call
   that stops focusing is a regression - and it is the failure mode this design is most likely to
   produce.

## How to add a scriptable write

Persistent per-agent and per-tab state goes through **one** message:
`update_session_config`. It is the only write path that has all three of the
things a scriptable operation needs:

1. An **allowlist** in the renderer, so the CLI cannot write arbitrary `Session`
   internals.
2. A **response channel**, so the CLI learns whether the write landed instead of
   assuming it did.
3. A **`setMany` flush** before the ack, so a read taken immediately after the
   write sees the new value rather than racing the renderer's 2 second debounced
   persistence.

The handler lives in `useAppRemoteEventListeners.ts`
(`maestro:remoteUpdateSessionConfig`). It holds two allowlists: agent fields,
and - when the patch carries a `tabId` - AI tab fields. Adding a scriptable
field usually means one allowlist entry plus one CLI verb.

Do **not** reach for the older `mainWindow.webContents.send('remote:...')`
pattern (`star_tab`, `toggle_bookmark`, `reorder_tab`) for new state. Those are
fire-and-forget: they report success as soon as the message is handed to the
renderer, they do not confirm the renderer applied anything, and they do not
flush. They stay because the mobile web client speaks them.

Prefer **explicit set operations over toggles**. A toggle is unusable from a
script: re-running it flips back, and an agent driving the desktop has no
reliable way to observe the result mid-flight. `bookmark`/`unbookmark`,
`tab star`/`tab unstar`, and `tab read`/`tab unread` are all set verbs for this
reason.

Every write should have a matching read. A verb an agent cannot verify is a verb
an agent has to guess about.

A tab-targeted verb takes its tab id through `resolveTabEntry()`
(`src/cli/services/session-command.ts`), which accepts an exact id, a unique
prefix, or the literal `active` - the tab that agent has selected, with
`-a <agent-id>` naming whose. Use the helper rather than matching ids yourself:
it returns the whole `DesktopTabEntry`, so a verb that needs the current value
(`tab thinking cycle`) reads it from the same call that resolved the tab instead
of taking a second round trip or trusting a value the caller guessed.

The new-shell panel state is stored on the AI conversation as `newShellPanel`,
including its file reference, open state and file filter. `tab panel` uses the
existing acknowledged tab-config patch and waits for persistence. `edit`,
`preview`, `save`, `--content`, and `--line` address that remembered file without
changing the classic shell's active file tab. Text save delegates to the same
`saveFilePreview()` as the UI, including missing-file and untitled destination
prompts. Image annotation retains its existing CLI parity limitation; this batch
moves that existing editor into the panel and does not add an annotation command.
`tab new --provider` requires the new shell and shares local target discovery and
creation with the plus menu and empty-conversation picker. Existing CLI commands
for hidden upstream features remain available.

## Tool output on demand (2026-11-06)

集成权限补充：新界面的 `update-agent <id> --provider <provider> --force`
和项目设置都向 `switchSessionProvider()` 传入目标工具能力，逐标签调用
`newConversationPermissionFields()`。不支持标准权限时收紧为只读；任一标签
无法保留限制或能力查询失败时拒绝整次切换，CLI 返回失败原因。用
`tab show <tab-id> --json` 回读实际权限。旧界面的 CLI 重置和界面编辑行为不变。

New-shell expanded tool cards read one completed Claude or Codex tool result with
`maestro-cli native-history tool-output <session> <tool-call-id> [--json] [--copy]`.
`<session>` accepts a desktop tab ID, its unique prefix, `active`, or the exact
native ID from project history with one unambiguous owning account. `--copy` copies the returned text through the
same desktop `clipboard:writeText` handler used by the card.

Both surfaces call `agentSessions:toolOutput`, which resolves the owner's account
with `resolveAgentAccountDir()` and uses the provider's existing history lookup.
The reader runs in a bounded worker, uses `readCodexRollout()` for plain JSONL and
zstd, returns at most the last 2 MiB, and reports the number of omitted UTF-8 bytes.
Cards retain their provider, native session and account source. The tab list exposes
these compact sources so CLI reads can still address parked provider conversations.
When a newly opened tab has not reached persistence yet, an exact native ID resolves
through `agentSessions:listProjectHistory`. Ambiguous accounts are refused.
Codex exec item IDs stay scoped for display; a unique command, call time within five
seconds and bounded output preview map them to a native call on demand. Native refresh
fills that call ID without replacing the card. Claude searches only the parent's
`subagents` directory, at most 128 entries and 100 MiB across the parent and children.
No result is written to session state or native files. Missing records, read limits
and unavailable readers are explicit results. The CLI requires the running desktop.

With `newShell` enabled, `update-agent <id> --provider <provider> --force`
shares `switchSessionProvider()` with Edit Agent. It parks each tab's native
identity through `switchTabProvider()` and retains transcripts, tool sources,
drafts, file tabs and running turns. Provider overrides are cleared for the next
turn. The classic CLI keeps its existing reset behavior. The tool-output Electron
scenario verifies the old Claude answer remains after the Codex continuation,
then reads the old result through both the card and `native-history tool-output`.

## Covered

Notification center history uses the live desktop `notificationStore` over a request-response bridge. Main owns durable append/read/clear mutations in `maestro-notification-history.json`; renderer snapshots are synchronized across windows, and CLI results await committed writes. `notify inbox list --unread` filters the snapshot, `read <id>` / `read-all` update read state, `clear` clears history, `dismiss [id]` dismisses one entry or clears visible toasts, and `activate <id>` / `link <id>` run the same entry and inline-link actions as the UI. Every result includes the resulting unread count and history. `detail <id>` / `collapse` expand and collapse the same in-inbox details view. The five opt-in inbox preferences are registered settings and can be changed with `settings set <key> <value>`. `open notification-center` and `notify inbox open` open the app-level popover even when the Main Panel header is absent.

| Point-and-click action                                                      | CLI                                                                                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Switch to the new shell (Settings, Display, New Shell)                      | `settings set newShell true` / `settings get newShell`                                                           |
| Choose a tool from the new-shell plus menu / replace an empty conversation  | `tab new --agent <id> --provider <claude-code\|codex\|deepseek> [--replace-empty <tab>]`; prepares only, no send |
| Open / close the conversation panel, select Changes / Files, return to tree | `tab panel <tab> <open\|close\|changes\|files\|back>`; inspect `tab show <tab> --json`                           |
| Filter files in the conversation panel                                      | `tab panel <tab> files --filter <query>`; empty string clears it                                                 |
| Open a tree, conversation-link or changed file in the right preview         | `open-file <path> --agent <id>`; then `tab panel <tab> files --line <number>` for a line target                  |
| Refresh files / show hidden files                                           | `refresh-files --agent <id>` / `settings set showHiddenFiles true`                                               |
| Edit / preview / save the right panel text buffer                           | `tab panel <tab> edit [--content <text>]`, `preview`, `save`; save uses the same FilePreview save function       |
| Ask another provider to review the current conversation changes             | `handoff <tab> <provider> --review [--send] [--json]`; read origin: `tab show <tab> --json`                      |
| Read conversation changes and a file diff                                   | `changes [--agent <id>] [--tab <id>] [--file <path>] [--json]`                                                   |
| Open / close notification center                                            | `open notification-center`, `notify inbox open` / `close`                                                        |
| Read / clear / activate notification history                                | `notify inbox list`, `read`, `read-all`, `clear`, `activate`, `link`                                             |
| Dismiss one / all visible notifications                                     | `notify inbox dismiss [id]`                                                                                      |
| Expand / collapse full inbox details                                        | `notify inbox detail <id>` / `collapse`                                                                          |
| Bookmark / unbookmark an agent (Cmd+Shift+B)                                | `bookmark` / `unbookmark`, or `update-agent --bookmark`                                                          |
| Create / rename / remove an agent                                           | `create-agent`, `rename-agent`, `remove-agent`                                                                   |
| Edit Agent modal fields                                                     | `update-agent`, `settings agent set`                                                                             |
| Switch an agent's provider                                                  | `update-agent --provider --force`                                                                                |
| Move an agent to a group                                                    | `update-agent --group`                                                                                           |
| Change working directory                                                    | `update-agent --cwd`                                                                                             |
| SSH remote execution config                                                 | `update-agent --ssh-remote / --ssh-cwd`, `create-ssh-remote`                                                     |
| Edit an SSH remote, incl. its `ssh -o` list                                 | `update-ssh-remote --ssh-option / --clear-ssh-options`                                                           |
| Focus an agent, switch AI/Shell mode                                        | `focus-agent`, `switch-mode`                                                                                     |
| Create / rename / remove a group                                            | `create-group`, `rename-group`, `remove-group`                                                                   |
| Group icon, color, and nesting                                              | `create-group --icon/--color/--parent`, `update-group`                                                           |
| Move an agent or a whole group to another window                            | `window move-agent`, `window move-group` (`--to new\|main\|<n>`); read: `window list`                            |
| Create a worktree agent                                                     | `create-worktree`                                                                                                |
| Select a conversation directly from a project in the sidebar                | `focus-agent <agent-id> --tab <tab-id>`; read: `session list --json`                                             |
| Switch between conversations and agent management in the sidebar            | `settings get/set sidebarNavigationMode` (`conversations` / `agents`)                                            |
| Collapse an automatic project section                                       | `settings get/set collapsedConversationProjects`                                                                 |
| New / close / rename a tab                                                  | `tab new`, `tab close`, `tab rename`                                                                             |
| Star a tab (Cmd+Shift+S)                                                    | `tab star` / `tab unstar`                                                                                        |
| Mark a tab unread                                                           | `tab unread` / `tab read`                                                                                        |
| Toggle Save to History                                                      | `tab save-to-history`                                                                                            |
| Composer chips: thinking, read-only access                                  | `tab thinking` (off/on/sticky/cycle), `tab read-only`                                                            |
| Model / effort pills on one tab                                             | `tab model`, `tab effort` (`inherit` clears the override)                                                        |
| Enter-to-send chip                                                          | `tab enter-to-send`                                                                                              |
| Read one tab's settings back                                                | `tab show`, or `session list --json`                                                                             |
| Move Tab to First / Last                                                    | `tab move <tab-id> first\|last\|<index>`                                                                         |
| Send a message, or run a shell command                                      | `send`, `dispatch`, `send-terminal`                                                                              |
| Consult another agent (`@mention`)                                          | `ask <agent> "<question>" --from <caller>`                                                                       |
| Continue with another AI (tab menu, palette, limit or login error)          | `handoff <source-tab> <provider>` (draft only); choices: `handoff <source-tab> --list-targets`                   |
| About Me: save, check native files, write approved files                    | `about-me set`, `about-me status`, `about-me apply --confirm <real file>`                                        |
| Open a file / URL / terminal tab                                            | `open-file`, `open-browser`, `open-terminal`                                                                     |
| Open a modal or dashboard                                                   | `open <surface> [--tab]` (registry in `src/shared/uiSurfaces.ts`)                                                |
| Auto Run: start, stop, resume, skip, abort                                  | `auto-run`, `stop-auto-run`, `resume-auto-run`, ...                                                              |
| Application language (system / English / Simplified Chinese)                | `settings get uiLanguage`, `settings set uiLanguage zh-CN`, `settings reset uiLanguage`                          |
| Follow system light and dark mode (Clay pair)                               | `settings get followSystemAppearance`, `settings set followSystemAppearance false`                               |
| Settings, theme, Encore features                                            | `settings`, `theme`, `set-theme`, `encore`                                                                       |
| Toasts and center flashes                                                   | `notify toast`, `notify flash`                                                                                   |
| Save a pasted chat image (right-click)                                      | `image save` (`image list` to find it)                                                                           |
| Cue subscriptions and scheduled tasks                                       | `cue trigger`, `cue schedule`, `cue pipeline`                                                                    |
| Cue Model / Effort (graph node, Scheduled Tasks)                            | `cue model`, `cue schedule --tier --model --effort`; read: `cue model`, `cue list`                               |
| Snooze a tab, list / wake / dismiss what is parked                          | `snooze tab`, `snooze list`, `unsnooze`, `snooze dismiss`, `snooze reschedule`, `snooze history`                 |
| Send Feedback modal (open / file / +1)                                      | `open feedback`, `feedback auth\|search\|submit\|subscribe`                                                      |
| Feedback: screenshots, support package box                                  | `feedback submit --attach <png...> --support-package`                                                            |
| Feedback: Running as (account picker)                                       | `feedback accounts [--use <key> \| --clear]`                                                                     |
| Feedback: Log in to GitHub / Check Again                                    | `feedback login`, `feedback auth --fresh`                                                                        |
| Feedback: live self-diagnosis                                               | `feedback diagnose`                                                                                              |
| Feedback: Submit now (early exit)                                           | `feedback submit` (the caller supplies whatever fields it has)                                                   |
| Create Debug Package (support package)                                      | `support-package -o <dir> [--no-logs ...]`                                                                       |
| Start / End Performance Profiling                                           | `profiling start`, `profiling status`, `profiling stop -o <zip>`                                                 |
| Cue dashboard: subscription on/off switch                                   | `cue enable <sub>`, `cue disable <sub>` (any event type)                                                         |
| Cue dashboard: activity log                                                 | `cue activity [-a <agent>] [-n <limit>]`                                                                         |
| Auto Run panel: progress                                                    | `auto-run-status -a <agent>`                                                                                     |
| Auto Run: save as a playbook (documents must sit in the Auto Run folder)    | `auto-run --save-as <name> <docs...>` (read back with `playbook <id> --dry-run`)                                 |
| Auto Run panel: Change folder                                               | `auto-run-folder <path> -a <agent>`                                                                              |
| Thought Stream: Steer Auto Run (send a note, cancel one, read replies)      | `steer-auto-run send <note> -a <agent>`, `steer-auto-run list`, `steer-auto-run cancel <id>`                     |
| Playbook Exchange: browse, README, install                                  | `marketplace list`, `marketplace show <id>`, `marketplace import`                                                |

## New shell single file changes (2026-11-06)

| UI action                     | CLI                                                   | Shared implementation                                     |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| Stage a changed file          | `changes stage <path>... [--agent <id>] [--tab <id>]` | `git:applyChange` calls `applyGitChange()`                |
| Unstage a file                | `changes unstage <path>...`                           | The same request with `action: 'unstage'`                 |
| Confirm reverting a file      | `changes revert <path>... --yes`                      | The same request with `action: 'revert', confirmed: true` |
| Commit the staged files       | `changes commit --message <text>`                     | The same request with `action: 'commit'`                  |
| Refresh or inspect the result | `changes [--file <path>] [--json]`                    | Existing `git:changes` and `git:changeDiff` handlers      |

Every write also accepts `--agent`, `--tab` and `--json`. Paths are exact names
relative to the repository root, not globs or directories. Put options before
`--` when a name begins with a hyphen, for example
`changes stage --tab <id> -- -new.txt`. `changes --json` exposes `staged`, an
optional `unstaged` flag for partially staged files, and `stagedCount` when the
500-file display limit hides rows. The count covers the whole index.

The panel uses the current conversation cwd, never a terminal's later cwd;
SSH honors the configured host and working directory override. Main resolves
the root through Git on that host and serializes writes per host and worktree.
Staging an indexed rename adds only its destination, including later edits and
multi-file requests. Unstage and revert include both rename paths. Copies leave
the source alone, unstaging preserves worktree contents, and revert restores
both index and worktree against HEAD. A staged deletion with an untracked file
at the same path stays one staged row with `unstaged: true`; group and commit
counts include the deletion once. Unstage preserves the replacement on disk;
revert restores the original HEAD file after confirmation.
New files are deleted only after confirmation. Conflict rows offer stage to
mark a resolved file, and never offer revert. Nested repositories and submodule
revert are refused. A partially staged row stays in the staged group with an
additional indicator; committing includes only the index contents. Git and
hook failures return their original diagnostics, with no automatic retry.
The UI controls are gated by `newShell`; the CLI verbs are explicit opt-in
operations in either shell. No new parity gap is introduced by these actions.

## New shell conversation archive and native deletion (2026-11-06)

| 界面动作                     | CLI                                                                  | 共用实现                                                             |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 对话右键或命令面板归档       | `tab archive <tab-id>`；`native-history archive <agent> <native-id>` | `agentSessions:archiveConversation` 与 `createConversationArchive()` |
| 项目底部展开已归档列表       | `native-history list --archived`；限定项目时加 `<agent>`             | 主进程归档元数据与 `listProjectHistory` 的归档过滤                   |
| 取消归档                     | `native-history unarchive <agent> <native-id>`                       | 同一归档服务，取消标记并保留权限元数据                               |
| Codex 对话右键或命令面板删除 | `native-history delete <agent> <native-id> --yes`                    | 新界面复用同一服务，再调用原有 `CodexSessionStorage.deleteSession()` |

归档写入 Maestro 设置的 `archivedConversations`，以工具、主机、规范账户历史目录和原生 ID 为身份。主进程检查仍在运行的进程，并向每个所属窗口请求实时检查及标签关闭。忙碌、排队或窗口无法确认时拒绝；关闭采用原标签实现，不调用模型、不写原生历史。项目扫描、缓存条目和打开标签的投影都排除归档项。工作树归档仍显示在所属项目下。

取消归档仅将记录的 `archived` 设为 `false`，保留权限、原活动时间及项目归属；旧记录未带该字段时仍视为已归档。默认归档接口和 `native-history list --archived` 只返回已归档项，渲染层以 `includeUnarchived` 读取完整权限库存。浏览器和桌面均初始读取并订阅同一事件，只有桌面处理标签关闭。`projectHistoryScopeFor()` 统一目录边界、最具体项目、工作树和主机归属，子目录归档也有恢复入口。

T9 第三轮仅修正验收入口，没有新增 CLI 动作。`tab new` 确认渲染层创建完成时，`tab show` 读取的主进程持久化库存可能尚未更新；验收先确认页面中的同一标签，再等待该 ID 可读，仍同时断言 `permissionMode: readonly` 和 `readOnly: true`。`test:e2e` 现在同时构建 `web-desktop`，网页归档场景用无 preload 的 Electron `BrowserWindow` 检查 HTTP 200、网页运行环境、刷新和双向同步，不需要单独安装 Chromium。

权限继承排除归档项的最近活动；没有普通对话时使用归档中最严格的已知档位。没有 Maestro 权限记录的原生历史保守记为只读。空项目不会在重启时被当作损坏数据补出高权限对话。新界面关闭时不启用归档过滤或新增菜单；归档写操作要求 `newShell`。既有 CLI 删除增加 `--yes` 确认，这是两种界面共用的安全收紧。Claude 不提供原生删除。

## Open gaps

- T9：自动发现但尚无匹配工具及账户配置的历史，可在界面直接归档或取消归档。CLI 的修改命令使用 `<agent>` 指定账户，需要先有匹配的配置；暂未提供直接按账户目录修改的参数。全局 `native-history list --archived` 仍可读取这些条目。
- T9：运行状态拒绝覆盖 Maestro 管理的进程、窗口标签和队列。尚未接入其他应用或独立原生 CLI 的活动探测，不声称能识别这些外部进程是否正在写同一历史。
- T9：跨窗口先全部检查，再逐个关闭。若后一个窗口在关闭时失败，归档标记回退，但已关闭窗口的标签不自动恢复；尚未提供跨窗口事务式回滚。

**Provider switch wording (2026-11-06).** The existing CLI help, force warning and
success text still describe the classic reset behavior. With `newShell` enabled,
the operation preserves conversations as documented above. This round changes
the transition and its tests, not the CLI text or localization infrastructure.

**On-demand tool output (2026-11-06).** SSH is unavailable because existing remote
readers transfer the transcript before selecting a result. The card hides this
action and the API refuses remote requests instead of reading local files. The
view-local full-output hide button has no CLI fold-state verb; CLI reading and
copying are covered, but do not expand or collapse a desktop card. Older cached
Claude cards without a call ID need a native refresh. Cards from a previously mixed
provider history without saved source identity are not offered a guessed target.
Codex exec lookup refuses ambiguous evidence, missing commands, unsupported command
wrappers or native call times more than five seconds from the live start event.
Legacy filename lookup inspects at most 64 KiB of metadata;
nonstandard records with later identity metadata may not be found.

**Project native history (2026-10-16).** The desktop bridge exposes `agentSessions:listProjectHistory`, but CLI `sessions <agent-id>` is still provider scoped. One-click native-history open with automatic runner creation uses the canonical renderer resume flow and has no dedicated CLI verb yet. Adding a WS renderer action is outside this local sidebar acceptance change; this is an explicit parity gap, not a covered action. The same gap covers the external-transcript catch-up: selecting an open native conversation in the project tree (or returning to the window while it is on screen and a history scan reports newer native activity) re-reads the transcript and appends what was written outside Maestro (`refreshNativeConversation()` in `src/renderer/services/refreshNativeConversation.ts`, read-only, same tab/account/host/native id). No CLI verb triggers or reports that refresh yet; the read half is reachable through `sessions`/`agentSessions:read`, but nothing lets an agent fold newer native messages into an open tab. Since 2026-10-23 the desktop also runs the same refresh automatically for the visible local Codex tab when its transcript revision changes (`useNativeTranscriptFollow()` in `src/renderer/hooks/session/useNativeTranscriptFollow.ts`, over `agentSessions.getTranscriptRevision`). That is background upkeep, not a user action, so it adds no row and changes no CLI verb.

**Conversation tool detail folds (2026-10-19).** The conversation layout groups tool calls into expandable runs and each call can reveal its stored input/result. These view-local fold states have no CLI address or verb yet. Native transcript reads expose the underlying tool data, but do not expand the desktop card. This is an explicit presentation parity gap in the local conversation UX repair, alongside the native-history refresh gap above; no claim is made that the new fold controls are CLI-covered.

**Conversation feed message info (2026-10-21).** In the conversation layout each message has an info toggle that opens an inline panel (time, turn duration, model, effort, Claude capture mode, delivered / read-only / forced-parallel state, cross-agent source). Opening that panel is view-local presentation state with no CLI address or verb, like the tool detail folds above. Reading the data is a separate question with two halves:

- **Native transcripts:** reads through `sessions` / `agentSessions:read` return the provider's own messages and timestamps.
- **Maestro-side stamps:** the panel's model and effort come from the tab log's `turnModel` / `turnEffort`, and the send states from `delivered` / `readOnly` / `forceParallel`. No CLI or web-bridge path prints these yet; the existing `session read` backlog item would cover them.

This presentation-only phase adds no CLI verb or session protocol. Neither half is claimed as CLI-covered.

Ranked by how often an agent is likely to hit them. None of these are blocked by
a design constraint; they are simply not built yet.

1. **Interrupt a running turn.** Escape stops a busy agent in the UI. There is
   no CLI equivalent and no WS message behind one. This is the largest remaining
   gap: an agent that starts a runaway turn on another agent cannot stop it.
   The 2026-11-06 Stop/synopsis correction preserves this gap; the legacy remote
   interrupt callback is not the desktop interrupt implementation.
2. **Reopen a closed tab.** `closedTabHistory` and `unifiedClosedTabHistory` are
   runtime-only and never persisted, so the CLI cannot see the stack to restore
   from it. Closing this means persisting that history first.
3. **Duplicate an agent.** The context menu's "Duplicate..." opens a modal with
   options (what to copy). `create-agent` can approximate it, but there is no
   one-shot duplicate.
4. **Toggle Live mode** (`isLive`) for the web interface.
5. **Collapse / expand a group**, and reorder agents in the Left Bar. Pure
   presentation; low value for automation, which is why they are last.
6. **Git actions** (View Git Log / Diff, Pull, Push, Change Branch, Create PR).
   Deliberately not mirrored: these open modals over `useGitAgentActions`, and an
   agent already has `git` and `gh` in its shell, which is strictly more capable.
   Only the modal-opening is unavailable, not the capability.
7. **Wizard and interactive pickers** (New Agent Wizard, Fuzzy File Search,
   Tab Switcher, Search: Messages). These are interactive by definition; the
   underlying data is reachable through `list`, `session show`, and
   `director-notes history`.
8. **Auto Run state in a CLI-built support package.** The desktop's Create
   Debug Package hands main a snapshot of the renderer's in-memory batch store
   (`captureAutoRunSnapshots()`). `support-package` and
   `feedback submit --support-package` are built in main with no renderer round
   trip, so that section reads "unavailable". The Feedback modal's own support
   package checkbox has the same gap today. Closing it needs a main-to-renderer
   request with a response channel.
9. **Context: Merge Into, Send to Agent.** The HB `handoff` command
   now provides the new three-provider handoff through its own shared service
   (`ai_handoff`, `context.handoff`): draft by default, same-project runner reuse,
   explicit `--send`. The UI entries (tab menu, palette, error modal, the
   transcript's limit and login errors, a live outage card) call the same
   `context.handoff` without `send`; the note above a draft's composer is view
   state with no verb.
   Compaction now has `tab compact` and a renderer subscriber to the shared
   hook, as recorded above. The generic merge/transfer paths remain gaps:
   `merge_context` and `transfer_context` have preload listeners but no
   renderer subscribers. They still need the shared hooks wired and CLI verbs.
10. **Interrupt, precisely.** Beyond "no CLI verb": the only backend (REST
    `POST /api/session/:id/interrupt` -> `remote:interrupt`) signals the
    legacy `${sessionId}-ai` process id, which misses per-tab processes
    (`${sessionId}-ai-${tabId}`). Fix the renderer handler to take a tab id,
    then add `interrupt <agent> [--tab]`.
11. **Expand a diagram or image to the pan/zoom viewer.** The viewer opens on
    an element already rendered in a transcript or document
    (`openZoomViewer(element)`), and a transcript element has no address the
    CLI can name. The capability is still reachable: `open-file <image>` opens
    the file preview's `ImageViewer`, which shares the same `usePanZoom`, and
    an agent can write a diagram to a `.mmd` file and `open-file` it. Pure
    viewing; there is no result for an agent to read back.
12. **Drag-resized pane sizes kept in renderer localStorage** (the Auto Run
    document dropdown's height via `useResizableDropdownHeight`, the Document
    Graph preview width via `usePersistedPanelWidth`). Pure view preferences
    with nothing for an agent to act on; the values never reach main, so a
    verb needs a renderer round trip. Double-click on the grip resets them.
13. **Log in to a provider account** (Usage Dashboard quota row "Log in",
    palette "Reauthenticate Provider"). The login is an interactive OAuth or
    device-code flow in a PTY, so there is nothing a non-interactive verb could
    complete. The capability is reachable from an agent's shell as
    `CODEX_HOME=<dir> codex login` / `CLAUDE_CONFIG_DIR=<dir> claude` then
    `/login`. There is no CLI read of the quota snapshots yet, so verifying the
    login from the CLI is part of this gap.

### Audit backlog (2026-09-27)

A full sweep of the palette, shortcuts, context menus, and modals found these
still missing. Grouped, highest value first:

- **Execution queue:** list, remove, edit, reorder, hold, force-send (`queue ...`).
- **Composer:** send images with a prompt (`dispatch --image`); fork a tab from a
  message (`tab fork --at`); resume a stored provider session into a tab
  (`tab new --resume`), read a stored transcript (`session read`).
- **Tabs of every kind:** `tab close/rename/move` resolve AI tabs only; no
  listing of file/terminal/browser tabs; bulk close (others/left/right);
  terminal close, restart, startup command; `read-browser` page text;
  `open-browser` refuses `file://`.
- **Playbooks:** update an existing one, export/import `.maestro-playbook.zip`.
- **Group chat:** delete, rename, archive, edit moderator/participants, export.
- **History:** delete an entry, toggle validated, generate a synopsis now, search.
- **Diagnostics:** Process Monitor kill (`process list/kill`), read/clear system
  logs (`logs`), reset stuck busy state, restart agent, retry, re-auth.
- **SSH remotes:** test, edit, enable/disable, set default.
- **Prompts:** edit or reset a Maestro prompt (`prompts set/reset`).
- **Web access:** dashboard URL, QR pairing, persistent token, tunnel.
- **Updates:** check/download/install.
- **Exports:** tab as HTML, Usage Dashboard CSV, plan usage.
- **Media player:** play/pause/next/prev/seek/volume, queue management.
- **Cue:** engine start/stop, stop a run, backups, global settings, rename pipeline.
- **Agents/groups:** worktree folder + scan, group emoji, `remove-agent --erase`.
- **Symphony** contributions; **low value:** devtools, tour, leaderboard,
  `notify clear`, clear terminal, `gist --file`, deep link, reveal in Finder.

## Native history coverage (2026-11-03)

`maestro-cli native-history list <agent>` returns the project sidebar's native conversation records through `agentSessions:listProjectHistory`. `read <agent> <conversation>` uses the canonical read-only transcript adapter. `delete <agent> <conversation>` removes a whole Codex conversation in the selected local or SSH account. Partial native-message deletion returns a read-only error. These verbs require the desktop app. Pianola's offline learning scan uses the bounded shared Codex rollout decoder.

Packaged CLI storage and discovery use the shipped product identity. `settings set` uses the live `settings:set` IPC handler when the desktop is running and waits for its acknowledgement. Offline writes keep the same value validation and product-directory checks.
