# Q3 包验收场景交接

场景在 `native-windows-acceptance.spec.ts`，共 18 条。每条用例在启动前显式写入 `newShell: false`，只使用标准 `NativeApp`、合成 CLI、临时账户和临时应用目录。真实模式在创建夹具前跳过。没有修改 `docs/verification/`，没有新增或改动 UI 动作，因此没有新增 CLI 对等入口。

## 覆盖范围

- C6：3 条场景，每条遍历两个选中账户和标题、用户消息、助手回复三个字段，共 18 个矩阵格。进程默认账户放入同 UUID 的干扰记录。核对结果行、空结果、预览内容、恢复后的原生 ID、追加的文件和另一账户的字节不变。Codex 列表标题来自第一条助手回复，因此该标题也应命中助手搜索；后续用户消息和助手回复使用不同关键词。
- F3：标签菜单、命令面板各覆盖 Claude Code、Codex、DeepSeek 的六个方向。原对话足够长，必须省略三条旧记录并裁剪最后一条。独立计算保留尾部、字符数和 token 估算，核对上方说明可见且未被截断。检查实际进程启动日志、调用记录、活动进程和原生文件；编辑草稿后才发送，核对完整修改文本进入目标原生转录，以及源转录、日志和草稿不变。
- U7：两个窗口的合成工具分别等文件闸门；确认两个进程在运行，且提问已落盘后一起释放。DOM MutationObserver 记录回答出现时间，真实 input 事件记录草稿变化时间，四个时间都必须距离退出请求小于 2000 ms。核对磁盘，再保留真实窗口布局重启，逐窗口检查回答和草稿。时间证据为 Playwright 附件。
- U8：正常退出和更新退出各一条，均真正阻塞副窗口 renderer 15 秒，不注入替代保存监听。从主窗口操作到 Electron 关闭必须不超过 5000 ms。主窗口新草稿落盘，副窗口保留最后完成的记录；检查超时、具体未保存 renderer、真实 preload 回执和重启结果。更新场景调用真实 `window.maestro.updates.install()`，仅将包内 `electron-updater.quitAndInstall` 的外部安装动作替换成 `app.quit()`；保留产品的安装前回调、跳过确认逻辑和保存协调器，不下载或安装更新。

## 被回归测试证实的产品问题

旧流程先等 renderer 5000 ms，再加普通退出的 750 ms 或 macOS 更新退出的 2000 ms。新增两条单元回归在修改产品前失败：第 5000 ms 尚未调用 hard exit，且只有待保存窗口数量，没有具体未保存 renderer 的记录。

`src/main/app-lifecycle/quit-handler.ts` 为经典界面保留 750 ms 清理余量，renderer 等待上限为 4250 ms；保存期间已经消耗的时间计入退出宽限期，超时逐 renderer 记录未保存。`src/main/index.ts` 从现有设置实例读取开关。新界面保留原有时间策略，新增隔离回归明确检查其更新退出仍为 5000 ms 保存加 2000 ms 宽限期。`CHANGELOG.md` 添加一条中文修复说明。

## 本地验证

以下结果属于源码检查和单元测试，不能作为 Electron 场景通过记录。

```sh
npm run lint
npm run lint:eslint
npx tsc -p e2e/tsconfig.windows-acceptance.json --noEmit
npx prettier --check CHANGELOG.md e2e/native-windows-acceptance.spec.ts e2e/native-windows-acceptance.md e2e/tsconfig.windows-acceptance.json src/main/app-lifecycle/quit-handler.ts src/main/index.ts src/__tests__/main/app-lifecycle/quit-handler.test.ts
npm run test -- --configLoader native src/__tests__/main/app-lifecycle/quit-handler.test.ts src/__tests__/main/auto-updater.test.ts src/__tests__/main/preload/system.test.ts src/__tests__/renderer/services/quitSave.test.ts src/__tests__/renderer/hooks/utils/useDebouncedPersistence.test.ts src/__tests__/renderer/services/aiHandoffContext.test.ts src/__tests__/renderer/components/AgentSessionsBrowser/hooks/useAgentSessionsSearch.test.ts
npx playwright test --project=native e2e/native-windows-acceptance.spec.ts --list
MAESTRO_E2E_REAL=1 npx playwright test --project=native e2e/native-windows-acceptance.spec.ts --reporter=line
```

最终结果：类型检查、ESLint、Prettier 通过；7 个 Vitest 文件 242/242 通过；Playwright 列出 18 条；真实模式 18 条全部跳过且没有启动 Electron。编写期间修复过新增代码的数组类型、设置实例名和局部变量遮蔽问题。没有修改 `e2e/fixtures/`，所以未运行 `npm run test:e2e:fixtures`。

## Opus 执行

沙箱不能启动 Electron，开发构建和安装包场景均未运行。未对断言对应的真实页面行为声称通过。开发构建命令：

```sh
npm run test:e2e -- e2e/native-windows-acceptance.spec.ts
```

安装包使用已有 package runner，将标准夹具的 `electron.launch` 指向待验包，选择相同 spec。不要改用产品测试注入接口。分别记录源码提交、包版本和包身份。U7 的 `two-window-quit-timing.json` 和 U8 的 `quit-evidence.json` 是本地验收附件，包含临时路径的原始日志不进入公开提交。更新场景验证退出协议，不验证真实下载、安装器换包或更新后自动重启。

## 最小反证修改

下表每一行对应一个场景。只临时改产品，重新构建待验目标后运行该行；失败后撤销修改并恢复构建。以下修改均未提交，也未在本沙箱执行 Electron 反证。

| 场景                                       | 临时产品修改                                                                                                          | 应失败的断言                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| C6 title                                   | `src/renderer/hooks/agent/useFilteredAndSortedSessions.ts:136`，将标题分支条件中的 `'title'` 改为 `'all'`             | 标题搜索应返回一行                               |
| C6 user                                    | `src/renderer/components/AgentSessionsBrowser/hooks/useAgentSessionsSearch.ts:62`，将传入的 `searchMode` 改为 `'all'` | 用户模式不能命中仅在助手回复中的关键词           |
| C6 assistant                               | 同上                                                                                                                  | 助手模式不能命中仅在用户消息中的关键词           |
| F3 tab menu claude-code to codex           | `src/renderer/components/InputArea/components/HandoffDraftBar.tsx:48`，将 token 格式化结果改为 `'0'`                  | 草稿说明的具体大小                               |
| F3 tab menu claude-code to deepseek        | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 tab menu codex to claude-code           | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 tab menu codex to deepseek              | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 tab menu deepseek to claude-code        | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 tab menu deepseek to codex              | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 command palette claude-code to codex    | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 command palette claude-code to deepseek | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 command palette codex to claude-code    | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 command palette codex to deepseek       | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 command palette deepseek to claude-code | 同上                                                                                                                  | 草稿说明的具体大小                               |
| F3 command palette deepseek to codex       | 同上                                                                                                                  | 草稿说明的具体大小                               |
| U7                                         | `src/renderer/hooks/utils/useDebouncedPersistence.ts:606`，将 effect 内容临时改为 `() => undefined`                   | 退出日志不得出现保存超时；副窗口即时草稿必须保留 |
| U8 normal                                  | `src/main/index.ts:3228`，将 `getNewShellEnabled` 临时改为 `() => true`                                               | 超时窗口记录和 5000 ms 总预算                    |
| U8 update                                  | 同上                                                                                                                  | 超时窗口记录和 5000 ms 总预算                    |

进一步检查账户保护时，可临时去掉 `useAgentSessionsSearch.ts:64` 的 `ownerAgentId`，用户和助手模式应在结果或预览账户断言失败。没有发现授权覆盖本任务验收预期的后续决定，也没有放宽断言。
