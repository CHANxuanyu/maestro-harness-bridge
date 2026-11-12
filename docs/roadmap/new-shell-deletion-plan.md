# 新界面旧功能删除准备

本轮只盘点，不删除代码、设置或用户数据。依据是原规格决定 4 和 2026-11-10 的 R4：先由用户体验，再决定默认切换和具体删除范围。`codex/default-new-shell` 的默认切换 PR 保持未合并；当前主线不受影响。旧界面至少保留到默认切换发布后的下一个版本，不能以准备分支创建时间计算这一版本。

## 证据和边界

扫描基点为 `1d9ed9c9f`。完整候选文件、相对 import 的双向边、IPC 字符串和设置读取位置见 [逐文件清单](new-shell-deletion-inventory.json)。清单由 `rg --files src e2e` 枚举文件，再用 TypeScript AST 解析静态 import/export、字面量 require/import()，解析相对路径、扩展名和 index 模块。只计生产代码的入边和出边，测试文件单独列入候选。记录包含路径筛选表达式，方便在实际删除前复查。

路径匹配是候选集，不是删除白名单。多个功能共用的文件会重复计数；没有相对 import 不等于没有调用者，IPC、设置、菜单、动态模块、类型别名和字符串注册还须核对。JSON 中 `ipc` 是 handler/preload 中出现的通道字面量，含通知和转发，不全是 `ipcMain.handle`。`settings` 是直接读取位置，不包含所有嵌套标志。下表数据不代表可节省的字节。

| 范围                 | 候选文件 | 其中测试 | 外部生产 import 入边 | 对外生产 import 出边 |
| -------------------- | -------: | -------: | -------------------: | -------------------: |
| Cue 与关联 Pianola   |      448 |      217 |                  103 |                  381 |
| 群聊                 |       99 |       46 |                   73 |                  203 |
| Auto Run 与向导      |      472 |      166 |                  124 |                  668 |
| 使用量面板及统计候选 |      197 |       66 |                   17 |                  417 |
| Director's Notes     |       40 |       15 |                    9 |                  125 |
| 插件                 |      155 |       76 |                  108 |                   64 |
| Playbooks            |       38 |       15 |                   25 |                   69 |
| Marketplace          |       44 |       15 |                   10 |                   51 |
| 文档图谱             |       44 |       23 |                    7 |                   52 |
| Symphony             |       79 |       31 |                   12 |                  103 |
| 旧界面容器           |       58 |       18 |                   33 |                  495 |

逐项复查命令，均只读源码：

```sh
rg --files src e2e
rg -n 'ipcMain.handle|register.*Handlers' src/main/ipc/handlers src/main/ipc/bootstrap
rg -n '\.command\(' src/cli/index.ts
rg -n 'cue|groupChat|autoRun|directorNotes|documentGraph|symphony|plugin' src/shared/settingsMetadata*.ts src/main/stores src/renderer/stores/settingsStore.ts
rg -n 'path.join|FILENAME|DIRNAME|CONFIG_PATH' src/main/cue src/main/group-chat src/shared/plugins/storage.ts src/shared/pianola/storage.ts
rg -n 'newShell|shellFeatureVisible|shellActionVisible' src/renderer src/shared/newShellFeatures.ts
```

## 分功能清单

以下路径均相对仓库。完整文件名和调用方在 JSON 中按同名功能分组。测试目录与通道前缀表示该组内的实际命中，不授权删除整个共享目录。

### 1. Cue

- 专属主体：`src/main/cue/`，`src/shared/cue/`、`cue-*.ts`，renderer 的 `CueModal/`、`CuePipelineEditor/`、`CueYamlEditor/`、`hooks/cue/`、`useCue.ts`、`useCueAutoDiscovery.ts`。关联候选为 `src/main/pianola/`、`src/shared/pianola/`、`PianolaModal/` 和 `usePianolaAgent.ts`，Pianola 不能仅凭名称一起删，先确认其独立 CLI 是否也退出。
- 接口：`ipc/handlers/cue.ts`、`cue-stats.ts`、`cue-backup.ts`、`pianola.ts`，相应 preload；通道 `cue:*`、`cue-stats:*`、`cueBackup:*`、`pianola:*`。移除 `web-server/callbacks/cueCallbacks.ts`、消息 handler 与 `preload/process/cueRemote.ts` 的专属注册。
- CLI：`cue trigger/list/model/enable/disable/activity/schedule/pipeline` 及其子命令；`pianola`、learn/profile/orchestrate/supervise 系列。`agent-run` 是共享记录能力，不能随 Cue 删。
- 设置和存储：`encoreFeatures.maestroCue`、`cueHistoryRetentionDays`、`groupCueEntries`、`cueTimeBackfillApplied`，会话中的 Cue 配置；`cue.db` 及 WAL/SHM、项目 `.maestro/cue.yaml`、旧 `maestro-cue.yaml`、`.maestro/prompts/`、`cue-pipeline-layout.json`、用户数据中的 `cue-backups/`。队列存在 `cue.db` 中，不虚构单独 queue 文件。Pianola 文件名由 `src/shared/pianola/storage.ts` 定义：`maestro-pianola-{rules,plans,profiles,suggestions,supervisor}.json`、`pianola-decisions.jsonl`。
- 依赖：`src/main/index.ts` 的 engine 装配、`app-lifecycle/quit-handler.ts` 的停止清理、history 的 Cue 合并、统计聚合和插件 first-party bridge 都要先解绑。**必须保留** `src/shared/agent-run/` 的共用记录协议、进程管理、SSH、模板、锁、原生历史和账户解析；仅 `pianola-adapter.ts` 可在确认无调用者后退出。
- 测试：JSON 的 217 个测试候选，主要在 `src/__tests__/main/cue/`、`shared/cue/`、renderer Cue 组件及 CLI cue/pianola。未发现名称专属的 Cue E2E；`e2e/plugins.spec.ts` 和通用快捷键/启动测试需去掉 Cue 专属断言并保留共用覆盖。
- 顺序：停止入口和订阅调度，断开生命周期与历史合并，停后台服务并保证退出，拆共享 agent-run 适配，再删除 UI/IPC/CLI 和专属实现。数据默认只留存，删除备份需另行授权。

### 2. 群聊

- 主体：`src/main/group-chat/`，`GroupChat*` 组件、`hooks/groupChat/`、`groupChatStore.ts`，`src/shared/group-chat-types.ts`、`groupChat*.ts`。
- 接口：`ipc/handlers/groupChat.ts`、`preload/groupChat.ts`、`preload/process/groupChatRemote.ts`、WS groupChat handler/callback；`groupChat:*` 及 `remote:*GroupChat*`。CLI 为 `group-chat` 子树，通用 `group`/`create-group` 管理工具配置分组，不属于群聊。
- 设置和数据：`groupChatsExpanded`、`groupChatSortAlphabetical`、活动群聊/参与者/队列视图状态；`group-chats/<id>/metadata.json`、`chat.log`、`images/`、`history.jsonl`、`queue.json`，参见 `group-chat-storage.ts` 和 `group-chat-queue.ts`。不删除普通会话或 provider 原生记录。
- **必须先拆出并保留** `spawnGroupChatAgent.ts`、`output-parser.ts`：`src/main/cross-agent/cross-agent-router.ts` 直接导入它们，新界面派活仍依赖。还须保留 agent liveness、usage 提取、SSH spawn、idle watchdog 的共用能力。`process-listeners` 的群聊生命周期分支才是候选。
- 测试：46 个候选，group-chat main/integration、GroupChat 组件、CLI；E2E 为 `e2e/group-chat-load-demo.spec.ts`。跨工具咨询和 `native-cross-window-subtasks.spec.ts` 等新界面子任务测试必须留下，并先证明拆分后的委派仍工作。
- 顺序：抽离共用启动/解析并跑委派回归，移除群聊 UI 与 transport，停 moderator/participants，最后删除专属存储和恢复代码。

### 3. Auto Run 和旧向导

- 主体：renderer `AutoRun/`、`AutoRun.tsx`、`BatchRunnerModal.tsx`、`hooks/batch/`、`batchStore.ts`、Thought Stream 专属组件/store，`Wizard/`、`InlineWizard/` 和向导 hooks；main `autorun/`；CLI `services/batch-processor.ts`。逐文件见 `autoRun.candidateFiles`。
- 接口：`ipc/handlers/autorun.ts`、`preload/autorun.ts`，`autoRunControlRemote.ts`、`autoRunConfigRemote.ts` 和对应 WS callbacks；`autorun:*`、`remote:*AutoRun*`、`remote:launchGoalRun`。Playbook/marketplace 的 preload 当前与其相邻，先分别拆清再删。
- CLI：`auto-run`、`refresh-auto-run`、`stop-auto-run`、`resume-auto-run`、`skip-auto-run`、`abort-auto-run`、`reset-auto-run-tasks`、`auto-run-status`、`auto-run-folder`、`steer-auto-run`；`run-doc`、`goal-run`、`playbook <id>` 依赖 batch 引擎，应在用户确认 CLI 范围后一起处理，不能只删按钮。
- 设置和数据：`autoRunDisabled`、`autoRunInactivityTimeoutMin`、`autoRunMaxTaskDurationMin`、`autoRunStats`、`firstAutoRunCompleted`、`wizardResumeState`、`onboardingStats`、`tourCompleted`，会话中的 Auto Run 文件夹和执行状态。项目文档、working copy、备份和图片由 `ipc/handlers/autorun.ts` 按配置路径管理，不能递归删除项目文件夹。`maestro-sessions.json` 只退役这些字段，整个文件必须保留。
- 共享边：`src/cli/services/prompt-loader.ts -> src/shared/autorunModelHints.ts`；`main/index.ts -> autorunTurnSettings.ts`；dispatch/web handler 读取 `autorun-state-tracker.ts`。先决定并迁移这些调用。**必须保留** markdown 任务扫描、模板变量、执行队列、停止控制、tool activity label 等仍被普通会话使用的能力。`useBatchedSessionUpdates` 是流式渲染引擎，不是 Auto Run。
- 测试：166 个候选，batch、AutoRun、Wizard、CLI batch；E2E `autorun-batch.spec.ts`、`autorun-editing.spec.ts`、`autorun-sessions.spec.ts`、`autorun-setup.spec.ts`。新界面的 `TodoWrite/update_plan` 任务面板和原生任务测试保留。
- 顺序：先移除 Symphony、marketplace、playbook 对 batch 的调用，拆共享 prompt/dispatch 能力，再停执行器，删除旧面板和向导。更新提示、语言选择、项目起始页不随旧向导删除。

### 4. 使用量面板

- 专属 UI：`src/renderer/components/UsageDashboard/`、`UsageDashboardModal.tsx`，相关 modal/palette/快捷键注册。候选统计目录还包括 `src/main/stats/`、`hooks/stats/`；这部分不能整体视为面板专属。
- 接口：`ipc/handlers/stats.ts`、`preload/stats.ts`、WS stats handler 的 `stats:*`；CLI `stats`、`stats-query`。先明确退出的是 dashboard 还是统计采集和可编程查询，再裁接口。
- 设置和数据：`encoreFeatures.usageStats`、`statsCollectionEnabled`、`defaultStatsTimeRange`、`totalActiveTimeMs`、`usageStats`；`stats.db` 及备份/WAL/SHM、`token-usage-cache.json`。缓存与历史迁移见 `stats-db.ts`，不能把退出 UI 当作清空历史授权。
- 实际共用：`AboutModal.tsx -> hooks/stats/useGlobalAgentStats.ts`，`main/index.ts`、IPC bootstrap 都依赖统计服务。**必须保留** 新界面消息用量、context window、provider token/cost parser、`CodexTokenCounts`、usage peak 合并和原生历史用量。先分离面板聚合与会话统计。
- 测试：66 个候选，main stats、renderer UsageDashboard、统计 hooks；没有名称专属 E2E。共用 token/cost、历史缓存和状态栏测试留下。
- 顺序：先去 UI 注册，再去确实只给 dashboard 的查询与聚合，最后才评估数据库采集生命周期。`better-sqlite3` 还服务其他数据库，不能因为移除面板就删依赖。

### 5. Director's Notes

- 主体：`src/renderer/components/DirectorNotes/`、Encore 的 `DirectorNotesSection.tsx`/`useDirectorNotesAgentState.ts`，`src/shared/directorNotes*.ts`，main `utils/director-notes-*`。
- 接口：`ipc/handlers/director-notes.ts`、`preload/directorNotes.ts`、`web-server/callbacks/directorNotesCallbacks.ts`，`director-notes:*`；CLI `director-notes history/synopsis`。旧 History 面板、自动 synopsis 和 `tab save-to-history` 是关联范围，不是原生历史浏览器。
- 设置和数据：`encoreFeatures.directorNotes`、`directorNotesSettings`、`defaultSaveToHistory`、`synopsisDebounceSeconds`、`groupCueEntries`；`director-notes-shared-history.json`，以及 `history-manager.ts` 管理的 Maestro synopsis 历史。共享 history 文件先留存，不能删 provider 会话池。
- 共享依赖：history pagination/grouping、Cue 合并、stats rich overview、共享原生历史与 provider 查询。**必须保留** `agentSessions:*`、`native-history`、`useNativeTranscriptFollow`、镜像、归档与会话搜索。`History/` 并非 `DirectorNotes/` 的纯内部目录，需按消费者拆分。
- 测试：15 个命名候选，director-notes IPC/utils、DirectorNotes 组件、CLI 和 first-party 注册。未找到名称专属 E2E；新界面历史、接续、交接场景全部保留。
- 顺序：关自动 synopsis 和旧面板入口，删除专属查询/生成/CLI，拆 History 共用展示，再评估废弃缓存；不动原生会话。

### 6. 插件

- 主体：`src/main/plugins/`、`src/shared/plugins/`、`src/main/plugin-host-view-bridge/`，renderer plugin 面板与注册 hooks，构建时 bundled plugins 和 plugin sandbox entry。
- 接口：`ipc/handlers/plugins.ts`、`plugin-session-events.ts`，`preload/plugins.ts`、`plugin-panel.ts`，WS plugins handler；`plugins:*`、面板 `maestro:invokeCommand/panelData`。CLI `plugin init/validate/sign/pack` 及其实际子命令以 `src/cli/index.ts` 为准；Encore 开关与通用 `open` registry 一并核对。
- 设置和数据：`encoreFeatures.plugins`、`pluginTrustedKeys`，`src/shared/plugins/storage.ts` 定义的 `pianola-plugins.json`、`pianola-plugin-grants.json`、`plugins/`，插件私有 `store.json`，`plugin-authorization.bin`。OS Keychain 中的授权 anchor 只记录依赖，本计划和基线不读写它；不能在卸载时顺手清空真实 keychain。
- **必须先拆出保留** `src/cli/services/mcp-bridge.ts -> src/shared/plugins/mcp-protocol.ts` 的协议；guest webview security 使用的 `panel-host.ts`、`panel-navigation.ts` 和相关验证不能直接移除。first-party registry 携带其他仍保留功能的开关，`EncoreFeatureFlags`、`ENCORE_FEATURE_DEFAULTS` 不等于全部可删。通用 MCP、原生技能/命令和 provider plugin 发现不是 Maestro 插件市场。
- 测试：76 个候选，签名、权限 broker、沙箱、host-view、CLI plugin；E2E `plugins.spec.ts` 及 `fixtures/plugin-harness.ts`、`plugin-signing.ts`、`fixtures/plugins/`。共用 webview 安全与 MCP 协议测试迁移保留。
- 顺序：等各 first-party 功能解绑，抽走共用协议和安全边界，停止 scheduler/utilityProcess，去注册和安装入口，最后删除签名/授权实现。用户安装物只留存，不自动清理凭据。

### 7. Playbooks

- 主体：`src/cli/services/playbooks.ts`、`commands/*playbook*.ts`、renderer `Playbook*Modal.tsx`、`hooks/batch/usePlaybookManagement.ts`、main `stores/migrations/playbooks-folder.ts`。
- 接口：`ipc/handlers/playbooks.ts`、`preload/process/playbookRemote.ts`、WS playbooks handler/callback，`playbooks:*`、`remote:*Playbook*`。部分 preload 定义在 `preload/autorun.ts`，不能漏掉。
- CLI：`list playbooks`、`show playbook`、`playbook <id>`、`clean playbooks`、`remove-playbook` ，以及 `auto-run --save-as` 保存入口。
- 设置和数据：没有独立全局 feature 默认键，关联 Auto Run 路径/会话状态；`playbooks/<sessionId>.json`，导入导出 ZIP 的 `manifest.json` 和 assets，迁移兼容的旧文件夹路径见迁移文件。项目 Markdown 和资产不得自动删。
- 共享依赖：BatchRunner 和 marketplace import 都写 playbook，`readZipArchive`、`extractZipTo`、文件路径/SSH 工具为共用能力，必须保留。
- 测试：15 个命名候选，playbooks IPC/storage/CLI roundtrip。无独立命名 E2E，相关断言在 Auto Run 和 marketplace 场景中。
- 顺序：先去 marketplace 导入，再去 saved playbook UI/CLI 和 batch 引用，最后退役专属存储读写；保留历史文件供回退。

### 8. Marketplace

- 主体：`src/main/services/marketplace-service.ts`、renderer `MarketplaceModal/`、`hooks/batch/useMarketplace.ts`，`src/shared/marketplace*.ts`。
- 接口：`ipc/handlers/marketplace.ts`、autorun preload 内的 marketplace namespace、WS marketplace handler/callback，`marketplace:getManifest/getDocument/getReadme/importPlaybook/refreshManifest/manifestChanged`；CLI `marketplace list/show/import`。
- 设置和数据：`marketplace-cache.json`、`local-manifest.json`，导入后的文档和 `playbooks/<sessionId>.json`；没有独立 marketplace 全局开关键。与 Maestro 插件列表是不同市场。
- 依赖：playbook 服务、batch 的 marketplace hook、`shared/types.ts` 的导出；共用 `fetchWithTimeout`、ZIP 和路径验证、SSH 文件传输必须保留。
- 测试：15 个候选，marketplace IPC、CLI、MarketplaceModal 子组件；没有专属命名 E2E。
- 顺序：这是上层叶子入口，可在依赖拆分后最先移除；先停远程 manifest 刷新，再移除 UI/CLI/handler，缓存默认保留。

### 9. 文档图谱

- 主体：`src/renderer/components/DocumentGraph/`，`graphDataBuilder.ts`、`mindMapLayouts.ts`、`layoutTypes.ts`，Display 的 `DocumentGraphSection.tsx`。
- 接口：`ipc/handlers/documentGraph.ts` 的 `documentGraph:watchFolder/unwatchFolder/filesChanged`；CLI `open-graph` 和菜单/palette 项；该命令直接传文件集合，并非通用 `open` surface。
- 设置和数据：`encoreFeatures.documentGraph`，`documentGraphShowExternalLinks`、`documentGraphConfirmClose`、`documentGraphMaxNodes`、`documentGraphPreviewCharLimit`、`documentGraphLayoutType`、`documentGraphFontFamily`、`documentGraphFontSize`，共享 modalSizes 中对应项。没有专属数据库；扫描对象是用户文档，绝不删除。
- 共享边：`settingsStore.ts`、renderer types 导入 `layoutTypes.ts`；`AppStandaloneModals.tsx` 导入图谱视图和布局。**必须保留** `shell.capturePage`、`saveImageDataUrlToDisk`、Markdown、wiki/path links、file explorer 和普通文件 watcher；只移除 graph watch 注册。
- 测试：23 个候选，DocumentGraph、layout、watcher；没有独立命名 E2E。文件预览、截图保存和链接跳转测试保留。
- 顺序：解除 settings/types 对 layout 的引用，去入口和专属 watcher，再删图谱组件和专属算法；不要按“graph”匹配去删 git graph 或 context timeline。

### 10. Symphony

- 主体：`src/renderer/components/SymphonyModal/`、`hooks/symphony/`，`src/main/services/symphony-runner.ts`、`utils/symphony-fork.ts`，`src/shared/symphony-{types,constants}.ts`。
- 接口：`ipc/handlers/symphony/`、`preload/symphony.ts` 的 `symphony:*`。CLI 没有独立 `symphony` 子树，入口为通用 `open` 的 Symphony surface；不能因此删 GitHub/PR 命令。
- 设置和数据：`encoreFeatures.symphony`、`symphonyRegistryUrls`；用户数据 `symphony/symphony-cache.json`、`symphony/symphony-state.json` 和贡献工作目录。fork/clone/PR 是真实用户资产，不在删除代码的授权内。
- 依赖：App 中 contribution hook、`AgentCreationDialog.tsx` 和 renderer types 的 Symphony 数据、batch runner、GitHub/SSH/git helpers。**必须保留** 普通新会话、worktree、GitHub CLI 检测和 PR 能力。
- 测试：31 个候选，包括 `src/__tests__/integration/symphony.integration.test.ts`、handler/runner/fork、SymphonyModal；没有独立命名 E2E。
- 顺序：停 contribution 轮询/运行，摘 App 和创建会话的贡献字段，删 surface/IPC/runner，再拆 batch 依赖；远端 fork/PR 和本地 clone 不清理。

### 11. 旧界面

- 不是一个可整目录删除的包。主要分支在 `src/renderer/components/AppShell.tsx`、`App.tsx`、`SessionList/`、`MainPanel/`、`RightPanel.tsx`、`TabBar.tsx` 和 menu/keyboard/palette 中的 `newShell` 条件。
- **必须保留** 新界面也用的 `MainPanel/BrowserTabView.tsx`（`NewShellWebPanel.tsx` 直接引用）、`TiledLayout.tsx`/`PaneMissingTab.tsx`（`FilePreview/StoredFilePreview.tsx` 引用）、LogViewer、InputArea、文件树、终端、任务、预览、会话持久化和 renderer stores。项目/会话只是展示去掉“智能体层”，底层 owner Session 仍承载进程、账户、SSH 和权限。
- IPC 和 CLI 没有单独的 classic namespace。`settings get/set newShell` 是保留期内的切换入口；`tab`、`session`、`open-project` 等共用能力保留。完全退出旧界面后，需明确给旧开关返回兼容说明，不能悄悄变成未知设置。
- 设置和数据：`newShell`、`newShellChoice`，旧栏宽、右栏 tab、`sidebarNavigationMode` 等要逐字段识别；`maestro-settings.json`、`maestro-sessions.json`、窗口布局文件都是共享文件，不能删除整个文件。保留期不清理旧字段，以便回退。
- 测试：JSON 列出 18 个容器名称测试，仅专属经典分支断言才退出；整个 `e2e/` 不可按旧默认批量删除。所有 `native-new-shell*`、委派/交接/SSH、history、browser/web-desktop 和退出持久化回归保留。旧 fixtures 明确选择 classic，直到保留期结束。
- 顺序：用户确认默认切换并发布，至少使用一个版本，再取得删除决定。先抽取共享布局与控件，证明新界面不再依赖经典分支，然后删除条件分支与旧专属入口，最后退役开关；不进行数据销毁。

## 执行次序与验收门槛

1. 用户完成真人体验，明确默认切换是否合并；准备 PR 和删除 PR 分开。明确哪些功能及其独立 CLI 也退出，尤其 Pianola、run-doc/goal-run、统计查询。
2. 用 hb.7 发行包取得下节基线。保留来源 commit、包 SHA-256、平台和原始样本；没有真实包测量就不填“性能不退化”。
3. 先抽出共享引擎：群聊 spawn/parser、插件 MCP/security、统计用量和 history、Auto Run 模板与 dispatch。每次先加失败回归再移动实现，现有 UI/CLI 共用路径继续通过。
4. 逐项下线叶子功能：marketplace、Symphony、文档图谱、Director's Notes UI、使用量 UI；然后 playbooks、Auto Run/旧向导、群聊、Cue/Pianola。插件在 first-party 消费者解绑后处理。共享目录只删已证实无消费者的文件。
5. 每项同步移除 UI、快捷键、菜单、`UI_SURFACES`、IPC bootstrap/preload、WS bridge allowlist/callback、CLI 注册及 help/completions/reference、en 和 zh-CN 文案和专属测试。更新 CLI 对等表，通用入口继续测试；删除测试须对应实际退役功能，不能用删测试掩盖回归。
6. 旧界面最后处理，遵守默认切换后至少一个版本的保留期。设置/数据迁移与代码删除分离；不自动删配置、项目内容、原生历史、账户或 Keychain。
7. 每个删除 PR 跑完整类型、ESLint、Prettier、单元测试和合成 Electron；跨家、SSH、原生继续、停止恢复、重启、Web 手机形态继续验收。重新打包，使用同机同脚本同 N 的 baseline，比对 ZIP、bundle、asar 和启动中位数。失败时修正或回退该 PR，不通过改阈值宣称通过。

## C4 只读安装包基线

```sh
node scripts/hb-baseline.mjs /absolute/path/to/hb.7.zip --runs 5 > /tmp/hb7-baseline.json
node scripts/hb-baseline.mjs /absolute/path/to/Maestro.app --runs 5 > /tmp/app-baseline.json
node --test scripts/hb-baseline.test.mjs
```

只支持 macOS `.app` 或含一个顶层 `.app` 的可信发行 ZIP。ZIP 用系统 `ditto` 解到临时目录，以保留 Mach-O 执行位、framework 符号链接和签名；数据 ZIP 的 canonical extractor 不用于重建应用 bundle。原始包不写入。输入 `.app` 没有对应 ZIP 时 `zipBytes` 为 null，不现场压缩来伪造原发行包大小。bundle 大小为普通文件逻辑字节之和，不跟随符号链接，不等于磁盘分配块数。

每轮新进程、新 HOME、provider 空目录、XDG 目录和 `MAESTRO_DEMO_DIR`；不继承调用者的 token、账户环境或 Node 注入参数。macOS sandbox 禁止真实 home、Keychain 文件/daemon 和外网访问，仅给应用包和 Playwright loader 读权限。更新与崩溃上报关闭。脚本不启动 provider 或登录，也不复制真实账户。需要本机已有 Node、Playwright 依赖、`plutil`、`ditto`、`sandbox-exec` 和图形会话。

时间从调用 Electron launch 前开始，止于第一个窗口 `performance.timeOrigin + maestro:renderer.ready.startTime`，不把轮询发现标记的延迟算进去。它表示首窗 renderer 就绪，经典闪屏的后续淡出不计入；同一测量定义用于前后版本。冷启动只指新进程和空应用缓存，不清系统页缓存。记录 Playwright 与 sandbox 的额外成本，不能拿这个值同无仪器启动混比。超时/缺标记即失败，不跳过样本、不重试、不输出成功中位数；退出后清理临时目录。

**当前实测状态：尚未运行 hb.7 安装包，也未启动 Electron。** 单元测试只能验证参数、时间解析、尺寸统计、中位数和隔离环境；sandbox 策略与实际包启动仍需 Opus 在沙箱外验证。若沙箱策略阻止启动，保留失败结果并修正隔离规则，不能改用真实账户目录或解除账户隔离。
