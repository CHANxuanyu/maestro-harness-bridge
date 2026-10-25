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

已完成 a、b、c、d；e 的历史正文、工具结果和模型/effort IPC 契约通过。f 的 revision 与只读 IPC 增量结果通过，界面自动跟随受阻，当前 hook 不加入 Grok。这些边界在用例标题中明确区分，没有把后端 IPC 结果当作界面通过。

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

自动历史摘要通过普通设置关闭，理由与 OpenCode a 至 f 相同。真实账户、macOS 和真实 Grok CLI 未验。版本入口只接受已核对的 grok 1.0.45 输出；其他版本输出仍拒绝。已有匹配 CLI 时执行：

```bash
MAESTRO_E2E_REAL=1 MAESTRO_E2E_GROK_PATH="$(command -v grok)" \
  npm run test:e2e -- e2e/native-grok.spec.ts
```

测试在临时 GROK_HOME 和 GROK_AUTH_PATH 中运行。若无 API key，只读复制选定 auth.json，不调用可能修改权限或恢复文件的原生认证读取函数，不复制真实会话。上述命令只验当前已完成部分，不代表两个界面受阻项已通过。
