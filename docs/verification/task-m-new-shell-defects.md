# Task M：新界面缺陷验证（2026-11-12）

验证对象是 `codex/new-shell-defects` 基于 `1d9ed9c9f` 的本次源码改动，不是安装包。范围为原计划审计 A1、A14、B3、B6。未推送、发布或启动 Electron；未读取真实工具账户或凭据。所有场景均使用合成提供方或临时数据。

## 改动与边界

| 审计项 | 实现与文件                                                                                                                                                                                                                                                        | 验证范围                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1     | `AppShell.tsx`、`TerminalView.tsx` 把终端实例保留在外壳布局之外，布局交换 DOM 插槽，继续使用同一个 xterm 缓冲区、PTY 监听、读回与重绘。隐藏实例保持尺寸，关闭标签或移出窗口时释放。两种语言的开关说明同步更新。                                                   | 从新、旧两种起点切换均保留实例；临时无插槽与关闭清理有单元覆盖。真实终端屏幕、PID、运行回合和草稿由 Electron 场景覆盖，尚未实跑。没有新增输出存储。 |
| A14    | `TerminalOutput.test.tsx` 增加新界面覆盖；生产代码已通过 `errorOffersHandoff()`、`requestAiHandoff()` 与顶栏共用交接，未改动此路径。                                                                                                                              | `rate_limited`、`auth_expired` 有入口，其余错误无入口。Electron 比较顶栏与卡片的目标、准备原失败请求草稿并发给同 cwd 的 Codex，尚未实跑。           |
| B3     | `NewShellWebPanel.tsx`、`newShellWeb.ts` 与两份 `workflowsShell.ts` 增加单行主题色说明；提取并复用已有本机地址判断。                                                                                                                                              | 新界面开关、SSH 是否启用、localhost、127/8、IPv6 回环和外部地址条件；Electron 用假的 SSH 配置，不连接主机。                                         |
| B6     | `project-settings.ts`、persistence IPC、preload、`ProjectSettingsModal.tsx`、`sessionToolConfig.ts`、共享字段白名单与 CLI。先验证全部修改，在同一会话写入队列内一次保存全部工具并等待落盘，再保存默认值；失败恢复所有已尝试写入的部分，提交完成后才同步配置补丁。 | 各写入阶段失败、非法工具、非法值、运行中 SSH、切换外壳时失败、无默认值键时失败、提交后通知失败、renderer 保留草稿、CLI 单次组合调用与本地化错误。   |

B6 的多工具事务只在新界面开启时接受，旧界面继续走原保存路径。事务开始时固定开关状态，切换外壳不会中断回滚。同步补丁只更新配置，保留实时回合、日志与草稿。单项 `update-agent` 仍使用已有保存服务和同一字段白名单，未复制保存工具。

回滚是进程内补偿事务，不是跨文件崩溃日志。若磁盘持续失效导致回滚写入也失败，会明确返回 `rollbackFailed`，并继续尝试恢复另一份存储；没有声称这种情况下也能保证磁盘原子性。进程在两份存储写入之间被强制终止的恢复未覆盖。

## 先失败后修复

- A1：新增从 classic/new 两种起点切换的回归，修复前 2 项丢失原 xterm 实例和内容。首轮测试还暴露 4 项测试状态串扰，已通过每例重置 store 隔离，没有放宽断言。
- B3：SSH 的 localhost、127.0.0.1、IPv6 三项提示断言在修复前失败。
- B6：首次新增的会话写入、落盘、设置写入失败与全部校验前不写入共 4 项失败；CLI 组合参数回归 1 项失败。随后提交后通知失败 1 项、保存期间切换外壳与非法枚举 3 项、畸形 CLI JSON 的中英文错误 2 项先失败后修复。
- A14：原实现已满足入口共用要求，只扩展覆盖，没有虚构失败或改写正确逻辑。

没有跳过、放宽既有断言或添加重试。新增 Electron 场景在真实模式下按要求 `test.skip`，在构造 `NativeApp` 之前生效。

## 最终命令与结果

以下生产检查均退出 0：

```sh
npx tsc -p tsconfig.json --noEmit
npm run lint
npm run lint:eslint
```

`lint` 包含 renderer/web lint 配置、main 与 CLI 的 TypeScript 检查。改动暂存后执行以下格式与空白检查，均退出 0：

```sh
git diff --cached --name-only -z | xargs -0 npx prettier --check
git diff --cached --check
```

相关 Vitest 共 14 文件、751 项通过，0 失败、0 跳过：

```sh
npx vitest run \
  src/__tests__/renderer/components/TerminalView.test.tsx \
  src/__tests__/renderer/components/ProjectSettingsModal.test.tsx \
  src/__tests__/renderer/components/TerminalOutput.test.tsx \
  src/__tests__/renderer/components/NewShellWebPanel.test.tsx \
  src/__tests__/renderer/components/AppShell.test.tsx \
  src/__tests__/renderer/components/Settings/tabs/DisplayTab.test.tsx \
  src/__tests__/renderer/services/sessionToolConfig.test.ts \
  src/__tests__/renderer/services/aiHandoffEntry.test.ts \
  src/__tests__/renderer/hooks/useSettings.test.ts \
  src/__tests__/main/project-settings.test.ts \
  src/__tests__/cli/commands/project-settings.test.ts \
  src/__tests__/main/ipc/handlers/persistence.test.ts \
  src/__tests__/main/preload/settings.test.ts \
  src/__tests__/main/web-server/handlers/bridgeHandlers.test.ts \
  --configLoader runner --reporter=dot
```

最初的默认 Vitest 配置加载因共享 node_modules 的 `.vite-temp` 写权限失败；使用 Vite 的 runner loader 后运行成功，没有改依赖或沙箱权限。输出保留已有 React act、样式告警及故意注入失败的日志，不把这些日志算成测试失败。

只收集 Electron 场景，退出 0，共 4 文件、5 项，没有启动 Electron：

```sh
npx playwright test \
  e2e/native-new-shell-toggle.spec.ts \
  e2e/native-new-shell-error-handoff.spec.ts \
  e2e/native-web-preview.spec.ts \
  e2e/native-project-tool-config.spec.ts \
  --project=native --list
```

另外运行 `npx tsc -p /tmp/task-m-tsconfig-e2e.json --noEmit`，退出 0。临时配置继承仓库 `tsconfig.json`，仅包含以上 4 个场景及 renderer/global 和 src/types 声明；Node 场景使用 ES2023、allowJs 以推断已有 CJS 夹具的导出、checkJs=false，保持 strict 检查。最初临时配置缺少全局声明、CJS 推断与新版 Node lib，已修正该配置，未修改夹具或降低 TypeScript 场景检查。未改 `e2e/fixtures`，因此没有运行 `npm run test:e2e:fixtures`。

## Opus 沙箱外运行

```sh
MAESTRO_E2E_REAL=0 npm run test:e2e -- \
  e2e/native-new-shell-toggle.spec.ts \
  e2e/native-new-shell-error-handoff.spec.ts \
  e2e/native-web-preview.spec.ts \
  e2e/native-project-tool-config.spec.ts \
  --project=native --workers=1 --retries=0
```

这 5 项包括已有网页预览与项目工具配置场景，新增的断言检查双向切换、额度交接、SSH 地址说明、非法组合保存不改状态以及成功组合保存重启后读回。未验证 Electron 运行结果、真实模型、真实 SSH、安装包或真人全天使用。
