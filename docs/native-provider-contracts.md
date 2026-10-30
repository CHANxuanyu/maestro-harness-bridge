# 原生提供方接续契约

本文记录后端第三阶段采用的精确来源和验收边界。合成程序只复现下列版本已有的输出与持久化形状；不代表其他版本或真实账户已经验收。

## OpenCode 1.19.4

锁定 [anomalyco/opencode 的 v1.19.4](https://github.com/anomalyco/opencode/tree/148842ef7cb1bc34192b3fff57d0f9721ab9c801)，提交 `148842ef7cb1bc34192b3fff57d0f9721ab9c801`。

| 契约                                                                                              | 官方源码                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run --format json` 的 `step_start`、`step_finish`、`text`、`tool_use`、`error`，`--session` 接续 | [run.ts](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/cli/cmd/run.ts)                                                                                                                                                     |
| message、part、`callID`、`modelID`、工具状态                                                      | [session.ts](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/schema/src/v1/session.ts)                                                                                                                                                    |
| SQLite 表与 JSON 投影                                                                             | [sql.ts](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/core/src/session/sql.ts)、[projector.ts](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/core/src/session/projector.ts)             |
| `time_updated` 毫秒更新时间                                                                       | [schema.sql.ts](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/core/src/database/schema.sql.ts)                                                                                                                                          |
| 停止后 `error` 与 `metadata.interrupted: true`                                                    | [processor.ts](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/session/processor.ts)                                                                                                                                         |
| 停止原因 `stop` 仍可能有下一工具步骤                                                              | [prompt.ts](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/session/prompt.ts)                                                                                                                                               |
| XDG 数据目录与 `auth.json`                                                                        | [global/index.ts](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/global/index.ts)、[auth/index.ts](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/auth/index.ts) |

实时和历史都以 `callID` 配对，输入保持原对象。原生 `error` 的正文来自 `state.error`；带原生 `interrupted` 标记记为 `canceled`，其他错误记为 `failed`。assistant 的 `modelID` 进入 `SessionMessage.model`。`variant` 可能是任意模型预设，不能当作思考等级，`effort` 保持缺省。

原生 JSON CLI 只在工具完成或失败时发 `tool_use`，不发运行中工具行。数据库可以提前记录运行中状态。步骤结束并不等于 CLI 调用结束，不能在 `step_finish` 后丢弃合法的后续步骤；锁定版本没有单独的整回合 JSON 结束标记，沿用进程退出边界。

本地 SQLite 版本探测包含数据库和 WAL 的文件身份及修改信息。只读事务内读取行 ID 与更新时间，仅重新解码新增或变化的正文；包含同一毫秒更新的重叠区间、删除和数据库替换。最多保留两份、每份原始正文不超过 32 MiB 的游标，超过则完整读取。只读和完整读取使用同一字段映射，分页发生在完整配对之后。

合成 Electron 场景 a 至 f 覆盖同一原生 ID 多轮、并行工具的输入与结果、Stop、应用重启、只读历史、闲置跟随以及阅读位置和草稿保持。它们通过正常设置关闭自动历史摘要；摘要场景 h 不在这五家提供方的本轮范围中。OpenCode 现有后台摘要仍会另起原生调用，不能宣称开启该功能时转录不受影响。

旧版 JSON 目录及 SSH 读取沿用既有行为，未用当前锁定版证明它们的格式，也未给这些路径启用增量跟随。真实账户、macOS 和真实 OpenCode CLI 尚未验收。已有 CLI 的 Mac 验收命令如下，测试只在独立临时目录写会话，复制一份凭据用于原生认证，不改原账户文件：

```bash
MAESTRO_E2E_REAL=1 MAESTRO_E2E_OPENCODE_PATH="$(command -v opencode)" \
  npm run test:e2e -- e2e/native-opencode.spec.ts
```

只接受上述锁定版本；版本不符会失败，不会自动降级或跳过场景。合成真实入口检查不等于真实账户验收。

## Grok 1.0.45

锁定 [xai-org/grok-build@2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8](https://github.com/xai-org/grok-build/tree/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8)，仓库 manifests 为 1.0.45。ACP schema 采用该提交 Cargo.lock 锁定的 0.11.4。格式来源：

- [conversation.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-sampling-types/src/conversation.rs)：原生 assistant、tool_calls、tool_result、model_id、reasoning_effort。
- [storage/mod.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/storage/mod.rs)、[storage/jsonl/mod.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/storage/jsonl/mod.rs)、[notification.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/notification.rs)：chat_history.jsonl、updates.jsonl 和持久化回合终止原因。
- [headless/reducer/acp.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/src/headless/reducer/acp.rs)：streaming-json 的 text、tool_call、tool_call_update、end。
- [acp_conversion.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/acp_conversion.rs)、[output.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-tools/src/types/output.rs)：原生 Bash 输出及 ACP 状态映射。
- [login/storage.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-login/src/storage.rs)、[auth_method.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-login/src/auth_method.rs)：GROK_AUTH_PATH、GROK_HOME 和 API key 环境变量。

调用 ID 是唯一的工具配对依据。chat_history 的结果正文没有成功或失败标记；状态从同一 sessionId 的 updates.jsonl 读取。ACP 没有 canceled 状态，持久化 turn_completed.stop_reason=cancelled 只取消该回合仍未完成的调用，已完成或失败的结果不重写。没有更新记录时保留 unknown，不从错误措辞猜结果。原生 Bash 即使 exit_code 非零也可能发 completed，实时与历史均按原生退出码保留失败。没有 rawOutput 的 ACP 文本结果也保留。end 后迟到的文本和工具事件不再转发。

model_id 和 reasoning_effort 仅来自原生 assistant。chat_history 不记录每条消息的时间，timestamp 保持空字符串，不拿会话时间或本机时间冒充。计划称没有结果配对，但原代码已按 ID 配对了结果正文；这次补的是稳定 ID、原生状态、模型与思考等级。

本地 revision 同时覆盖 chat_history 和 updates；只读增量游标复用既有字节偏移、文件身份及首尾边界检查，不使用哈希。每份文件游标上限 32 MiB，最多两条会话的四份文件；超过上限沿用完整读取。部分 JSON/UTF-8 尾行、文件替换、分页和结果晚到都与完整读取一致。SSH 沿用完整读取，不启用跟随。

### Grok 的 Opus 交接与验收边界

以下是第三阶段移交时的复现记录：a 至 d 与 e 的后端契约通过；当时 f 只覆盖 revision 与只读 IPC，尚未启用界面跟随。Opus 的修复和第五轮的补充验收见下文，不能把此前的 IPC 结果当作界面通过。

1. **消息详情崩溃：** 从 Grok 项目历史打开带 model_id 的回复，点击 Message info。现有转换将空 timestamp 转成 NaN，详情格式化抛出 RangeError: Invalid time value，整个会话显示错误边界。Opus 应保留“无原生时间”的语义并正常显示原生模型与 effort。复现用 e 的现有准备流程，在模型 IPC 断言后加回下列原始界面断言；它已在当前界面明确失败：

   ```text
   await native.output().getByRole('button', { name: 'Message info', exact: true }).last().click();
   await expect(native.output().getByText(metadata.model, { exact: true })).toBeVisible();
   if (metadata.effort) {
       await expect(native.output().getByText(metadata.effort, { exact: true })).toBeVisible();
   }
   ```

2. **无时间戳回复重复：** 暂时把 Grok 加入 useNativeTranscriptFollow 的提供方列表，运行 d。重启后从原生历史打开同一 ID，再发一轮。新答案出现两次，现有严格唯一定位断言失败；文件中仍只有一次。原生历史的 NaN 时间无法与实时行的本机时间配对。不能简单只按正文消重，以免吞掉内容相同的真实两轮。Opus 修复后应恢复 f 的完整界面验收：闲置外部追加、阅读锚点与草稿保持、运行中不读、Stop 后刷新，并重跑 d 的唯一答案断言。当前不会启用已知有此缺陷的自动跟随。
3. **未知状态显示：** 仅有 chat_history、没有对应 updates 的旧工具结果会返回 status=unknown。界面当前把未知值显示为运行中。复现：读取只有 assistant.tool_calls 与 tool_result 的原生记录。Opus 应显示未知结果，不能冒称成功或永久运行。

**Opus 处理结果（2026-10-30）：** 三项均先补失败的回归再修复，改动只在渲染层。

1. 消息信息遇到无效时间显示“未记录”，原生模型与思考等级照常显示；旧版布局不再画 NaN 日期。e 已恢复上面的界面断言。
2. `mergeNewerEntries` 对没有原生时间的条目改用顺序证据：锚点之后的原生条目只与本标签尚未配对、且位于上一次配对之后的同文本本地条目一一配对，新条目按磁盘顺序插入。真实重复回合仍各自保留，不按正文全局消重。Grok 已加入 `useNativeTranscriptFollow`。
3. 存储明确返回 unknown 的工具调用显示为“结果未知”，折叠行同样标出；会话浏览器的工具卡片不再把未知或缺失状态画成成功。

第五轮已补充 f 的完整界面用例（闲置追加、阅读锚点、未读数与草稿、运行中屏蔽、Stop 后刷新），以及 chat_history 没有 updates 时的 unknown 工具结果用例。普通追加按锁定源码的逐条追加锁验证，整文件压缩的并发安全不在结论内；没有采用 OMP 的旁支断言。实际结果与四项缺陷反证见[第五轮完成记录](roadmap/follow-and-history-gaps.md#完成记录)。第五轮任务二让未打开历史的实时标签也能通过唯一的用户消息顺序找到锚点；歧义、未落盘发送或没有文字证据时仍拒绝猜测。有时间提供方的配对窗口不变。

自动历史摘要通过普通设置关闭，理由与 OpenCode a 至 f 相同。真实账户、macOS 和真实 Grok CLI 未验。版本入口只接受已核对的 grok 1.0.45 输出；其他版本输出仍拒绝。已有匹配 CLI 时执行：

```bash
MAESTRO_E2E_REAL=1 MAESTRO_E2E_GROK_PATH="$(command -v grok)" \
  npm run test:e2e -- e2e/native-grok.spec.ts
```

测试在临时 GROK_HOME 和 GROK_AUTH_PATH 中运行。若无 API key，只读复制选定 auth.json，不调用可能修改权限或恢复文件的原生认证读取函数，不复制真实会话。上述命令只验当前已完成部分，不代表两个界面受阻项已通过。

## Oh My Pi 18.12.6

锁定 [can1357/oh-my-pi v18.12.6，45c35e40c46166dc726ccc52f5d27f40f2449f99](https://github.com/can1357/oh-my-pi/tree/45c35e40c46166dc726ccc52f5d27f40f2449f99)。字段来自 `packages/ai/src/types.ts`、`packages/agent/src/{types,agent-loop}.ts`、`packages/coding-agent/src/session/{session-entries,session-paths,session-manager,session-context,agent-session}.ts`、`packages/coding-agent/src/modes/print-mode.ts`。目录、认证与版本入口来自同一提交的 `packages/utils/src/{dirs,cli}.ts`、`packages/ai/src/env-api-key.ts` 和 README。

原生版本 3 的 session JSONL 是分支图。历史只沿选定 activeLeafId/parentId 读取，不能把旁支串成一段对话。toolCall.arguments 是原生对象，toolResult 是独立角色消息，按 toolCallId 配对 input/output/status。模型来自 assistant.model；effort 来自当前分支的 thinking_level_change.thinkingLevel，null 清除；configured=auto 不冒充实际等级。带 `__synthetic` 或 `__interrupted` 的已确认原生中断标记映射为 canceled；普通 isError 是 failed，不靠错误正文猜取消。部分正在执行的工具被中断时只记录 isError，没有明确取消标记，这类历史结果保留 failed，不能承诺全部中断都能区分。

只有 agent_end.isTerminal=true 结束事件流。原生维护或内部重试发出的 isTerminal=false 不能截断下一步。正常终止后迟到的文本和工具事件不再转发，既有 willRetry 和 TTSR 规则保留。

本地 revision 与只读增量游标使用原生文件身份、大小及时间，不用哈希。最多保留两份不超过 32 MiB 的文件游标；增量、完整读取及分页语义一致。PI_CODING_AGENT_DIR 按原生目录选择读取，每次确认 header 的 session ID 与项目，缓存路径不能跨所选目录复用。SSH、非默认 profile 和 XDG 默认位置没有完成真实验收；不扩展认证或写锁行为。

a 至 f 覆盖两轮同 ID、并行工具与历史一致、Stop、应用重启、项目历史模型、闲置跨应用追加、草稿和阅读位置。f 按官方 session-manager 的 foreign-entry 规则验收：忙碌时不刷新，并发写入成为旁支后不混入当前分支；Stop 后向当前分支再追加则正常刷新。原生分支语义改变了测试准备方式，没有改变“闲置刷新、忙碌不读”的目标。该场景不宣称提供并发写入支持。

真实模式只接受 `omp/18.12.6`，使用调用者提供的 ANTHROPIC_API_KEY，不读取或复制 OMP 原账户文件。PI_CODING_AGENT_DIR、PI_CONFIG_DIR 与 XDG 路径都指向测试临时目录，清除 profile 选择，自动摘要通过普通设置关闭。本轮真实账户、macOS 与真实 CLI 均未验；已有匹配 CLI 和 API key 时执行：

```bash
MAESTRO_E2E_REAL=1 MAESTRO_E2E_OMP_PATH="$(command -v omp)" \
  npm run test:e2e -- e2e/native-omp.spec.ts
```

本项未发现需要 Opus 改界面的缺陷，只改允许的 hook 提供方条件。

Oh My Pi 的非最终 agent_end 也不会进入独立错误检测路径；最终 agent_end 之后的迟到错误和其他事件共享终态过滤。此路径由失败后修复的回归覆盖。

## Copilot CLI 1.0.63

锁定官方 npm 包 [@github/copilot 1.0.63](https://registry.npmjs.org/@github/copilot/1.0.63)，gitHead `c440c72e8caca344fe4a4223cceb59dcd241cb48`。只读解包核对 `index.js` 的事件 schema 和会话实现，以及 `app.js` 的 Adr stdout 过滤、\_dr 终止事件、WM/n0e 工作区元数据、kft 版本输出、Session.abort+shutdown 退出流程。1.0.64 以后包转为原生加载器，本轮没有用旧版证据宣称验证了最新版 1.0.103。没有执行或安装官方包。

落盘是 COPILOT_HOME/session-state/<id>/events.jsonl 与 workspace.yaml。assistant.message.toolRequests.arguments 是对象；工具完成结果按 toolCallId 配对，success=false 保留 error.message，普通错误文字不推断取消。原生 abort 只把当时未完成的调用改为 canceled，已经成功或失败的调用不变；下一回合新工具照常运行。实时 abort 同样通过已有的并行工具结果契约取消未完成调用，不依赖 Maestro 的 Stop 按钮。模型来自 assistant.message.data.model，不能取 selectedModel 冒充实际模型。实际 reasoningEffort 在 ephemeral 的 assistant.usage 中，既不落盘也不进入此 CLI 的 JSON stdout，所以历史 effort 保持缺省。

只有 CLI 的 type=result 是整个进程的终止边界，assistant.message/assistant.turn_end 不能截断后续步骤。官方 qYr schema 的 session.error.data.message 经 Adr 发到 stdout，按原文进入错误检测；修复此前漏报。终止后迟到的工具、文本和错误不再转发。官方 session.shutdown 只写入文件而被 Adr 排除出 stdout，夹具同样遵循这个规则。

读取和 revision 使用界面选中的 configDir，不串到同 ID 的默认账户。退出后的最终答案核对也使用进程实际 COPILOT_HOME；修复了旧工具函数读取不存在的 COPILOT_CONFIG_DIR、以及退出核对忽略所选目录的问题。这只修正只读位置，不改变认证、原生写锁或进程终止方式。增量游标最多缓存两份不超过 32 MiB 的文件，追加、半行、多字节字符、分页和文件替换均与完整读取一致。SSH 保留既有远程完整读取，不启用本地跟随回退。

真实模式只接受官方 kft 的 1.0.63 完整版本输出。需要调用者提供 COPILOT_GITHUB_TOKEN，不从账户、系统 keychain 或 gh 登录中获取凭据。测试使用临时 COPILOT_HOME，关闭原生自动更新，自动摘要通过普通设置关闭。真实账户、macOS 和真实 CLI 未验。已有匹配 CLI 和所需 token 时执行：

```bash
MAESTRO_E2E_REAL=1 MAESTRO_E2E_COPILOT_PATH="$(command -v copilot)" \
  npm run test:e2e -- e2e/native-copilot.spec.ts
```

目前六个 Linux 合成场景通过，未发现需要 Opus 改界面的缺陷。跨应用场景只证明读取的忙碌保护与闲置刷新，不承诺真实 CLI 接受两个同时写入者；原生拒绝将使真实验收明确失败，不删锁或新建会话掩盖。
