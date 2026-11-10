# Codex 真实账户验证

本说明对应 `e2e/real-codex-app-server.spec.ts` 和 `e2e/real-codex-orchestrator.spec.ts`。
两条默认跳过，只有 `MAESTRO_E2E_REAL=1` 才执行。编写阶段未运行 Electron 或真实模型，不能据此认定版本兼容或验收通过。

## 隔离和准备

由 Opus 在沙箱外运行，每次执行会消耗真实账户额度。使用本地官方 CLI 的绝对路径，不使用共享连接器、TUI 包装器或合成 CLI。

- 必填 `MAESTRO_E2E_CODEX_PATH`、`MAESTRO_E2E_CODEX_MODEL` 和环境凭据 `CODEX_API_KEY`。
- 主控场景另需 `MAESTRO_E2E_CLAUDE_PATH`、`MAESTRO_E2E_CLAUDE_MODEL` 和 `ANTHROPIC_API_KEY`。
- 可选 `MAESTRO_E2E_CODEX_EXPECT_VERSION`，填写完整的 `codex-cli <version>`。未提供时记录实际版本，不声称版本准入。
- 本套只支持环境 API 凭据，不读取现有登录文件或钥匙串，不使用 `inheritCodexHome`、`realCliFor()` 或 `createAgent()` 的账户发现逻辑。需要订阅登录验证时另写隔离方案，不能直接切回真实 HOME。
- 从没有 `MAESTRO_CALLER_*` 的独立终端启动。夹具发现继承的调用方标识就失败；父子身份必须由应用注入。不要在命令前手工补这些变量。
- HOME、USERPROFILE、项目、应用数据、Codex 和 Claude 账户目录全部位于 `createNativeTempDir()` 创建的临时根目录。只对这些临时数据写入和清理；凭据经子进程环境传递，不保存进配置或命令参数。
- 关闭自动命名、历史摘要和崩溃上报。Codex 测试账户禁用 apps、plugins、hooks、多代理和网络重连，API 请求与流重试设为 0。Playwright 重试为 0；场景不重新提交失败提示词。

先在当前提交构建，准备好上述环境变量后，再逐条运行。不要用整个 `electron` 项目的测试集代替这两个文件。

```sh
npm run build
MAESTRO_E2E_REAL=1 npx playwright test e2e/real-codex-app-server.spec.ts --project=electron --workers=1 --retries=0
MAESTRO_E2E_REAL=1 npx playwright test e2e/real-codex-orchestrator.spec.ts --project=electron --workers=1 --retries=0
```

只收集场景，不启动应用：

```sh
MAESTRO_E2E_REAL=0 npx playwright test e2e/real-codex-app-server.spec.ts e2e/real-codex-orchestrator.spec.ts --project=electron --list
```

## 请求数量与断言

| 场景       | 主动发出的真实工作                                                                      | 必须看到的结果                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| app-server | 4 次 Codex 回合提交，分别为问候、拒绝写入、允许写入并追加、停止；另有 1 次 `turn/steer` | 第一轮完成；拒绝后文件不存在且正常结束；允许后内容逐字相同；追加标记出现在本轮回答；停止后退出码 130、进程 PID 消失、停止按钮和审批消失 |
| 主控       | 1 次 Codex 父回合，父工具调用中仅派发 1 次 Claude 子回合，无完成回调                    | 子任务在左栏嵌套于父对话；主进程报告子进程运行；子回合成功退出；父最终回答引用随机 README 首行                                          |

这些是应用层提交次数，不是固定的计费 HTTP 次数。模型执行工具后还会继续请求，追加也可能触发续推；实际 HTTP 数量由模型和 CLI 决定，不能保证恰好为 4 或 2。轮询 Maestro 本身不调用模型。

真实模式下 `NativeApp.send()` 会替换提示词，本套直接填写输入框。运行状态来自 `window.maestro.process.getActiveProcesses()` 和退出事件，不读持久化文件里的 idle 字段。

app-server 场景同时启用 `newShell` 和 `codexAppServer`，只测本机标准权限。审批目标位于临时项目的 `.git/maestro-real-approval.txt`，这是工作区写权限的受保护目录；普通项目文件或 `/tmp` 下的兄弟目录可能无需审批。提示要求只用 `apply_patch`，拒绝后不换工具、不重试。CLI 若拒绝该任务或没有弹出审批，场景应失败，不能预先写文件或改成完全访问。

允许写入后模型执行 `sleep 20`，观察到真实命令开始才点击“本轮追加”。追加标记只出现在追加消息中；断言最终回答与协议确认的回合 ID，不能只凭草稿清空判成功。停止轮用 `sleep 120` 确保在命令开始后点击停止，并核对原生进程 PID 已退出。

主控场景启用新界面，关闭 app-server 原型，验证 Codex 完全访问的既有 exec 通路。README 首行每次随机生成，父提示词不含答案。父通过当前构建的 `maestro-cli dispatch --new-tab` 派发，并通过 `session show` 读取结果。Claude 子任务先短暂等待，再用 Read 读取首行，便于观察真实运行状态。测试既不代替父对话派发，也不伪造来源环境。

## 协议差异与失败记录

`codex-wire.json` 附件记录实际 CLI 版本、模型、控制器接收和发送的消息以及进程事件。观察器包裹现有 `CodexAppServerSession` 的消息边界，仍逐次调用原实现，不制造响应，不修正字段。成功与失败均尝试保存附件；失败保留 NativeApp 截图和 trace。主控场景保存两个工具版本及父子回答、退出和工具事件。

与合成夹具 `e2e/fixtures/native/codex-app-server` 和控制器单元测试核对时，至少填写以下差异：

| 位置              | 当前实现与场景要求                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| thread 创建和恢复 | `result.thread.id`，`result.thread.status.type = idle`，恢复保持原 thread ID                                                |
| 回合创建          | `result.turn.id`；本次运行恰好 4 个 `turn/start`                                                                            |
| 文件审批          | 带 ID 的 `item/fileChange/requestApproval`，threadId、turnId、itemId 对应本轮，已有文件变更项；回答为 `decline` 后 `accept` |
| 追加              | `turn/steer` 使用 expectedTurnId，响应 turnId 与它相同；不另开回合                                                          |
| 停止              | `turn/interrupt` 指向当前回合；终态和进程退出按实际记录检查                                                                 |

失败时记录源码提交、构建、系统、CLI 版本、失败阶段、预期字段、实际字段或错误，以及是否发出模型请求。比如出现 `grantRoot` 或缺失 changes，应报告真实字段与合成夹具的差异，不删除审批断言。认证、额度、模型拒绝、工具选择或超时也要分别记录，不能都归因于协议。

附件可能包含提示词、工具输出和临时路径，只留在本地验收输出，不提交原始捕获或账户材料。测试结束清理临时账户与项目；强制杀掉整个测试运行器时，需要 Opus 检查并清理该次临时根目录。

## 边界

本套没有新增界面动作或 CLI 动词，既有对应关系见 [CLI 对等表](../agent-guides/CLI-UI-PARITY.md#codex-app-server-prototype-2026-11-07)。不覆盖 SSH、订阅登录、其他平台、浏览器、多窗口、重启恢复、所有协议字段或任意脱离父进程的后台工具。旧界面和产品实现均未修改。一次通过只证明所记录版本、账户模式与这两个工作负载。
