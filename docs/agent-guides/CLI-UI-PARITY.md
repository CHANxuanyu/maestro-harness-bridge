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

## Claude standard approval, U4 (2026-11-07)

| UI action                                 | CLI                                      | Shared implementation                                                |
| ----------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Read the pending tool and full input      | `permission list [--json]`               | `permission:list`, `listPermissionRequests()`; excludes relay tokens |
| Allow the displayed tool once             | `permission allow <request-id> [--json]` | `permission:respond`, `resolvePermissionResponse()`                  |
| Deny the displayed tool, including Escape | `permission deny <request-id> [--json]`  | Same response handler with a deny decision                           |
| Set the conversation permission           | Existing `tab permission <tab> standard` | Existing permission field update and desktop spawn path              |

Commands require the running desktop. IDs are exact: a settled request returns
failure rather than answering a later request. JSON list returns an array;
allow and deny return `true`, and failures use `{ success: false, error }` with
exit code 1. The renderer waits for acknowledgement and removes requests settled
by CLI, timeout, process exit or bridge disconnect. A failed delivery remains
visible for a deliberate retry. No persistent allow rule is written.

New shell Claude standard is available only with the effective `api` token
source (`claude -p`) on a local Claude executable. TUI Wrapper and Dynamic show
a disabled Standard row with an explanation. Existing incompatible standard
turns are refused before spawn, without changing the chosen source or starting
maestro-p. New, inherited, restored and handoff conversations tighten unsupported
standard to readonly through `newConversationPermissionFields()` and
`effectiveStandardPermissionCapability()`.

`tab permission <tab> standard`, `dispatch`, and `dispatch --queue` use the same
capability gate and localized refusal. `update-agent <owner> --token-source
api|tui|dynamic` remains the explicit token source action; `tui` is the CLI name
for stored `interactive`. The new shell has no per-conversation token source UI
entry; classic Edit Agent exposes it in the shared AgentConfigPanel. The owner
setting applies to its conversations, so this task adds no new UI action or verb.
SSH and conflicting permission arguments still refuse before spawn.

U4 第四轮补齐普通派发的返回链路：`send_command` 经过
`registerCommandCallbacks()`、`CallbackRegistry` 和 `handleSendCommand()`，
保留渲染层拒绝回执的原文，再由 CLI `dispatch` 返回失败及非零退出码。
布尔回调仍受支持；带原因的失败不能被当作真值成功。失败不记录派发关系，
已预登记的完成通知回调会取消。`dispatch --queue` 原有拒绝链路保持不变，
空闲和忙碌目标都在派发或入队前校验同一权限能力。
没有新增界面动作或 CLI 动词，没有新增 Open gaps。
共享回执修正也让旧界面下已经被拒绝的 CLI 派发如实失败，不改变旧界面的权限策略。

旧界面 TUI 下选标准仍会跳过确认，这是既有问题，这次没改。共享审批列表的
归属过滤同时修复旧界面和 CLI 的信息泄露，审批响应及生命周期模型保持合并后的规则。
Synthetic Electron coverage is in `e2e/native-claude-permission.spec.ts`; execution
instructions are in `e2e/claude-standard-approval.md`.

The U4 review fixes add no action or verb. `permission list` carries the same
effective spawn `cwd` and `tabId` as the prompt. The relay derives a missing
tab ID from the compound process ID with `REGEX_AI_TAB_ID`, including forced
parallel suffixes; an explicit tab ID wins. The new shell prompt also uses
`parseSessionId()` for older events and never substitutes the saved project
directory for an absent execution directory. Worktree direct and queued sends
are covered by two additional synthetic Electron scenarios, pending execution.
Windows installer `maestro-p.cmd` entries now use the shared TUI detector, so
new shell standard mode rejects them before spawn. This detector correction
also applies to classic mode and CLI resolution; the classic permission policy
and TUI bypass behavior are otherwise unchanged.

## 项目设置，U2，2026-11-07

| 界面动作                         | CLI                                                                                                    | 共用实现                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 项目行右键打开设置，切换项目位置 | `project settings show --path <path> [--ssh-remote <id>]`                                              | `settings:projectSettings`、`createProjectSettingsService()`              |
| 保存默认工具、模型、强度、权限   | `project settings set --path <path> --provider <id> --model <id> --effort <level> --permission <mode>` | 同一 IPC 服务验证并写 Maestro 设置                                        |
| 清空某项默认值                   | 对应选项传 `inherit`                                                                                   | 同一服务删除对应覆盖值                                                    |
| 首次选择完全访问                 | `--permission full --acknowledge-full-access`                                                          | 每个项目与主机单独记录一次说明确认                                        |
| 编辑或删除项目环境变量           | 重复 `--env NAME=VALUE` 替换项目变量；`--clear-env` 清空覆盖                                           | 同一服务保存；既有环境编辑器用于界面输入                                  |
| 查看遮盖或明文变量               | `show` 默认遮盖，`--show-secrets` 显示原值                                                             | `isSecretEnvKey()`、`maskEnvValue()`                                      |
| 按项目默认设置新建对话           | `tab new --agent <id> [--prompt <text>]`、`dispatch <id> <prompt> --new-tab`                           | `newProjectConversation()`、`context:conversation`、`openHandoffTarget()` |
| 明确选择新对话工具               | `tab new --agent <id> --provider <provider>`                                                           | 同一 `context:conversation` 服务，SSH 传递原主机和执行目录                |

模型和强度所属工具通过 `--model-provider <id>` 单独保存，默认工具选择“沿用”时也必须确定归属；显式 `--provider` 可以提供归属。界面保存当前模型控件对应的工具。旧数据有默认工具时继续兼容；没有任何工具归属的旧模型需重新保存后应用，不推断它适用于所有工具。

通用 `settings set projectSettings` 及其点路径一律拒绝，提示改用 `project settings set`；IPC 的 `settings:set` 同样拒绝。`settings:getAll`、`settings:get` 和 CLI `settings get projectSettings` 只返回无环境值的投影；通用点路径读取不能获取变量原值，应使用 `project settings show`。桌面设置窗口读取专用服务，CLI 通过启动时密钥验证的连接访问同一服务，默认遮盖，`--show-secrets` 显示原值。普通浏览器的专用服务响应也移除环境值，保存其他字段不会清空环境；环境编辑需在桌面或 CLI 完成。

`project settings` 需要运行中的 Maestro。它只保存 Maestro 数据，不读写原生配置。
设置可以由 CLI 预先保存，只有 `newShell` 开启后的新对话采用。已有对话和原生历史导入不重新套用。
当前对话的显式模型、强度和环境优先于项目，项目优先于既有工具默认配置；权限使用两者中更严格的值，继续按目标能力校验。
项目入口选择项目默认工具，从当前对话新建保留当前工具。未指定工具时由主进程依据 `effectiveAgentCustomEnvVars()` 解析实际工具身份，提供方默认环境中的 DeepSeek 与前端入口采用同一结果。明确选工具的入口采用该工具的模型与强度，不复制另一家的模型名。切换项目默认工具时，共享设置服务清除上一工具的模型与强度，除非同次提交明确提供新值。
环境变化通过独立的内部配置承载，保留旧对话的账户、SSH、停用变量和原生身份；记录原始环境以便清空项目覆盖后恢复。
CLI `tab new` 返回实际 `sessionId`，`dispatch --new-tab` 返回实际 `agentId`，保留其既有 `sessionId` 等于 `tabId` 的约定。带提示的新建由目标所属窗口持久化后排队，来源窗口不会向自己的会话重复投递。

本轮共用修正：带提示的新建回调按来源所属窗口路由，旧界面也由此修正副窗口投递目标；新界面新建回调允许 60 秒，CLI 留出 65 秒等待；旧界面回调仍为 5 秒。其余新行为均受 `newShell` 控制。

## New shell conversation split (2026-11-06)

| UI action                              | CLI                                                   | Shared implementation                                               |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Open a conversation on the right       | `tab split <tab-id> [--agent <id>] [--json]`          | `splitConversation()` in `src/renderer/services/newShellSplit.ts`   |
| Drag the divider                       | `tab split <right-tab-id> --ratio <fraction>`         | The same split service persists the left pane share                 |
| Return to the focused conversation     | `tab unsplit [--agent <id>] [--json]`                 | `unsplitConversation()` in the same service                         |
| Select the other pane                  | `focus-agent <agent-id> --tab <tab-id>`               | Existing conversation selection and focused conversation state      |
| Close one pane while keeping the other | Select the surviving conversation, then `tab unsplit` | The same focus and unsplit actions; neither conversation is deleted |

The row context menu, keyboard bindings and command palette call these services.
The CLI resolves exact or unique-prefix conversation IDs through the existing
desktop tab list. `unsplit` addresses the active conversation unless `--agent`
selects a particular owner. Both commands require the new shell and a running
desktop application. The renderer validates the split action separately from
ordinary tab configuration; split fields are never stored on an AI tab and
cannot be combined with permission or model changes. The acknowledged
`update_session_config` transport waits for the shared service to save the
layout before reporting success. Service errors, including a narrow window,
are returned to the CLI.

`NewShellSplitContent` reuses `MainPanelContent`, `InputArea` and the pointer
capture divider exported by `TiledLayout`. `tileNewTab()` creates new tabs inside
one owner, so it cannot represent these two existing conversations across owners.
The split keeps references rather than cloning conversations or inheriting new
permissions. Background pane drafts, scroll positions and models stay keyed to
that pane; only the focused pane claims App's input and transcript refs.

The default shortcut opens the same palette picker: `Alt+Cmd+\` on macOS,
`Ctrl+Alt+\` elsewhere. Arrow keys on the divider resize through the same service
as dragging and `--ratio`. Resizing an existing pair keeps focus. A window below
1180 pixels or a center below 720 pixels shows one conversation and an explanation,
retaining the saved pair. Selecting a third conversation shows it alone; a new
split from there uses that conversation as its left pane. The saved references and
ratio load through `readNewShellSplit()`; malformed values are discarded.

The 2026-11-07 review correction binds each pane's Stop and Escape to its session
and tab. New shell single-pane Stop has the same conversation scope. Classic
Stop keeps its whole-agent scope. A stopped process exit only dequeues that
conversation's work. Closed busy orphan tabs remain included in Stop.
File pickers use component refs, and image reads retain their destination tab.
File-tree drags retain the source root and SSH host; a different host is rejected.
Unfocused scroll writes use `updateAiTab(sessionId, tabId, updater)` and reaching
the bottom still clears unread. No new CLI verb is added; the gaps below apply.

## New shell conversation content search (2026-11-06)

| UI action                                  | CLI                                                                    | Shared implementation                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Search local native conversation content   | `maestro-cli native-history search <text> [--project <path>] [--json]` | `agentSessions:searchNativeHistory`, `runNativeHistorySearch()`, `searchNativeHistoryFiles()`     |
| Open a content hit and jump to its message | Open gap below                                                         | `openNativeHistorySearchHit()`, canonical native resume and transcript backfill, `pendingLogJump` |

The desktop app must be running. The CLI supports relative local project paths.
The optional project filter compares physical local directories; SSH paths are
never passed to local resolution. Both callers receive `hits`, `truncated`, and
optional `limited`, `cancelled`, or `unavailable` flags. Each hit contains the
conversation identity, owning account, snippet and message locator.

The new shell starts content search after 250 ms for at least two characters.
Changing or clearing the query cancels the prior request, including account
discovery still in progress, and ignores late replies. The worker terminates
before its cancellation promise resolves. Search supports local Claude and Codex,
including compressed archives; SSH conversations retain title matching only.
Existing session-browser search reuses the extracted `sessionSearch.ts` parser
and snippet helper and keeps its API. Codex search now uses the same desktop
envelope and prompt decoding as displayed messages, so hidden injected context
no longer matches. Both UI and CLI find legacy Codex headers with an environment
`<cwd>` fallback and use account-scoped `session_index.jsonl` titles. Index reads
consume the existing byte budget; oversized or unreadable indexes report `limited`.
Without an indexed name, the title comes from the first displayed user request.
Native content jumps carry `revealTurnActivity`; only `newShell` expands the
containing turn and flashes the body after it mounts.

The third-round correction adds no action or CLI verb. Local Codex history
discovery now includes `archived_sessions` as well as `sessions`, so an archived
content hit can pass the canonical read used by resume and backfill.
`native-history read <agent> <native-id>` uses that same reader; `list` and explicit
conversation deletion share its account-scoped discovery. Plain rollouts still
take precedence over compressed copies. The Electron scenario checks CLI content
before clicking, retains the body-in-viewport and flash assertions, and polls the
persisted tab name after opening. These reads do not close the navigation gap.

## Native command discovery, T10

| UI action                                                         | CLI                                                         | Shared implementation                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Open `/` and inspect native commands for the current conversation | `maestro-cli tab commands <tab-id> [--agent <id>] [--json]` | `agents:getNativeCommands`, `createNativeCommandDiscovery()` |

The composer opts in with `newShell` for Claude Code and Codex. The CLI resolves
an exact tab, unique prefix or `active`, then asks the same IPC handler to resolve
its stored owner. Results contain `commands` with `command`, `description`,
`source` (`project`, `user`, `builtin`, `reported`) and a `prompt` for Codex
commands and selected Claude project commands.
An unavailable read returns `warning` (`unavailable` or `remote-unavailable`)
and the supported native builtins. The JSON warning is data, not a failed transport.
Queued native command execution preserves read failures and holds the item for
manual resend through the existing queue controls. CLI can inspect and remove
held items with `queue list` and `queue remove`; force-send remains an open gap.
This verb lists the native portion of `/`; Maestro's own workflow commands and
Settings custom AI commands retain their existing configuration paths.

Discovery uses the canonical account resolver and the execution cwd, including
SSH overrides. The renderer presents its memory cache immediately and checks on
reopening. Main caches directory listings and file bodies by metadata, with
single flight per provider, account, cwd and SSH configuration. Project scope
wins over user scope; within a scope, skills precede commands or prompts.
Claude reads commands and skills, and Codex reads its existing skills and prompts
locations. Codex and Claude project bodies use the same lookup during command
dispatch and queue draining. This makes the chosen Claude project body explicit,
since native Claude prefers a personal skill over a same-named project skill.
SSH discovery follows command directory symlinks through remote `stat -L`; other
remote stat callers retain their existing behavior.

Native init reports are captured with the account, cwd and SSH configuration
frozen at spawn. UI and CLI reads merge that scoped report with file discovery,
which wins on collisions. Reports have the label `reported`, because the init
event does not identify a file scope. Failed reads show only native builtins,
including cached reads after the failure. No discovery call starts a provider or
writes native files.

Spawns with `--no-session-persistence`, including automatic Claude synopses,
do not publish into that inventory. Their reduced or empty init reports must
not replace the conversation's plugin commands. A later persistent turn still
replaces the report, including with an empty list. This correction adds no UI
action or CLI verb: `/` and `tab commands` consume the same retained inventory.
Legacy `process:slash-commands` notifications are unchanged.

Account changes through `update-agent <id> --env CLAUDE_CONFIG_DIR=<directory>`
refresh the new-shell list even when App retains its chrome session snapshot.
`useNativeCommands()` subscribes directly to the current session's environment;
its cache key and IPC request use that value. `tab commands` continues to resolve
the stored owner through the same discovery handler. Reports remain attached to
their original account scope, and switching back restores them. The legacy
`session.agentCommands` report is preserved and does not enter new-shell
discovery. No action or CLI verb is added; classic-shell behavior is unchanged.

Source badges have a text separator from the command name, including English
and Chinese accessible names. This presentation fix adds no action or CLI verb;
`tab commands` still returns the command, description and source separately.

The scan-delay fixture uses the Electron module passed to `evaluateHandle` and
temporarily wraps `agents:getNativeCommands`. Cached reads and other contexts
continue through the original handler. This test-only correction adds no UI
action or CLI verb and preserves the draft and single-submission assertions.

Open gaps: plugin commands appear after an existing Claude process reports them;
there is no offline inventory of Claude plugin manifests or Codex plugin catalogs.
Project Claude commands expand their selected Markdown body and `$ARGUMENTS`
through Maestro; native skill frontmatter execution controls, indexed arguments,
dynamic shell interpolation and relative supporting-file semantics are not
reimplemented or verified here. CLI queue force-send has no equivalent yet.
Busy `dispatch --queue` stores a message and does not expand a native command
body through the composer; use normal dispatch when idle for this path. Codex TUI-only builtins cannot
be expanded by `codex exec`, so they are not offered as native commands. Other
providers keep their existing discovery. Real SSH transport, Electron rendering
and native command execution require external acceptance; the new synthetic
Electron scenario is `e2e/native-commands.spec.ts`.

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
The browser sends `sourceTabId` and `sourcePermissionMode` to the owner.
`remoteConversationPermissionFields()` chooses the stricter of the browser source
and the current desktop copy, with missing or invalid browser metadata requiring
readonly. The browser adopts the returned permission fields, including when an inventory update arrives before the response. A missing
explicit source refuses creation. CLI creation retains the specified project scope.

Project creation uses `resolveProjectConversationPermission()`. Main requests the
compact permission and activity snapshot from each session's owning window in
parallel, with a 250 ms limit. Unassigned sessions follow the existing primary
window ownership rule. It checks the replying window and rejects a reply
if ownership moved. Complete replies select the newest selection, message or
creation time after checking each authoritative project and host identity. Missing
or timed out replies require readonly, even if every cached copy says full access.
Projects on different SSH hosts remain separate; remote paths are not resolved
locally. The provider creation route also bounds its source metadata hop to
250 ms and lets the target use the same resolver after a missing reply.

`update-agent <id> --cwd <path>` routes to the session's owning window, like
`update-agent --provider`. The owner applies the existing `withWorkingDirectory()`
transition used by directory editing, so permission snapshots report the current
project. This routing correction applies to both shells; no action or verb is added.

Closing the last tab preserves its permission in the automatic replacement.
Provider changes preserve supported modes, tighten unsupported standard to readonly,
and refuse a target without an equally strict mode. Handoff snapshots carry the
source permission. Manual changes only patch the new tab. Native history imports,
the classic shell keep their existing behavior. Context-bearing creation also crosses the permission boundary; existing compaction source overrides remain in place. No new CLI verb,
permission confirmation or user-facing text is introduced.

Review follow-up (2026-11-06): `createTab()` treats initial logs as new context,
not native history. Without an explicit source it takes the strictest known
conversation in this owner; only an empty owner falls back to project recency.
The fallback inventory includes hidden, closed, orphaned and snoozed conversations,
including snoozed group members. Project recency still excludes hidden consults. Missing capabilities refuse restricted creation.
`tileNewTabInSession()` resolves project owners before passing permissions to
`tileNewTab()`. Forking passes its exact source to `createTabAtPosition()` and
uses the validated fields in the first spawn. The call-site inventory test covers
`createTab`, its import aliases and `createTabAtPosition`; a new call requires review.

`unsnooze <id>` and `snooze wake <id>` share `wakeSnoozeNow()` and the tab store
with the UI. Single and group restore use `restoreConversationPermissions()`,
as does the scheduler. A group is validated as a whole. Unsupported restrictions
retain the snooze and suppress wake prompts; an already open duplicate is also
validated against its saved permission ceiling. No CLI verb or user text is added.

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

## New shell copy audit (2026-11-07)

This copy-only change adds no UI action or CLI verb. Language selection still
uses `settings set uiLanguage en|zh-CN`; shell selection still uses
`settings set newShell true|false`. File operations, conversation creation,
permission selection, handoff, retry and update preferences keep their existing
handlers and stored values. New shell labels are separate from classic labels.
Terminal search, selection menus, file preview and file-operation feedback use
the same callbacks as before. Update toggles still use `settings set
checkForUpdatesOnStartup|enableBetaUpdates|crashReportingEnabled <boolean>`.
Provider diagnostics remain verbatim. Existing presentation and recovery gaps
below remain open.

## Open gaps

Claude approval: the modal covers the composer Stop button. Escape denies only
the current tool. U4 tests the existing interrupt IPC while approval is pending;
it does not add a direct Stop action or close the existing full Stop parity gap.
`permission` covers tool allow/deny only; a structured AskUserQuestion answer
command, cross-window routing and browser prompt delivery are not verified here.

**Codex prototype controls (2026-11-07).** `codex-turn stop` interrupts only the
addressed local app-server process through `ProcessManager.interrupt()`. The
composer Stop also cancels the project's queued work and cross-agent consults;
that wider existing Stop action is still not CLI-covered. Approval prompts use
the main window only. Secondary-window ownership and web-desktop approval/steer
controls have not been integrated or verified. There is no CLI draft editor:
`steer` takes explicit text and leaves the desktop draft alone. The composer
shows the affordance from opt-in eligibility; if the current turn started with
exec before the setting changed, the main process refuses steering and the draft
is retained. No RPC is sent to that exec process.

**Copy audit presentation controls (2026-11-07).** The existing terminal search
query and next/previous match, file preview tier, image zoom, and media
playback/volume controls still have no CLI verbs operating their mounted UI
state. `read-terminal` exposes output, `open-file` opens a file, and `--queue`
adds media, but none controls those presentation states. Terminal selection
quoting and link context-menu presentation also lack a shared CLI UI action.
The copy audit translates these existing controls only; it does not close these
gaps or add separate implementations. Error recovery remains in the backlog below.

## New shell conversation children (2026-11-07)

| UI action                                               | CLI                                                                 | Shared implementation                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Inspect a parent's child conversations and their status | `tab children <tab-id> [--agent <id>] [--json]`                     | `findConversationParent()` in `shared/conversationChildren.ts`; open tab inventory                       |
| Select a child conversation                             | `tab select <tab-id> [--json]` or `focus-agent <agent> --tab <tab>` | `select_tab` / remote selection and `setActiveTab()`; new shell reveals the hidden tab and clears unread |
| Ask another conversation to do work                     | `ask <target> <question>` or `dispatch <source> "@Target ..."`      | Existing mention planner and `sendCrossAgentRequest()`                                                   |
| Delegate into a new child                               | `dispatch <target> <prompt> --new-tab` from a stamped caller        | Existing accepted-dispatch notice and `recordAgentDelegation()`                                          |
| Add a reply while a child works                         | `dispatch <child-owner> <prompt> --tab <child-tab> --queue`         | Existing execution queue; consult completion releases the child's tab barrier                            |
| Continue an idle child                                  | `send <prompt> --tab <child-tab>`                                   | Existing composer send and captured native session ID                                                    |
| Rename, star or close a child                           | `tab rename`, `tab star`, `tab close`                               | Existing tab actions, also used by nested row menus                                                      |

Origins are created only under `newShell`. A source native ID arriving later is
filled once by `captureConversationSourceNativeId()`, shared by normal provider
events and consult completions. The tree checks account and SSH identity with
`matchRecordForTab()` before offering a history parent. No remote path is resolved
locally. `tab children` returns direct children including hidden consults, product
provider markers, busy/error state and origin metadata. The tab inventory and
origin metadata still wait for persistence. Running consults and their terminal
errors come from the main-process consult registry; persisted error logs retain
the failure after restart. Normal managed processes take precedence when the
child is continued.

Background consults still have no tab chip and raise no unread. Selecting one is
an explicit reveal. A busy consult tab is not reused for another simultaneous
consult in the new shell. Completion and failure settle existing subtask state
even if the user switched back to the classic shell meanwhile. These children
keep the full consult detail instead of spawning a second summary writer.

Plain dispatch into an existing conversation keeps that conversation's current
origin. A command without caller identity creates no guessed parent. The new CLI
help strings share the English and Chinese catalogs and follow the process
locale. The classic CLI inventory now suppresses stale unread on hidden tabs and
adds optional provider/hidden/error/consult-origin fields; desktop classic
navigation and ordinary consults retain their previous behavior.

Consult creation and reuse intersect the source permission, the target project's
default, and the existing child's restriction through the canonical permission
functions. Execution carries that ceiling; the global write switch can only
tighten it. A closed running child saves its reply and native identity into the
retained tab, and remains in the orphan collection while queued work exists.

Archive and unarchive use the existing `tab archive <tab-id>` and
`native-history archive|unarchive <owner> <native-id>` routes. The shared
`conversationBranch()` check refuses archive while a descendant is running or
queued. The tree resolves archived parents before filtering, so completed
children stay hidden with their parent and return on unarchive. A child can be
archived independently.

New shell Stop addresses both outgoing consults and the incoming consult on the
selected child. The main registry waits for process exit before acknowledging
cancellation. Stopping a child leaves its siblings, including closed siblings,
running. This uses the desktop interrupt service; the existing CLI Stop gap below
remains open. No new CLI verb was added in this review correction.

咨询历史展示修复（2026-11-07，U3 第三轮）没有新增界面动作或 CLI 动词。
`ask`、带 @提及的 `dispatch` 和界面派发继续使用 `sendCrossAgentRequest()` 与同一路由。
原生 ID 到达时立即通过 `targetNativeSessionId` 通知显示认领，存入
`consultOrigin.nativeSessionIds`；`targetAgentSessionId` 仍只表示成功后的续聊资格。
停止或失败也清除旧续聊资格，防止复用被中断的咨询。显示认领仅在 `newShell` 的树中生效。

`tab close` 和原生历史打开沿用原入口；`native-history list`、`native-history search`
与界面读取同一份清理后的标题和搜索正文。生产信封及 `stripCrossAgentPrompt()`
位于 `shared/crossAgentPrompt.ts`，兼容旧记录，不改写原生文件。
没有新增 CLI 对等缺口，下列停止、折叠和历史打开的既有缺口仍保留。

## Open gaps

**Subtask disclosure and archived sources (2026-11-07).** The disclosure button
keeps local React state. `tab children` reads the same parent relation but does
not expand or collapse the desktop tree. It resolves an open parent tab; after
closing the source, reopen its native history row and pass the new tab ID.
The existing native-history open gap below still applies. A pre-feature consult
without a captured source native ID can only attach while its original source
tab is open.

**Cross-window CLI child provenance, U3 review item 6 (2026-11-07).** Confirmed
and deferred under the review's small-change limit. The accepted-dispatch notice
routes to the caller window, where `recordAgentDelegation()` patches the target
tab. A missing target snapshot drops the patch, and persistence excludes targets
owned by another window. Fixing this needs source identity in the new-tab request,
target-owner storage and acknowledgment, across the dispatch handler, callback,
preload and renderer request path. This review does not claim cross-window
attachment or restart recovery. The source must be transferred before the target
acknowledges creation; broadcasting the existing caller notice is insufficient.

## New shell changes by turn (2026-11-06)

| UI action                                      | CLI action                                                                                                        | Shared implementation                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Read changes grouped by conversation turn      | `changes --by-turn --tab <id> --json`                                                                             | `updateTurnWriteIndex()` and `groupChangesByTurn()`, with `agentSessions:turnWrites` and `git:changes` |
| Choose By file or By turn on this conversation | `tab panel <id> changes-files` or `tab panel <id> changes-turns`                                                  | `changeNewShellPanel()`, persisted in `AITab.newShellPanel.changesView`                                |
| Open a diff, stage, unstage, revert or commit  | Existing `changes --file`, `changes stage`, `changes unstage`, `changes revert --yes`, `changes commit --message` | Existing Git handlers and panel actions                                                                |

The new panel actions require `newShell`. Reading `--by-turn` is read only and
does not change the view preference. It cannot be combined with `--file` or a
write action. JSON keeps the Git snapshot and adds `groups`, `hasWriteRecords`
and `diffScope: "current"`. A group's `turnId: null` means Other changes; its
title is empty so the renderer can localize it. Each recorded group carries the
user message's first line, capped at 120 characters, and its timestamp.

The UI memoizes the live index by the log array. New-shell persistence saves
`AITab.changeTurnIndex` before trimming the displayed logs to 100 entries.
Both surfaces obtain complete Claude and Codex native indexes from the same
read-only `agentSessions:turnWrites` handler, scoped to the selected owner,
account and SSH host. Native indexes take precedence when they contain writes;
otherwise the retained live index supplies the evidence. No native file is
created, restored or edited. The main-process cache holds up to 32 identities,
uses the existing transcript revision probes, and incrementally converts the
open turns while reusing closed turns from the canonical storage readers.
Remote Claude has no revision probe and is read only on an explicit refresh.

Both surfaces intersect recorded successful writes with current Git changes.
Renames use Git's `oldPath`; copies do not inherit the source file's turns.
Git's 500-file limit remains. `executionCwd` comes from Git on the execution
host and maps the selected cwd alias, including SSH `~` and `$HOME`, without
local resolution of remote paths. Explicit write paths survive display input
truncation. Unrecognized path aliases and parent traversal remain unmatched.

The synthetic T8 scenarios in `e2e/native-new-shell.spec.ts` cover two turns,
Other changes, shared diffs, staging, CLI parity and restart with 150 later
logs, plus each provider's early native write before 600 later messages and
5000-character tool inputs. The Codex fixture uses legacy call/result records.
They have been authored but not executed in the sandbox.

## New shell conversation archive and native deletion (2026-11-06)

| 界面动作                     | CLI                                                                  | 共用实现                                                             |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 对话右键或命令面板归档       | `tab archive <tab-id>`；`native-history archive <agent> <native-id>` | `agentSessions:archiveConversation` 与 `createConversationArchive()` |
| 项目底部展开已归档列表       | `native-history list --archived`；限定项目时加 `<agent>`             | 主进程归档元数据与 `listProjectHistory` 的归档过滤                   |
| 取消归档                     | `native-history unarchive <agent> <native-id>`                       | 同一归档服务，取消标记并保留权限元数据                               |
| Codex 对话右键或命令面板删除 | `native-history delete <agent> <native-id> --yes`                    | 新界面复用同一服务，再调用原有 `CodexSessionStorage.deleteSession()` |

归档写入 Maestro 设置的 `archivedConversations`，以工具、主机、规范账户历史目录和原生 ID 为身份。主进程检查仍在运行的进程，并向每个所属窗口请求实时检查及标签关闭。忙碌、排队或窗口无法确认时拒绝；关闭采用原标签实现，不调用模型、不写原生历史。项目扫描、缓存条目和打开标签的投影都排除归档项。工作树归档仍显示在所属项目下。

取消归档仅将记录的 `archived` 设为 `false`，保留权限、原活动时间及项目归属；旧记录未带该字段时仍视为已归档。默认归档接口和 `native-history list --archived` 只返回已归档项，渲染层以 `includeUnarchived` 读取完整权限库存。浏览器和桌面均初始读取并订阅同一事件，只有桌面处理标签关闭。`projectHistoryScopeFor()` 统一目录边界、最具体项目、工作树和主机归属，子目录归档也有恢复入口。

T9 第三轮仅修正验收入口，没有新增 CLI 动作。`tab new` 确认渲染层创建完成时，`tab show` 读取的主进程持久化库存可能尚未更新；验收先确认页面中的同一标签，再等待该 ID 可读，仍同时断言 `permissionMode: readonly` 和 `readOnly: true`。`test:e2e` 同时构建 `web-desktop`。

T9 第四轮将子目录归档的 Electron 验收收敛为桌面左栏操作、归档和取消归档后的重启保留，以及 `native-history archive|unarchive` 的桌面同步。浏览器归档读取、保留取消归档权限元数据、实时增删、重新挂载后的读取与订阅和卸载退订，由 `src/__tests__/renderer/hooks/useRemoteIntegration.test.ts` 覆盖。移除验收中的额外 `BrowserWindow`，产品实现和 CLI 动作均不变；修改后的 Electron 场景待外部执行，浏览器整页及跨窗口同步不在本轮验收范围。

权限继承排除归档项的最近活动；没有普通对话时使用归档中最严格的已知档位。没有 Maestro 权限记录的原生历史保守记为只读。空项目不会在重启时被当作损坏数据补出高权限对话。新界面关闭时不启用归档过滤或新增菜单；归档写操作要求 `newShell`。既有 CLI 删除增加 `--yes` 确认，这是两种界面共用的安全收紧。Claude 不提供原生删除。

## Second batch integration (2026-11-07)

`native-history search` and sidebar content search share the archive filter in
`agentSessions:searchNativeHistory`. With `newShell` enabled, both exclude Maestro
archive keys, scoped to provider, host, account pool and native ID. The sidebar
also removes already displayed hits when archive metadata changes, cancels any
pending search and refreshes the unchanged query after archive or unarchive.
Search identities use `nativeHistoryPool()`, shared with discovery and archive,
including account aliases that share a transcript directory. Codex `archived_sessions`
is native storage and remains searchable unless Maestro has archived that exact
identity. The scan and result budgets remain unchanged; filtering can return
fewer than 50 hits. This repair adds no UI action, CLI verb or localized copy.

The shared CLI result identity now matches discovery even with `newShell` off;
classic-shell result membership and the archive filter's opt-in remain unchanged.

Project creation still resolves authoritative owner snapshots, excludes archived
conversations from recency and uses the strictest archive when no ordinary
conversation remains. Missing owners or changed project/host identity cannot
authorize wider permissions. A direct `createTab()` without `permissionSource`
uses the strictest known inventory, including archives, hidden conversations,
closed tabs, orphaned turns and snoozed group members. The creation call-site
inventory remains unchanged. The archive tests exercise project recency through
`resolveProjectConversationPermission()` and assert the strict fallback separately.

## Open gaps

**项目设置的展示状态，U2。** 打开、关闭弹窗和切换位置选择框没有 CLI 窗口状态动词；读取、修改、清空、确认和变量显示都有上表对应动作。新界面可达的“在下方新建 AI 对话”在项目有默认值时共用 `newProjectConversation()`，再将返回的实际归属交给 U1 的 `splitConversation()` 在右侧显示。CLI 可按顺序调用 `tab new` 和 `tab split`，没有原子化的新建并分屏命令。普通浏览器暂不编辑项目环境值；手机实际点击仍需验收。

**向导入口，U2 二轮。** `handleLaunchWizardTab()` 仅由旧 Auto Run 工具栏使用，新界面隐藏 Auto Run、向导命令和快捷键，因此未增加项目环境创建逻辑。启动模型已改为优先使用新标签解析出的模型。若未来开放该入口，必须先接入统一项目创建服务，并补齐 CLI 对等及 Electron 验收。

**New shell split limits (2026-11-07).** Split targets must already be open tabs;
native history entries must first be opened with the existing history action.
Conversations owned by another window cannot be split into this window. There is
one saved split pair in settings, so independent saved pairs per window are not
implemented. Existing external native transcript following still follows only
the focused conversation; this change does not add a second background reader.
All new visible split actions have the CLI equivalents listed above.

2026-11-07 性能分支合并保留主线工具全文和任务面板动作。消息行复用仍传递全文来源，来源或原生调用身份更新时清除旧全文；读取继续共用 `agentSessions:toolOutput` 与 `native-history tool-output`，本轮没有新增 UI 动作或 CLI 动词。以下全文收起状态和 SSH 等既有缺口保持原状。

2026-11-06 性能基准没有新增界面动作或 CLI 动词。Codex 列表的目录判断优化位于共享存储适配器，桌面项目列表、`sessions` 和 `native-history list` 沿用同一实现。性能采集继续使用 `profiling start/status/stop`；离线合成基准见 `scripts/perf/README.md`。本轮没有填补下列既有交互缺口。

**Fork and create-in-tile actions (2026-11-06).** Message forking still has no
`tab fork --at` verb; this remains the Composer backlog below. The palette and
shortcut for creating a conversation directly in a tile share
`tileNewTabInSession()`, but there is no CLI action calling that service.
`tab new` covers the same project permission resolution, not the tiling action.
This permission repair does not add either command. Scheduled wake refusal has
no new diagnostic UI; the retained snooze can be woken manually after selecting
a tool that can preserve the restriction.

**CLI inventory timing (2026-11-06).** `session list` and `tab show` read the
persisted desktop inventory. UI history selection, closed-tab restoration and
`tab new` can precede its debounced save. Acceptance waits for the expected native
identity or returned tab ID before reading or mutating it, then uses that exact ID.
The permission write and provider switch still require immediate readback after
their acknowledged save. There is no live-owner inventory read in these CLI verbs.

**Turn grouping freshness (2026-11-06 review fix).** For conversations without
readable native write records, CLI still reads the persisted independent index.
A live write can lag until normal persistence completes. Early writes no longer
disappear permanently after log trimming, and native indexing no longer depends
on scrolling through history. No new UI action or CLI verb was added.

- T9：自动发现但尚无匹配工具及账户配置的历史，可在界面直接归档或取消归档。CLI 的修改命令使用 `<agent>` 指定账户，需要先有匹配的配置；暂未提供直接按账户目录修改的参数。全局 `native-history list --archived` 仍可读取这些条目。
- T9：运行状态拒绝覆盖 Maestro 管理的进程、窗口标签和队列。尚未接入其他应用或独立原生 CLI 的活动探测，不声称能识别这些外部进程是否正在写同一历史。
- T9：跨窗口先全部检查，再逐个关闭。若后一个窗口在关闭时失败，归档标记回退，但已关闭窗口的标签不自动恢复；尚未提供跨窗口事务式回滚。

**Native content search navigation (2026-11-06).** Content retrieval has the CLI
command above. Opening a returned hit, creating a compatible runner when needed,
and scrolling or flashing its message still have no acknowledged CLI command.
They extend the existing native-history open gap below. The implementation is
`openNativeHistorySearchHit()`; a future CLI entry must route to that service in
the owning renderer. `native-history read` returns text but does not perform this
UI action. Cancelling or clearing the sidebar search is also view-local; the
internal cancellation IPC has no standalone CLI verb.
The review fix also expands a folded turn before flashing its matched body.
That expansion belongs to the same unresolved navigation action, with no new
CLI verb in this round.

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

1. **Interrupt a running turn.** In the new shell, Stop and Escape stop the named
   conversation, including its forced parallel processes and busy orphan tabs.
   Classic Stop remains agent-wide. There is
   no CLI equivalent and no WS message behind one. This is the largest remaining
   gap: an agent that starts a runaway turn on another agent cannot stop it.
   The 2026-11-06 Stop/synopsis correction preserves this gap; the legacy remote
   interrupt callback is not the desktop interrupt implementation.
2. **Reopen a closed tab.** New-shell restore now revalidates permissions against
   the current tool through `restoreConversationPermissions()` and the same
   `newConversationPermissionFields()` used by creation. This fix adds no CLI verb.
   `closedTabHistory` and `unifiedClosedTabHistory` are
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
    then add `interrupt <agent> [--tab]`. The 2026-11-07 new shell correction fixes
    the desktop callback and source-tab consult cancellation, but deliberately
    leaves this legacy remote transport and the missing CLI verb as Open gaps.
    A normal conversation stop must not be confused with `group-chat stop` or
    `stop-auto-run`, which control different workflows.

    **Composer attachments and reading position:** there is still no CLI action
    to open a file picker, stage an image on a draft, insert a dropped file
    reference, or set the transcript scroll position and bottom/unread state.
    `image list/save` reads or exports existing images; it does not attach one.
    The new source-host rejection and per-pane scroll fix do not close these gaps.

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

## Codex app-server prototype (2026-11-07)

Both `newShell` and `codexAppServer` must be true; the latter defaults to false.
Only local user turns with a conversation tab use this path. SSH and Auto Run
stay on exec. A saved Codex `standard` turn without the local approval transport
is refused, including after either setting is disabled, so it cannot inherit
exec's bypass arguments. Full and read-only exec behavior is unchanged.

| UI action                             | CLI action                                                                  | Shared implementation                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Enable the prototype                  | `settings set codexAppServer true` after `settings set newShell true`       | Existing settings service and persisted defaults                                         |
| Choose standard permission            | `tab permission <tab-id> standard --agent <owner-id>`                       | Shared eligibility gate, existing tab permission action, explicit spawn policy           |
| Create, resume and send a turn        | Existing `tab new` and `dispatch <owner-id> <text> --tab <tab-id>`          | Existing renderer dispatch and `process:spawn`; app-server selected in `handle-spawn.ts` |
| Add ordinary text to the running turn | `codex-turn steer <process-id> <text>`                                      | `process:steer`, `ProcessManager.steer()`, exact `turn/steer` acknowledgement            |
| Read pending approvals                | `codex-turn permissions`                                                    | The same pending registry used to render `PermissionPrompt`                              |
| Allow or deny one approval            | `permission-respond <request-id> <decision>`, decision is `allow` or `deny` | Existing `permission:respond` and permission relay registry                              |
| Stop the running prototype process    | `codex-turn stop <process-id>`                                              | `ProcessManager.interrupt()` and `turn/interrupt`; wider Stop gap above                  |

All four new commands support `--json` and require a running desktop bridge.
The process ID is the full `<owner-id>-ai-<tab-id>` string, not a native Codex
thread ID. Pending-approval listings include both `sessionId` (the process ID)
and `requestId`. Otherwise obtain the owner and tab from existing `session list --json` command and construct that process ID.
A successful steer receipt means accepted by the same turn, not completed.
Failure or timeout keeps the draft, does not queue it, and never retries it.
The CLI returns nonzero on rejection. A stale permission request is rejected.
Unknown protocol requests are not treated as implicit approval.

Synthetic validation and unresolved protocol/version limits are recorded in
[the prototype note](../verification/codex-app-server-prototype.md).

## New shell transcript performance (2026-11-06)

Progressive row element reuse changes rendering work only. No new UI action or CLI verb is introduced. Existing conversation selection, transcript search and jumps retain their current paths and existing gaps; this change does not claim to close native resume or refresh gaps.

New shell stdout placeholder cleanup now shares the existing 200 ms output batch, including final flush. It adds no user action. CLI and UI initiated turns continue through the same process listener and session batcher.

## Renderer benchmark runner (2026-11-06)

T4 第三轮只修改离线合成基准，不增加界面动作或 maestro-cli 动词。阶段选择使用 `MAESTRO_PERF_STAGES`，运行命令、依赖和结果读回见 [renderer 性能复测](../perf-renderer.md)。产品内性能采集仍走既有 `profiling start/status/stop`，本轮没有填补 Open gaps 中的交互缺口。

## T4 fourth round rendering

Opening and switching conversations use the existing UI and CLI selection paths.
Lazy row construction changes no action, command, message or IPC contract.
The progressive window still hydrates the full history and retains search and jump targets.
No new CLI verb or parity gap is introduced.

Startup now defers local Git metadata refresh only in the new shell. It uses the
existing gitService and background refresh path, with no new user action or CLI
verb. The new shell splash also removes decorative waits after the existing data,
paint and font readiness gates. Classic startup and SSH refresh remain unchanged.

## U7 流式输入调查（2026-11-07）

本轮只修补合成 renderer 基准的逐键记录与尾帧收尾，并增加输入和流式批次的源码回归，没有新增界面动作或 maestro-cli 动词。UI 与 CLI 发起的回合仍共用原有 process listener 和 session batcher；产品内采集沿用 `profiling start/status/stop`。七轮 stream 命令见 [renderer 性能复测](../perf-renderer.md#u7流式期间按键延迟调查)。Open gaps 中既有的视图交互缺口保持原状，本轮不声称补齐。

### Codex 原型审批归属补充（2026-11-07）

`codex-turn permissions` 和 `permission-respond` 与桌面审批共用请求归属校验。
Codex 原型的浏览器调用明确拒绝，包括未开启网页登录的浏览器。CLI 必须通过服务端认证的
`trustedCli` 身份，按桌面用户和主窗口身份查询及响应，因此不能处理其他窗口或
浏览器用户的请求。桌面只能处理原始所属窗口中的请求；关闭窗口后不能批准。

Claude 的既有浏览器审批继续通过 `permission:respond`，CLI 对应
`maestro-cli permission-respond <request-id> <allow|deny>`，共用同一响应及 pending 校验。
仅当请求所属用户和调用方用户都存在且不同时拒绝；桌面发起、无所属用户的请求，
允许已通过服务端认证的浏览器客户端响应，包括副窗口发起的请求。浏览器不校验窗口，
桌面和可信 CLI 仍校验原始窗口。用户、客户端类型只取服务端元数据，不取请求参数。
重复、结束和超时请求均失败。此修复同时恢复旧界面的既有浏览器用法，没有新增动词。

Open gaps：CLI 暂不选择其他窗口；`codex-turn permissions` 只列 Codex 原型请求，
Claude 请求由 `permission list` 查询，并按相同调用方归属过滤；浏览器 Codex 原型审批尚未支持。
新界面尚无按单条对话修改 token source 的控件，现有 `update-agent --token-source`
修改所属工具记录，影响其下对话。

Codex 标准权限的输入栏、项目设置、新建、继承、恢复及 `tab permission` 共用
`effectiveStandardPermissionCapability()`。`project settings set --permission standard`
保存项目的默认意图，实际 `tab new` 创建时按目标能力收紧，不等同于修改已有对话权限。
项目设置保存入口尚未按具体对话的 token source 拒绝默认值，属于上述创建规则覆盖的范围。
咨询显式禁用原型能力，继续自己的 exec 权限限制。

原型计划通知沿用 `update_plan` 工具事件，任务面板及 `tab panel <tab-id> tasks`
继续读取同一清单。追加防重仅管理界面草稿，不会把两次显式 CLI steer 指令合并。
此次没有增加 CLI 动词，既有追加、审批、项目默认权限、新建、面板及停止动作均保留。
