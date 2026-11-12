# Codex app-server 运行通路原型

2026-11-11 后续结果：PR #77 的开发构建 `eab909e35` 已通过合成 app-server 及两条真实 Codex 工作负载，见 [真实验证记录](real-codex.md)。只覆盖 `codex-cli 0.167.0-alpha.3.2`，安装包、其他版本及完整协议未验证；下文原始“未运行”描述保留为当时事实。

核对日期：2026-11-07。本页记录协议依据和实现边界，不代表真实 Codex 或 Electron 验收通过。本次只使用合成协议输入，未启动真实会话，未读取个人登录、配置或历史。

## 开关与范围

原型要求同时开启 `newShell` 和默认关闭的 `codexAppServer`。开关关闭时，普通完全访问和只读对话的 `exec --json` 参数、解析和生命周期保持原路径。唯一的共享拒绝行为是：已保存为标准权限的 Codex 对话，若无法使用本地原型则拒绝启动，包括关闭开关、切到旧界面或 SSH，避免静默落入 exec 的跳过审批参数。这里的 app-server 是由 Maestro 管理的本地 stdio 子进程，不连接已运行的官方应用或共享 socket；没有连接失败后自动重发或改走 exec 的逻辑。

范围为新建或接续一条对话、发送一轮、流式回答及工具事件、命令和文件审批、本轮追加、停止。每轮启动独立 app-server，后续轮次用原 threadId 接续；不会保留空闲服务。原型只接普通用户对话，不接 Auto Run；自定义 CLI 参数被明确拒绝。原型不是完整 app-server 客户端；未支持的请求明确拒绝，不通过扩大权限让它继续。SSH 的既有 exec 通路不变，原型不对远程目录执行本地 `realpath`。

## 协议依据

官方 [App Server 文档](https://learn.chatgpt.com/docs/app-server) 确认默认 stdio 传输，以及 `initialize` 请求、`initialized` 通知、对话、回合和事件的顺序。每次连接只初始化一次。客户端必须继续读取 stdout；一条 RPC 响应不能代替整个回合结束。

| 用途     | 使用的字段或约束                                                                                                                                                           | 官方依据                                                                                                                                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新建对话 | `thread/start`；`cwd`、`model`、`approvalPolicy`、`sandbox`                                                                                                                | [ThreadStartParams](https://github.com/openai/codex/blob/680c4ba93ec79c292287fb9e0b627dc7a76e3b5e/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts)                                                                                                                    |
| 接续对话 | `thread/resume`；`threadId`、`excludeTurns`；不传可能改变对话来源的 history/path                                                                                           | [ThreadResumeParams](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeParams.ts)                                                                                                                                                      |
| 运行状态 | `thread.status.type` 为 idle、active、notLoaded 或 systemError；接续后只允许 idle 开新轮                                                                                   | [ThreadStatus](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStatus.ts)                                                                                                                                                                  |
| 发一轮   | `turn/start`；`threadId`、`input`、`cwd`、`model`、`effort`、`approvalPolicy`、`sandboxPolicy`                                                                             | [TurnStartParams](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts)                                                                                                                                                            |
| 沙箱     | thread 的 `sandbox` 是带连字符的枚举；turn 的 `sandboxPolicy.type` 使用 camelCase。readOnly 明确传 `networkAccess: false`；workspaceWrite 显式给出写根、网络与临时目录策略 | [SandboxMode](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/SandboxMode.ts)、[SandboxPolicy](https://github.com/openai/codex/blob/680c4ba93ec79c292287fb9e0b627dc7a76e3b5e/codex-rs/app-server-protocol/schema/typescript/v2/SandboxPolicy.ts) |
| 本轮追加 | `turn/steer` 的 `threadId`、`input` 和必需的 `expectedTurnId`；只接受返回的同一 turnId                                                                                     | [TurnSteerParams](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/TurnSteerParams.ts)                                                                                                                                                            |
| 回答增量 | `item/agentMessage/delta` 的 threadId、turnId、itemId、delta                                                                                                               | [AgentMessageDeltaNotification](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/AgentMessageDeltaNotification.ts)                                                                                                                                |
| 用量     | `thread/tokenUsage/updated` 的 tokenUsage；沿用仓库的每轮用量处理，不累加会话总量                                                                                          | [ThreadTokenUsageUpdatedNotification](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsageUpdatedNotification.ts)                                                                                                                    |

官方文档说明 `turn/steer` 不创建新回合，不接受 cwd、model 或 sandbox 等覆盖项；无活动回合或预期 ID 不匹配时应失败。`turn/interrupt` 响应 `{}` 只确认取消请求，最终仍以 `turn/completed` 的 interrupted 状态收尾。原型不把超时当作“未执行”，也不自动重发已提交的追加内容。[追加和中断](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn)

以上一部分字段来自固定提交 `680c4ba93ec79c292287fb9e0b627dc7a76e3b5e`，其余只能取得当前官方 main 文件。未取得 `0.166.0-alpha.6` 对应的完整 app-server schema，也未执行本机 schema 导出，因此该版的全部字段兼容性未确认。不能把文档核对或合成通过记成版本准入。

## 审批契约

`item/commandExecution/requestApproval` 和 `item/fileChange/requestApproval` 是带请求 ID 的服务端请求，需要回同一个 ID。请求的 threadId、turnId、itemId 只对应本轮。Maestro 的允许、拒绝决定映射为 `{ decision: "accept" }`、`{ decision: "decline" }`；不发送 acceptForSession 或策略修订。官方响应类型分别见 [命令响应](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionRequestApprovalResponse.ts)和[文件响应](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/FileChangeRequestApprovalResponse.ts)。

命令请求还可能包含 networkApprovalContext、kind、approvalId；不能把所有请求仅解释为一条 shell 命令。文件请求的 grantRoot 在官方源码仍标为不稳定，可能涉及会话余下时间的写根授权。原型对无法准确呈现的请求拒绝处理；它不声称覆盖网络授权、长期授权或所有 MCP 审批。[命令请求](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionRequestApprovalParams.ts)、[文件请求](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/FileChangeRequestApprovalParams.ts)

`serverRequest/resolved` 包含 threadId 和 requestId，代表请求已回答或已清理。结束、停止、断线和该通知都必须使迟到的界面答复无效。外层连接生成的请求标识与原始 RPC ID 分开，避免两条对话同时收到相同数字 ID 时串答。[ServerRequestResolvedNotification](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ServerRequestResolvedNotification.ts)

## 与共享连接器的关系

先前的 `scripts/codex-shared/` 已有 RPC 顺序、thread/turn 作用域、早到事件缓存，以及 `translateItem()` 到 Codex 现有事件形状的映射。本原型沿用该转换知识和已有 Codex 解析器，不另造一套工具卡格式。共享连接器本身的 `exec-adapter-v2.cjs`、官方应用共享 socket 和版本准入不因此改变。

现有 `protocol-surface.json` 只审计共享连接器使用的字段，未覆盖新建对话、steer 和审批响应的完整新增表面。它通过不代表本原型协议全部通过。后续发行前应扩展字段审计，按选定二进制导出的 schema 核对，并保留新通路与旧通路的分别验收记录。

## 实现和合成验证

回答增量走现有临时预览通道，完整进度和最终回答由完成项各自提交，避免把每个增量都保存成一条完整进度；工具项转换直接复用 `scripts/codex-shared/shared-exec.cjs` 的 `translateItem()`，继续走现有 Codex 输出解析器。用量只取 `tokenUsage.last`。两个转换器依赖文件已加入发行包文件清单，尚未打包验证。

审批使用现有 pending registry 和 PermissionPrompt。允许仅限本次，命令显示 command、cwd、reason，文件显示工具项里的变更；无法准确呈现的网络、额外权限或 grantRoot 请求拒绝。服务端解决请求、工具完成、停止和断线清理提示，并拒绝迟到答复。审批绑定启动时的用户和桌面窗口，只向该窗口投递。列举和响应共用归属校验；关闭窗口、请求结束后不能批准。浏览器审批明确拒绝，可信 CLI 以桌面用户及主窗口身份调用相同校验，暂不能选择其他窗口。Claude 的既有响应入口也校验相同归属。

本轮追加有独立按钮，与普通发送共用在途草稿登记。追加等待确认时，同一草稿不能通过发送按钮或 Enter 再排队，其他新草稿仍按原路径发送。仅文本追加，确认前不清草稿；确认后只有仍属于原对话且内容未变化的草稿才清空。失败不重试、不自动排队。主进程再检查实际 controller，运行中切开关不会把 exec 变成 app-server。停止先发准确的 turn/interrupt，等待终态，超时清理进程树；强制停止保留进程占位至 close，避免旧写入者未退出就启动下一轮。真实进程树仍需外部验证。

单元和组件测试覆盖双开关、本地限制、协议作用域、早到事件、审批唯一响应和失效、追加确认和草稿、取消及退出。合成可执行夹具通过真实 stdio 子进程完成允许与拒绝：审批前无标记文件，允许后只写一次，拒绝后不写。夹具只访问测试临时目录，不运行真实 Codex 或模型。Electron 脚本仅通过测试收集，未执行。

## 未确认和后续验收

- 真实模型的审批前不执行、允许一次执行一次、拒绝后不执行，以及原生权限策略的有效范围。
- 实际 CLI 版本、组织策略、账户配置及第三方包装器的兼容性。
- exec、app-server、官方应用依次接续同一原始对话时的写入互斥、历史与模型设置一致性。单进程 idle 检查不是跨客户端原子锁。
- 真实进程树中的后台工具和子进程是否完整停止，Windows、Linux 与 SSH 行为。
- 图片、MCP 提问、动态工具、细粒度权限和网络审批等未覆盖协议。
- Electron 展示、跨窗口审批归属、重启恢复和发行包内转换器打包。

需要 Opus 在沙箱外执行的合成 Electron 场景见 [验收步骤](../../e2e/codex-app-server-prototype.md)。真实会话验收需要另行授权，本轮不执行。

## 审查修复补充：任务清单协议（2026-11-07）

原型启动保留 `app-server -c tools.update_plan.enabled=true`，仅在原型分支添加，
exec 分支参数不改。`0.166.0-alpha.6` 的官方
[CLI 参数收集](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/cli/src/config_override_args.rs)、
[app-server 配置加载](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/app-server/src/lib.rs)
确认命令行配置进入服务器配置；同版本的
[核心配置解析](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/core/src/config/mod.rs)
通过 `tools.update_plan.enabled` 决定是否启用任务工具。这是源码依据，未运行真实二进制验证。

[官方回合事件说明](https://learn.chatgpt.com/docs/app-server#turn-events)将结构化
`turn/plan/updated` 与普通 `plan` 文本项分开。当前 main 的
[通知类型](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/TurnPlanUpdatedNotification.ts)
及[状态枚举](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/TurnPlanStepStatus.ts)
确认通知带 threadId、turnId、explanation 和完整 plan，状态为 pending、inProgress、completed。
本次获取对应版本标签下的这两个 schema 文件失败，因此该版本完整通知契约仍未确认。

实现校验当前 threadId 和 turnId，拒绝缺失作用域及畸形快照，通过既有 `translateItem()`
映射为 `update_plan` 工具调用和结果，复用 Codex 解析器及任务面板，保持稳定清单 ID。
inProgress 转成已有 in_progress，空快照可清空清单。普通 plan 文本不冒充任务事件。
合成夹具提供计划通知；真实 stdio 单测验证任务输入、三个状态和工具结束事件。
Electron 场景增加项目标准权限新建、追加确认前 Enter 防重及右栏清单从 1/3 到 3/3。

有效标准权限统一由 shared 的 `effectiveStandardPermissionCapability()` 判断。
咨询显式禁用原型能力。已由 Codex 运行过的标准对话保留其保存模式，关闭原型后恢复
也由既有启动检查拒绝；旧工具切换产生、尚未运行的标签仍保留原先收紧权限的规则。
