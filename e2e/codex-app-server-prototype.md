# Codex app-server 原型的沙箱外验证

2026-11-11 后续结果：PR #77 的开发构建 `eab909e35` 已通过合成 app-server 及两条真实 Codex 工作负载，见 [真实验证记录](../docs/verification/real-codex.md)。只覆盖 `codex-cli 0.167.0-alpha.3.2`，安装包、其他版本及完整协议未验证；下文原始“未运行”描述保留为当时事实。

本文件是交给 Opus 的待执行清单。本轮仅收集了 `native-codex-app-server.spec.ts`，没有启动 Electron，也没有运行真实 Codex 会话。

## 合成 Electron 场景

在任务源码根目录运行：

```sh
MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-codex-app-server.spec.ts --workers=1 --retries=0
```

脚本重建 main、renderer、CLI，再运行 native 项目。测试创建独立临时 HOME、Maestro 数据目录和提供方目录，设置 `newShell=true`、`codexAppServer=true`，关闭自动命名及自动摘要。唯一提供方可执行文件是 `e2e/fixtures/native/codex-app-server`，它只读写指定临时夹具目录和 stdio，不调用模型、真实 CLI 或网络。本场景在 `MAESTRO_E2E_REAL=1` 时文件级跳过，不读取真实账户。

自动化覆盖顺序：

1. 通过 CLI 将项目默认权限设为标准，新建 Codex 对话，断言仍为标准。第一次发送必须为 thread/start，后续三次为同一 threadId 的 thread/resume。
2. 文件审批显示 Codex、文件路径和差异。审批前不存在标记文件；精确点击新界面的 `Allow once` 后存在，内容为一行合成数据。
3. 命令审批通过 `codex-turn permissions` 取得 requestId，再用 `permission-respond <request-id> deny` 拒绝。弹窗消失，没有标记文件。
4. 发送带合成计划通知的保持运行回合，右栏任务为三项，完成数 1/3 且一项进行中。输入追加文字并点击本轮追加，夹具等待临时文件放行；等待期间按 Enter，草稿仍在且发送按钮禁用。放行后回答含原文，草稿清空，任务变为 3/3；协议记录中只有一次 turn/steer。
5. 确认追加回合的停止按钮已经消失，再发一轮保持运行的合成任务。等待第四次 turn/start 到达夹具，用 `codex-turn stop <process-id>` 停止，返回必须为成功。协议记录必须有 turn/interrupt，待审批列表为空，停止按钮消失且目标进程不在活动列表中。
6. 总计一条 thread/start、三条 thread/resume、四条 turn/start、一条 turn/steer。断言失败后保留 NativeApp 的失败 trace，先分析，不自动重试。

该夹具未生成真实原生转录，因此此脚本验证活动对话接续，不验证应用重启后从原生历史恢复。

## U4 第五轮：区分场景失败与停止失败

合并后的新界面审批按钮叫 `Allow once`，原场景仍精确查找旧界面的 `Allow`。
单元回归将场景里的实际定位器用于真实审批组件，修复前报找不到 `Allow`，修复后通过。
另一个单元回归执行场景回调并注入早期失败，确认旧清理路径会把原错覆盖为停止按钮计数失败。
独立 Playwright 探针也确认：断言抛出后，进入 `finally` 时 `info.status` 仍可能是 `passed`。
场景现在用完成标记选择失败清理，保留 trace；全部断言完成后仍走正常关闭及其空闲断言。

没有改动 `CodexAppServerSession`、审批注册表或 Claude 清理路径。
合成 stdio 测试经过真实 `ProcessManager.interrupt()`、原型控制器、审批适配器和进程退出处理，
保持运行与等待文件审批两种情况下都收到一次中断并以 130 退出，待审批清空且没有批准文件。
测试仅替换环境构造、Electron socket 路径、PTY 和进程树枚举；真实子进程仍需退出。
这不能代替外部 Electron 复测，也不能证明此前外部运行已经到达中断步骤。

Opus 请重新构建后一次运行原型和 Claude 的 11 条审批场景，不自动重试：

```sh
MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-codex-app-server.spec.ts e2e/native-claude-permission.spec.ts --workers=1 --retries=0
```

若停止断言仍失败，保留本次运行的 trace 和临时夹具 receipts，核对第四次 turn/start 与 turn/interrupt
是否属于同一回合，并记录 `process:exit` 和 renderer 异常。不要以另一轮运行的回执代替。

## 仍需人工检查的合成场景

沿用同样的临时测试应用和夹具，不操作已安装的日常应用：

- 中文和英文分别检查设置说明、Codex 审批标题、完整命令作用目录及文件差异、本轮追加按钮和失败提示。切换语言不清空输入草稿。
- 在追加请求未确认时继续编辑草稿或切换对话。原请求确认后不能清掉新草稿；请求失败保留原文，不排队、不重发。组件回归已覆盖这三项，Electron 尚未执行。
- 主窗口等待审批时停止，弹窗应消失；随后对旧 requestId 执行允许应失败，不写文件。强制停止要确认旧进程退出后才允许下一轮，不能只看界面变为 idle。
- 开关组合 `false/false`、`true/false`、`false/true` 不显示原型控制，普通完全访问和只读对话继续既有 exec 通路。对保存的标准权限对话应明确拒绝，不能回退到跳过审批。
- 运行中切开关，再点击追加，主进程拒绝对旧 exec 进程发送 RPC，草稿保留；现有 app-server 进程仍可停止。
- SSH 普通完全访问和只读使用既有 exec 路径；标准权限拒绝。只核对模拟主机参数，真实 SSH 不属于本轮已验范围。

## 原型未覆盖

主窗口以外审批的 Electron 展示、浏览器明确拒绝的完整端到端验证、强制并行回合、多客户端并发写同一原生对话、图片、网络授权、MCP 提问和动态工具均未完成验收。`codex-turn stop` 仅停止指定进程；界面 Stop 额外取消队列与咨询的完整对等仍在 CLI Open gaps 中。真实 CLI 版本兼容性、模型是否遵守审批和沙箱、跨平台进程树清理、发行包内转换器加载需要另外验证，本轮不执行真实会话。

## 停止断言的后续边界（2026-11-11）

PR #75（`b4a0d4e64`）只修正 `src/__tests__/main/process-manager/codex-app-server-stop.test.ts`：检查控制器实际发出的 `turn/interrupt`，避免等待审批时对端先处理拒绝并退出、来不及记录中断的竞态，仍要求进程退出和审批清空。它没有修改本文件对应的 Electron 场景，不能据此宣称最新集成 Electron 通过。

PR #73 的 `tab stop` 已与界面完整停止共用实现，新界面只清理目标对话队列与咨询；`codex-turn stop` 仅中断指定进程。11 月 11 日记录的合成通过和真实结果对应 `eab909e35`，不代表当前合并提交或所有新增停止场景，集成后需重跑。
