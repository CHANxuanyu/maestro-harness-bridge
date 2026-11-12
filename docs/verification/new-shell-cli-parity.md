# Task L：新界面 CLI 对等

范围：原计划 A20、B2、B5 指定的八项 CLI 缺口。基于 `1d9ed9c9f` 的工作分支，
没有发布、推送或构建安装包。所有测试使用合成状态或临时目录，不读取真实提供商账户。

## 实现

- `src/cli/commands/new-shell.ts` 集中注册 Commander 选项并发送已确认的所属窗口动作。
- `native-history.ts`、`tab.ts`、`open-modal.ts` 接入原有命令树，帮助文字在 en 和 zh-CN 同时维护。
- `newShellCommands.ts` 调用原有历史定位、刷新、任务归一化、会话创建、分屏及队列服务。
- 左栏搜索与项目设置使用窗口内共享状态；设置窗口仍由 `UI_SURFACES` 和 `openUiSurface()` 打开。
- 主进程验证回执来自目标窗口。仅凭队列项 ID 发送时先查询各窗口实时归属，再向唯一所属窗口发送一次。
- 新界面库存读取等待各应用窗口的既有持久化刷新，并附主窗口的实时 `current` 标记。

## 先失败的回归

1. `newShellCliParity.test.ts` 首轮八个用例全部失败：每个动作都没有所需回执或状态变化。实现后通过。
2. `openNativeHistorySearchHit.test.ts` 的不存在 UUID 用例先失败，实际返回 `true`；修复后拒绝误跳。
3. CLI `--provider --split` 用例先失败，原实现拒绝该组合；接入同一创建路径后通过。
4. 窄窗口分屏用例先失败，先创建了对话；共用宽度预检后在创建前拒绝。
5. 消息跳转状态被界面先消费的用例先失败；定位服务直接交回消息身份后，回执不再依赖临时 UI 状态。
6. 中文强制发送拒绝原因先返回英文，新增回归 1 项失败、30 项通过；把排队卡片的翻译收回共享提示函数后，CLI 和卡片返回相同文案。

默认 `npx vitest run` 首次被工作区外的依赖符号链接写权限阻止，属于启动失败，
不算回归失败。之后用 `--configLoader native` 执行相同 Vitest 配置，没有跳过测试、
放宽断言或增加重试。空状态测试使用面板已有的完整文案；无目标队列测试构造没有任何可接收标签的状态，保留共享服务原有的目标回退规则。

## 执行命令与结果

以下检查针对本任务的最终源码工作树，不代表安装包或真实模型验收。

| 命令                                                                  | 结果                                                |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `npx tsc -p tsconfig.json --noEmit`                                   | 退出码 0                                            |
| `npm run lint`                                                        | 退出码 0，包含 lint、main、cli 三份 TypeScript 配置 |
| `npm run lint:eslint`                                                 | 退出码 0                                            |
| `git diff --name-only -z HEAD \| xargs -0 npx prettier --check`       | 所有改动文件通过                                    |
| `git diff --check`                                                    | 通过                                                |
| 下列 Vitest 命令                                                      | 26 文件、1,074 项通过，0 失败、0 跳过               |
| `npx playwright test --list e2e/native-new-shell-cli-parity.spec.ts`  | 收集 1 文件、1 场景，没有启动 Electron              |
| `MAESTRO_USER_DATA=/tmp/maestro-task-l-cli npm run gen:cli-reference` | 退出码 0，使用隔离临时设置目录生成参考文档          |

完整的相关单元测试命令：

```bash
npx vitest run --configLoader native \
  src/__tests__/cli/commands/new-shell.test.ts \
  src/__tests__/cli/commands/tab.test.ts \
  src/__tests__/cli/commands/native-history.test.ts \
  src/__tests__/cli/commands/queue.test.ts \
  src/__tests__/cli/commands/session.test.ts \
  src/__tests__/renderer/hooks/remote/newShellCliParity.test.ts \
  src/__tests__/renderer/hooks/remote/newShellSplitRemote.test.ts \
  src/__tests__/renderer/hooks/useQueueHandlers.test.ts \
  src/__tests__/renderer/hooks/useNativeHistorySearch.test.ts \
  src/__tests__/renderer/services/openNativeHistorySearchHit.test.ts \
  src/__tests__/renderer/services/newShellSplit.test.ts \
  src/__tests__/renderer/services/quitSave.test.ts \
  src/__tests__/renderer/components/SessionList/ProjectSessionSidebar.test.tsx \
  src/__tests__/renderer/components/QueuedItemsList.test.tsx \
  src/__tests__/renderer/components/ExecutionQueueBrowser.test.tsx \
  src/__tests__/renderer/utils/executionQueue.test.ts \
  src/__tests__/renderer/utils/openUiSurface.test.ts \
  src/__tests__/renderer/utils/agentTaskList.test.ts \
  src/__tests__/renderer/stores/uiStore.test.ts \
  src/__tests__/main/web-server/callbacks/newShellCliParity.test.ts \
  src/__tests__/main/web-server/callbacks/sessionCrudCallbacks.test.ts \
  src/__tests__/main/web-server/web-server-factory.test.ts \
  src/__tests__/main/web-server/handlers/messageHandlers.test.ts \
  src/__tests__/main/web-server/managers/CallbackRegistry.test.ts \
  src/__tests__/main/preload/process/sessionCrudRemote.test.ts \
  src/__tests__/shared/uiSurfaces.test.ts
```

改动文件全文扫描未发现 U+2013 或 U+2014。未改动 `e2e/fixtures/`，因此未运行
条件要求的 `npm run test:e2e:fixtures`。没有提交原始测试日志、私人对话或账户目录。

## 待 Opus 在沙箱外执行

```bash
MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-new-shell-cli-parity.spec.ts --workers=1 --retries=0
```

场景使用临时账户和合成提供商，真实模式通过 `test.skip` 跳过。覆盖搜索框、旧历史
补载及回合展开闪烁、任务 JSON 与面板、设置窗口开关、两窗格、强制发送、刷新，以及
界面切换后立即读取当前标签。此处未启动 Electron，不宣称场景通过。

限制：内容搜索沿用本机限制；忙碌、排队或身份变化的历史刷新明确拒绝。创建期间若
窗口消失或布局持久化失败，命令报告失败，已经创建的对话不作破坏性撤回。经典界面
保留原有行为。本任务未包含子任务树折叠、真实 Codex/Claude 任务清单或安装包验收。
