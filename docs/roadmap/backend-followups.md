# 后端第二阶段计划

状态：待 Codex 实施。2026-10-24 起草，用户已确认第 1 至 7 项全部由 Codex 完成，无需再等审阅；本阶段结束后由原生 Claude Code Opus 接手前端。

本计划接续[信息流后端改进计划](backend-reliability.md)。上一阶段修复了 Codex 一侧的工具输入、失败与取消状态、回合收束和退出事件完整性。本阶段补上 PR 收尾、Claude Code 的同类缺口，以及上一阶段推迟或没有覆盖的后端项。每项依据都已在代码中确认，行号以 `codex/backend-reliability` 的 `8d01b54` 为准；实施时发现与代码不符，以代码为准并在完成记录中说明。

## 工作清单与验收目标

### 1. 合并 PR #3

- **依据：** [PR #3](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/3) 仍是草稿。2026-10-24 检查时，Linux 两个分片、`lint-and-format`、`HB release policy` 已通过，Windows 两个分片仍在运行。
- **做法：** 等待六项检查。失败时先找根因再修，不跳过测试、不放宽断言、不推空提交重跑；只有确认是基础设施中断，才按[发布管理](../release-policy.md)有记录地重跑一次。全部通过后转为正式 PR，确认基于最新 `codex/i18n-zh-cn` 后合并，再确认主线合并提交的 CI。
- **验收：** PR #3 已合并，主线对应提交六项检查通过。第 2 至 7 项从合并后的主线新建 `codex/backend-followups` 实施。

### 2. Claude Code 历史读取保留工具结果

- **依据：** `src/main/storage/claude-session-storage.ts` 的 `readSessionMessages()` 只收集 assistant 消息里的 `tool_use` 块（约第 848 行）。结果写在随后 `type: 'user'` 消息的 `tool_result` 块中，被整体丢弃，只含工具结果的消息也被跳过。实时解析带有输出和失败状态，重新打开后工具卡只剩输入。
- **做法：** 沿用 Codex 存储处理 `function_call_output` 的方式：按 `tool_use_id` 把结果写回对应 `tool_use` 块的 `state.status` 与 `state.output`，在分页切片之前完成配对。输出内容复用 `claude-output-parser.ts` 现有的 `flattenToolResultContent()`，不另写一份。渲染层 `normalizeToolUse()` 已读取 `state.status` 和 `state.output`，前端无需修改。找不到对应调用的结果保持现状，不生成卡片，也不当作正文。
- **验收：** 同一合成转录经实时解析和重新读取后，每个调用的输入、输出、成功或失败一致，调用 ID 不变；同一消息中的多个并行调用与结果分别对应；`total`、分页和消息顺序不变；本地和 SSH 读取走同一配对逻辑；读取不改写转录文件。

### 3. Claude Code 停止时的工具状态

- **依据：** `src/main/parsers/claude-output-parser.ts` 第 551 行只按 `is_error` 区分成功和失败。用户中断时 Claude Code 写入一条 `is_error: true` 的中断结果，实时和（第 2 项完成后的）历史都会显示“失败”，而 Codex 已能显示“已停止”。渲染层 `settleRunningToolEntries()` 只处理仍在运行的调用，纠正不了解析器给出的失败。
- **做法：** 先从官方 Claude Code 包的源码常量或真实转录确认中断结果的确切原文，再仿照 `codexToolResultStatus()` 新增一个导出的状态函数，由解析器和第 2 项的历史配对共用。只对确认过的原文做完整匹配。
- **验收：** 中断的调用在实时和历史中都是 `canceled`；普通失败仍是失败；输出里提到 interrupted、取消等字样的普通结果不被误判；Stop 后旧进程隔离和会话 ID 保持的既有回归通过。

### 4. 历史消息带上每轮模型与思考等级

- **依据：** `src/main/agents/session-storage.ts` 的 `SessionMessage` 没有模型和思考等级字段，重新打开的历史只能显示“未知”。原生记录里其实有：Codex 每轮的 `turn_context` 记录模型和思考等级（字段名以真实文件为准），Claude Code 的 assistant 消息有 `message.model`。
- **做法：** 给 `SessionMessage` 增加可选的 `model` 和 `effort`，取原生记录中的原值，不翻译，不用当前设置补。Codex：扫描时记住最近一次 `turn_context`，写到其后产生的 assistant 侧消息（正文、推理、工具）；只读增量读取要随缓存前缀保存这份状态。Claude Code：assistant 消息写入 `message.model`，跳过 `<synthetic>`（解析器已有同样的排除）；转录里没有思考等级就保持缺省。
- **验收：** 同一会话中途换模型或思考等级后，各轮消息分别带上自己的值；没有记录的保持缺省；Codex 的增量读取、完整读取和新存储实例结果一致。映射到 `turnModel` / `turnEffort` 并显示属于前端，契约写进交接说明。

### 5. 共享连接器推送命令运行中的输出

- **依据：** 上一阶段解析器已支持 `item.updated`（同一调用 ID、累计输出、`isPartial`），渲染层按 `tool-${id}` 合并。但 `scripts/codex-shared/shared-exec.cjs` 只转发 `item/started` 和 `item/completed`，共享模式下命令输出要等命令结束才出现。
- **做法：** 按锁定版本 `codex-cli 0.163.0-alpha.11.1` 的 app-server 协议源码核对命令输出增量通知的方法名和字段。按 itemId 累积输出，转成与现有 `commandExecution` 翻译同形的 `item.updated`（同 id、`command`、累计 `aggregated_output`、`in_progress`）。高频输出合并发送，每个调用最多约 200ms 一次，完成事件前先送出未发部分；调用完成或回合结束后清除缓存。现有的会话、回合和 `terminal` 过滤继续适用。
- **验收：** 在合成服务上，长时间命令的中间输出按顺序出现且调用 ID 不变，完成后的状态与最终输出正确，没有重复卡片；其他回合或会话的增量被过滤；大量增量时发送次数受控。更新 `docs/codex-shared.md` 的限制说明：命令输出已经增量推送，回答正文仍按完整条目。

### 6. 历史摘要不再写入原生会话

- **依据：** 页签开启“历史记录”（`defaultSaveToHistory` 默认开启）时，每轮结束后 `exitSynopsis.ts` 调用 `useAgentExecution.ts` 的 `spawnBackgroundSynopsis()`，它以 `agentSessionId: resumeAgentSessionId` 续接同一原生会话（约第 942 行）。结果是每轮都往用户的 Claude Code / Codex 原生对话追加一轮英文 Summary。Maestro 读取时由 `stripSynopsisTurns()` 隐藏，但在原生客户端里可见。共享模式下这一轮还会经共享连接器发到桌面 Codex 的同一线程，并带上 `cheapTurnSettings()` 的低思考等级；`turn/start` 的覆盖设置会不会延续到该线程后续回合，需要按协议核实并写进记录。
- **做法：** 只针对 `claude-code` 和 `codex`，其他提供方不变。
  - Claude Code：保留续接以获得上下文，加上仓库已在用的 `--no-session-persistence`（见 `src/main/agents/claude-slash-command-probe.ts`）。逐一确认 API、TUI、Dynamic 三种令牌来源的启动路径都接受该参数；不接受的路径按 Codex 的方式处理。
  - Codex：普通 `exec resume` 和共享连接器都会写入原生会话。如果锁定版本或当前 CLI 有经验证既不改写原会话、也不新建可见会话的选项，可以使用；否则不调用模型，用该轮最终回答的首段（截断）生成本地历史条目。无论哪种方式，都不经过共享连接器。
  - 原生会话里已有的旧 Summary 轮不删除，`stripSynopsisTurns()` 保留。
- **验收：** 开启历史记录完成一轮后，Claude Code 和 Codex 的原生转录文件逐字节不变，项目会话列表和桌面 Codex 不出现新会话，共享线程没有摘要轮，历史面板仍有该轮条目。云端无法真实运行 Claude Code 时，可以用指向本地模拟 API 的 `ANTHROPIC_BASE_URL` 验证；仍做不到的，在 PR 里写明 macOS 上的手动核对步骤并标记未验。

### 7. Claude Code 会话的跨应用自动刷新

- **依据：** 只有 Codex 存储实现了 `getTranscriptRevision()` 和只读增量读取 `readLocalTranscriptIncrementally()`；`src/renderer/hooks/session/useNativeTranscriptFollow.ts` 第 74 行只跟随 `codex`。终端里的 Claude Code 和 Maestro 打开同一会话时，Maestro 不会自动显示新内容。
- **做法：** 为 Claude Code 存储实现同样的 stat 版本探测（只限本地，SSH 返回 null）和只读增量读取，包含第 2、3、4 项的配对与字段。跟随条件放开到 `claude-code`，其余条件不变。
- **验收：** 仿照 `codex-session-storage-revision.test.ts`，覆盖追加、半行 JSON、UTF-8 分段、工具结果后到、文件截断或替换；增量与完整读取一致，正常追加不重读整份文件，读取不改写文件。后台跟随保留草稿、阅读位置和队列，忙碌页签不刷新。只做读取跟随，不改变发送、队列或写入；两端同时向同一 Claude 会话发送仍不支持，写进限制说明。

## 实施范围

- 第 1 项在 `codex/backend-reliability` 完成。第 2 至 7 项在 `codex/backend-followups`，一个 PR、每项单独提交，目标为 `codex/i18n-zh-cn`。某一项受阻时先提交其余项，并在 PR 中写明受阻原因。
- 主要入口：`src/main/storage/claude-session-storage.ts`、`src/main/storage/codex-session-storage.ts`、`src/main/parsers/claude-output-parser.ts`、`src/main/agents/session-storage.ts`、`scripts/codex-shared/shared-exec.cjs` 及对应测试。
- 渲染层只允许改以下非界面逻辑：第 6 项的 `src/renderer/hooks/agent/useAgentExecution.ts` 和 `src/renderer/hooks/agent/internal/helpers/exitSynopsis.ts`，第 7 项的 `src/renderer/hooks/session/useNativeTranscriptFollow.ts`。其他确需修改的渲染层文件，先在 PR 中说明原因。不改组件、样式、布局、界面文案和折叠规则。
- 不升级 Codex 或依赖，不改认证、订阅、队列、原生写锁和进程终止方式，不扩展到其他提供方，不打包、不发布。
- 完成后更新 `CHANGELOG.md` 的 Unreleased、本计划的完成记录，以及受影响的限制说明（`docs/codex-shared.md`、`docs/fork.md`）。

## 特殊要求

沿用上一阶段[特殊要求](backend-reliability.md#特殊要求)的七条：拒绝过度防御、不新增哈希或校验体系、不混入既有哈希机制的清理、最小修改、错误如实传递、测试验证行为、限制改动与证据量。另外：

1. 每个已确认缺陷先补能失败的回归，再修复。
2. 推送前运行 `npm run lint`、`npm run lint:eslint`、`npm run format:check:all`、相关 Vitest 和 `npm run test:codex-shared`；合并前要求 PR 的六项检查全部通过。
3. 新写的文档、注释和提交说明不使用长破折号或短破折号（见 `CLAUDE.md`）。
4. 只能在 Linux 云环境测试时，真实 macOS 双端、应用重启和真实 CLI 验收标记为未验，不用合成测试代替。

## 交接给前端

本阶段完成后由原生 Claude Code Opus 接手。Codex 在完成记录中写清以下契约：

- 第 4 项：`SessionMessage.model` / `effort` 的含义、出现在哪些消息上、缺省代表什么。Opus 负责映射到 `turnModel` / `turnEffort` 并显示。
- 第 5 项：运行中命令卡片的实时输出显示与展开后的滚动跟随。
- 第 6 项：Codex 本地历史条目的来源和形状，供 Opus 决定历史面板是否加以区分。
- 第 7 项：Claude Code 会话自动刷新时的阅读位置和未读表现。

上一轮遗留的前端事项另行跟踪：未读数按显示行计算，极窄窗口头栏裁切，对话布局中“显示工具调用”开关的含义，Issue #1 里侧栏点击或按 Enter 后的输入焦点和整份验收清单，以及长回合、停止恢复、共享双向刷新、滚动锚点的实机回归。

## 完成记录

实施后填写：每项的问题、改动、实际测试结果和未验项，保持简短。
