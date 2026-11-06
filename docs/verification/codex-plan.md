# Codex 任务清单链路核对

核对日期：2026-11-06。对象为本分支源码和本机 `codex-cli 0.166.0-alpha.6`。第一轮由 Codex 执行版本、帮助和 feature 查询；第二轮读取 Opus 经用户授权取得的真实 CLI 证据并补回归。Codex 未运行模型、Electron 或真实端到端脚本。源码契约测试不是模型实测。

## 结论与开关

`exec` 有 `update_plan` 工具，但默认关闭。当前版本的配置项是 `tools.update_plan.enabled = true`，可用 `codex -c tools.update_plan.enabled=true exec --json ...` 按次开启。它不在 `features list` 里，不应使用 `--enable update_plan`。当前帮助中没有旧版本的 `--include-plan-tool` 参数。

依据是同版本官方源码的 [配置解析](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/core/src/config/mod.rs)、[配置回归](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/core/src/config/config_tests.rs) 和 [工具注册](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/core/src/tools/spec_plan.rs)。`resolve_update_plan_enabled` 在没有显式配置时返回 false，注册器只在为 true 时添加 `PlanHandler`。源码能证明 CLI 的能力与默认值；Opus 随后的授权实验在开启配置后实际取得了 todo_list，补上了该版本订阅登录的工具曝光证据。

本机包只有二进制和资源，包清单与 `--version` 都是 `0.166.0-alpha.6`。二进制文本含 `ToolsToml`、`update_plan`、`todo_list`、`plan_update`，只能作旁证。使用临时 `CODEX_HOME` 和临时 cwd 执行 `--help`、`exec --help`、`features list`；另用 `-c tools.update_plan.enabled=true features list` 检查参数解析，退出 0。尝试加 `--strict-config` 时 CLI 明确拒绝，因为 features 子命令不支持它，不能把这一检查当成工具曝光证明。未读取用户配置或登录文件。

本次让 `newShell` 的桌面对话启动经 `buildAgentArgs()` 添加一次性配置，位于 resume 选择器之前，保留原权限参数。本机和 SSH 共用这份参数。CLI `dispatch --tab` 经桌面发送路径也会应用它。用户后置的自定义 `-c tools.update_plan.enabled=false` 仍可覆盖；不修改原生配置文件。旧界面、独立离线 CLI 作业和交互式 CLI 启动不会自动开启它。

## exec JSON 事件

同版本 [JSON 转换器](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/exec/src/event_processor_with_jsonl_output.rs) 与 [事件类型](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/exec/src/exec_events.rs) 确认：

- 第一次计划更新产生 `item.started`，后续产生 `item.updated`，回合结束产生 `item.completed`。同一轮使用同一个 item id。
- `item.type` 是 `todo_list`，`items` 是完整快照，条目为 `{ text: string, completed: boolean }`，不是逐项增量补丁。
- `pending` 和 `in_progress` 都映射为 `completed: false`。exec 流无法还原哪个步骤正在进行。
- `item.completed` 保留最后一份 items，不会把所有步骤改成完成。

下面是按官方定义构造的示例，不是真实模型采样：

```json
{"type":"item.started","item":{"id":"item_0","type":"todo_list","items":[{"text":"第一步","completed":false},{"text":"第二步","completed":false}]}}
{"type":"item.updated","item":{"id":"item_0","type":"todo_list","items":[{"text":"第一步","completed":true},{"text":"第二步","completed":false}]}}
{"type":"item.completed","item":{"id":"item_0","type":"todo_list","items":[{"text":"第一步","completed":true},{"text":"第二步","completed":false}]}}
```

`codex-output-parser.ts` 原有映射与这个契约吻合，之前只有合成测试，没有固定版本来源注释。本次补来源、拒绝畸形快照，防止缺少 items 清空前一清单或字符串 `"false"` 被误判为完成。`StdoutHandler` 通过 `isPartial` 放行同 id 更新，再经 IPC 合并到对话日志。

任务提取实际位于 `src/renderer/utils/agentTaskList.ts`，仓库没有 `src/shared/agentTaskList.ts`。它按工具输入里的 `todos`、`plan`、`tasks` 形状识别，不解析回复正文；右栏读取最新顶层工具清单。通用提取器对未知状态退回 pending 是已有行为，本次未扩展其猜测范围。

## 第二轮：最终回答与清单结束事件

Opus 提供的授权实验确认：`0.166.0-alpha.6` 开启配置后产生真实 todo_list。顺序包括进度正文、清单开始、命令开始与结束、清单更新、中间正文、清单更新、最终正文、清单结束、回合结束。清单结束确实在最终正文之后。原始事件只留在私有证据目录，仓库不保存原文、用量或原生会话 id。

独立审查成立。解析器已把清单结束标成 `toolState.status = completed`，但 StdoutHandler 过去把每个 tool_use 都视为新工具开始，将缓存答案发进 commentary 后清空。现在仅运行状态且非 partial 的工具开始允许这种转换；更新和结束继续送到任务面板，不降级答案。不修改清单内容，不依据正文补任务。

`e2e/fixtures/native/codex-plan-events.json` 保留真实事件类型、顺序和同 id 关联，正文、命令、用量和 thread id 都换成合成内容。解析器、输出层、可执行夹具和 Electron 共用这一份数据。夹具原样输出 12 个 JSON 事件，只另写支持后续 resume 的最小合成历史，不将其当作真实 rollout 形状的验证。

默认合成 Electron 场景在 `e2e/native-codex-plan.spec.ts`。它检查任务面板 2/2、最终回答存为 stdout 且可见，再发一条合成消息，不展开过程记录，确认前一回答仍可见。该场景已写入，Codex 未启动 Electron：

```sh
npm run build
npx playwright test e2e/native-codex-plan.spec.ts --project=native --workers=1 --retries=0
```

## 原生 rollout

直接工具调用的持久表示是 `response_item`，payload 的 `type` 为 `function_call`、`name` 为 `update_plan`，`arguments` 是包含 `plan: [{ step, status }]` 的 JSON 字符串，`call_id` 关联随后 `function_call_output`。状态有 pending、in_progress、completed。参见 [ResponseItem 类型](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/protocol/src/models.rs) 和 [计划参数定义](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/plan_tool.rs)；后者只取得 main 版本，未取得此小文件的相同标签内容，须以真实运行补核对。

同版本 [rollout 持久化策略](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/rollout/src/policy.rs) 保留 FunctionCall/FunctionCallOutput，但不保留 `EventMsg::PlanUpdate`。不要因为 reader 忽略 `event_msg.plan_update` 就假定真实历史丢了计划。`TurnItem::Plan` 属于另一个计划文本表面，不能当作任务完成清单。

现有 `parseCodexTranscript()` 已覆盖直接调用、输出配对、冷读和追加读取，之后 `transcriptMessagesToLogEntries()` 解析参数，再由任务提取器显示。本次文件契约测试覆盖初始进行中、追加全部完成、重新读取一致和原文件字节不变。路径继续使用选定账户的 sessions 与归档，plain/zstd 共用既有读取器；SSH 使用远程文件接口，不做本地 realpath。

代码模式内调用、工具命名空间变化和新版分页存储的实际持久形状尚未实测。本次没有为未确认的形状新增解析，也没有声称现有 rollout 文件发现逻辑覆盖所有新版存储模式。

## 版本边界

`e2e/fixtures/native/real-runtime.cjs` 固定 Codex `0.163.0-alpha.11.1`。`scripts/codex-shared/versions.json` 只有该版 admitted，其余列出的版本是 candidate，最高列到 `0.165.0-alpha.1`。本机 `0.166.0-alpha.6` 不在表中，通用真实 fixture 会拒绝它。本次不更改准入表。

[已准入版本的配置源码](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.1/codex-rs/core/src/config/mod.rs) 同样默认关闭 update_plan。因此版本差距不能解释为“升级才删除工具”；当前直接问题是未显式开启，模型曝光、事件和落盘兼容性仍需真实验收。专用诊断脚本核对完整版本字符串，不把诊断通过等同于连接器准入。

## Opus 的真实运行：API key 模式

先取得用户对模型费用的明确同意。此任务没有执行以下命令。先构建本分支的应用和 CLI，然后提供指定 CLI 的绝对路径、用户选定的模型，以及只供测试使用的 `CODEX_API_KEY`。脚本不会复制原生账号文件或访问钥匙串。它创建临时 home、Maestro 数据、Codex 账户和项目，关闭自动命名与历史摘要，使用 readonly 权限。

为明确关闭请求和流重试，临时配置使用名为 `maestro_plan_e2e` 的自定义提供方，直接访问 `https://api.openai.com/v1` 的 Responses API，密钥只从环境读取。当前 CLI 拒绝覆盖内置 `openai` 的重试参数，因此此实验不等同于原 QA 的订阅登录配置。它仍使用真实 Codex 的工具注册、exec 转换和 Maestro 完整链路，订阅场景使用下述 login 模式，不复制登录文件。

```sh
npm run build
MAESTRO_E2E_REAL=1 \
MAESTRO_E2E_CODEX_PATH=/absolute/path/to/codex \
MAESTRO_E2E_CODEX_MODEL='USER_SELECTED_MODEL' \
npx playwright test e2e/real-codex-plan.spec.ts --project=electron --workers=1 --retries=0
```

替换命令中的可执行文件路径和 `USER_SELECTED_MODEL`。`CODEX_API_KEY` 由用户预先通过环境提供，不写进命令、报告或截图。默认精确检查 `codex-cli 0.166.0-alpha.6`；比较另一个版本时必须显式给出 `MAESTRO_E2E_CODEX_EXPECT_VERSION`，并使用相应可执行文件。

脚本只发送一个回合，要求三次更新两步清单，预计四次模型响应。粗略预算为数万输入 token、数千输出及推理 token，常见耗时约 1 到 3 分钟，具体取决于所选模型和工具上下文，不承诺固定金额。等待上限 180 秒，整个测试 240 秒；API key 模式的 Playwright 与提供方请求重试关闭。失败后停止，不追加收费尝试。

断言 live IPC 的完成数依次为 0、1、2、2，同一清单 id；任务面板最终为 2/2；最终回答从正式输出通道送达且不进入 commentary；CLI 原生历史读取仍得到完成清单；正常退出重启后面板保持；项目标记文件和目录不变。流程经 CLI 发消息、设置权限和开面板，展示结果从真实 Electron DOM 读取。失败不能退化成“空状态也算通过”。默认不开 `MAESTRO_E2E_REAL=1` 时整个测试跳过。

## Opus 的真实运行：现有登录模式

设置 `MAESTRO_E2E_CODEX_AUTH=login`。脚本保持 HOME 和 CODEX_HOME 的继承值，不读取或复制用户登录、配置文件，不写临时 Codex 配置，也不设置 API key；检测到 CODEX_API_KEY 或 OPENAI_API_KEY 时直接拒绝。Codex 自身正常使用现有登录。仍创建临时项目和 Maestro 数据，关闭自动命名和历史摘要，只经 dispatch 发送一条消息，使用 readonly 权限和 `--ephemeral`，不写原生对话历史。无需提供模型时沿用用户默认模型，也可显式设置 MAESTRO_E2E_CODEX_MODEL。

```sh
MAESTRO_E2E_REAL=1 \
MAESTRO_E2E_CODEX_AUTH=login \
MAESTRO_E2E_CODEX_PATH=/absolute/path/to/codex \
npx playwright test e2e/real-codex-plan.spec.ts --project=electron --workers=1 --retries=0
```

Opus 在用户已同意后执行。运行前由执行者确保两个 API key 环境变量未设置。此模式不调用 native-history read，不重启应用，没有原生历史恢复断言。工具曝光、四次清单快照、最终 2/2、正式回答通道和临时项目不变仍是必需断言；没有清单不能当作通过。

预计一条用户消息、三次工具更新，约四次模型响应；预算与上面的 API 实验量级相同，具体以账户实际用量为准。Playwright 不重试，脚本不重发消息，关闭无界连接重试；登录模式保留内置提供方配置，未确认其内部有限网络重试是否发生，不宣称已将其归零。失败后停止，不追加收费尝试。Codex 没有执行这条命令。

## 需要真实运行才能确认的问题

1. 最少由 Opus 跑一次 login + enabled。现有 CLI 证据已经证明曝光和事件形状，这次只需补应用内输出分类与任务面板完整链路。登录模式不证明原生历史和重启恢复。
2. 如需补原生历史和重启证据，另行选择 API key 模式的一次 enabled；它使用临时账户。不能把 login 通过写成历史恢复通过。
3. disabled 或已准入旧版本对照只在需要隔离新的失败时额外运行，不自动追加。SSH、代码模式、分页历史和其他平台仍未实测，连接器版本准入表没有变化。

空状态只说明这条对话尚未提供可用工具清单，不声称 Codex 不支持计划。没有结构化数据不能可靠判断是没调用、被用户禁用还是模型不可用，不能凭模型正文或无事件推断能力。
