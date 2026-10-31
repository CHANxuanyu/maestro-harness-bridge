# 核心体验后端与 CLI 契约

本页供 Opus 接界面，也记录云端与真实账户验收的边界。对应[核心体验计划](roadmap/core-experience.md)。以下新增功能不在 hb.5 冻结提交中。

## DeepSeek 预设

### 来源与配置

2026-10-31 核对 DeepSeek 官方 [Claude Code 集成](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/)及 [Anthropic 接口](https://api-docs.deepseek.com/guides/anthropic_api/)。网关为 `https://api.deepseek.com/anthropic`，凭据为 `ANTHROPIC_AUTH_TOKEN`。模型目录为 `deepseek-flash[1m]`（默认）、`deepseek-flash`、`deepseek-v4-pro`。主模型及 Opus/Sonnet 别名指向所选模型，Haiku 和子智能体指向官方建议的 `deepseek-flash`。不请求 Claude 模型目录，不猜测其他别名。

仍是 `toolType: 'claude-code'`，没有新 AgentId、协议或存储适配器。原生格式沿用已锁定的 Claude Code 2.1.310 夹具。每次确认创建时，在 Maestro 数据目录的 `accounts/deepseek-*` 下创建独立原生账户目录，将其写入智能体的 `customEnvVars.CLAUDE_CONFIG_DIR`。目录名由系统分配，不由密钥或内容计算。凭据沿用智能体环境变量的现有存储和遮盖；不会写进另一个 Claude 账户。空环境变量通过现有合并规则取消继承的 Claude 凭据和云路由，依据 [Claude 环境变量文档](https://code.claude.com/docs/en/env-vars)。

### 共用接口

- `window.maestro.agents.getPresets()` 返回无密钥的目录，包括 `id`、`name`、`toolType`、`baseUrl`、`defaultModel`、`models`。
- `prepareDeepSeekPreset({ apiKey, model?, customEnvVars? })` 在用户确认创建时调用一次，返回 `{ toolType, customModel, customEnvVars }`，交给现有智能体创建路径。打开预设选择器不调用它。CLI 的 `create_preset_session` 使用同一个准备函数；独立消息类型让旧版桌面明确拒绝，避免忽略预设后错误创建普通 Claude 智能体。
- `isDeepSeekAgent(toolType, customEnvVars)` 在 `src/shared/agentPresets.ts`，供列表、标签和模型选择统一识别。仍用 Claude 的原生能力和历史接口；显示身份为 DeepSeek。
- 本轮只支持本机预设。拒绝 SSH、创建时的自定义参数、未知模型及用 `--env` 覆盖路由/密钥/账户目录。普通 Claude 创建行为保持原样。

### CLI

运行中的 Maestro 使用相同数据目录，密钥不放在 argv：

```sh
maestro-cli create-agent DeepSeek --cwd /path/to/project \
  --preset deepseek --api-key-env DEEPSEEK_API_KEY --json
# 或从安全的 stdin 来源读取；不把密钥写成 shell 命令参数
maestro-cli create-agent DeepSeek --cwd /path/to/project \
  --preset deepseek --api-key-stdin --json
```

两个密钥来源必须且只能选择一个。`--model` 只接受上述目录；输出已有的智能体 ID，不回显密钥。之后用既有发送、停止、标签和历史命令。

### 交给 Opus 的复现用例

1. 用上述 CLI 创建预设，查看智能体标签、会话列表、模型选择。当前界面仍按 Claude Code 呈现；接入 `isDeepSeekAgent` 和预设模型目录，所有这些位置显示 DeepSeek，不能列出或选择 Claude 模型名。
2. 打开新建智能体界面，目前没有 DeepSeek 预设入口。接入无密钥目录；只在确认创建时准备账户目录，不在选择或取消时创建。
3. 查看预设环境变量，`ANTHROPIC_AUTH_TOKEN` 应继续使用现有 `isSecretEnvKey` / `maskEnvValue` 遮盖；不要在提示、日志或创建完成文案中回显密钥。
4. 本地没有 Claude CLI、密钥缺失、网关拒绝或额度不足时，复用现有错误结果。新增引导文案由 Opus 决定，不自动转向 Claude 账户。

### 用户的 Mac 验收

真实 DeepSeek 请求和新界面均未在云端验证。功能合并后使用该功能所在源码及锁定 Claude CLI；设置 `DEEPSEEK_API_KEY`，并保留可用的 Claude 登录用于相邻账户隔离验证：

```sh
MAESTRO_E2E_REAL=1 npm run test:e2e -- --grep 'claude DeepSeek:'
```

默认模式与 `test:e2e:real-smoke` 使用合成凭据和已锁定格式的假 CLI；该结果不代表网关、真实额度或 macOS 已通过。

## 换个 AI 继续

### 共用接口与行为

`window.maestro.context.handoffTargets(sourceAgentId)` 返回 `{ success, targets: [{ provider, runnerId? }] }`。`provider` 为 `claude-code`、`codex`、`deepseek`；排除源提供方、SSH 和不可用的本机 CLI，DeepSeek 必须已配置凭据与独立目录。不启动模型来探测可用性，也不返回凭据。同项目已有目标执行者但不可用时不另建一个。

`window.maestro.context.handoff({ sourceAgentId, sourceTabId, targetProvider, budgetTokens?, instruction?, send?, background? })` 与 CLI 共用主进程服务。默认 `send: false`；界面调用默认定位新标签，CLI 默认后台。多窗口请求分别送达源和目标所属窗口。目标项目内已有执行者就添加空白新标签，否则从目标提供方的配置建立执行者；不复制源账户、原生 ID、队列或历史。相同项目/提供方的并发请求串行创建。

成功结果包含 `agentId`、`tabId`、`createdAgent`、`state: 'draft' | 'queued'` 和 `draft: { text, estimatedTokens, budgetTokens, omittedEntries, omittedCharacters }`。保存到既有会话存储成功后才确认；显式发送复用现有队列，`queued` 表示已入队。`code` 区分 `invalid-request`、`unavailable`、`persistence-failed`、`queue-failed`。失败时若已有可恢复草稿，会一并返回实际 ID 和草稿，不自动重试创建或发送。

内容来自指定标签的 `extractTabContext`；延迟加载的正文只读补齐，不改变源标签。用户与回答保留正文，工具仅名称与状态一行，不带工具输入/输出。默认预算 8000，沿用记忆面板字符数/4 的 token 估算，优先保留最近内容；超长单条保留正文尾部和角色，报告省略条目及 UTF-16 字符数。来源、指示自身已超过预算会返回错误。历史中的 `@` 引用按现有扫描器转义，避免发送时被解释成新指派。

草稿没有原生会话 ID；发送才产生新会话。原有的系统提示、新会话消息、nudge 和原生路由规则仍作用于目标回合。Codex 首轮的 Maestro 系统封装在读取时使用已有公共函数拆开，保留用户交接正文，纯系统上下文仍过滤。没有模型整理、隐藏发送或新存储体系。

### 交接 CLI

```sh
maestro-cli handoff <source-tab> --list-targets --json
maestro-cli handoff <source-tab> codex --max-tokens 8000 --json
maestro-cli handoff <source-tab> deepseek --instruction '接着核对回归' --focus --json
# 只有这类带 --send 的调用授权发送
maestro-cli handoff <source-tab> claude-code --send --json
```

支持 `--agent` 消歧及现有 `--background` / `--focus`。JSON 失败结果保留恢复草稿所需的 ID。准备草稿后，界面使用返回的标签和原有输入框编辑/发送；不要再次调用 `handoff` 来发送旧草稿，否则会另建新标签。

### 交给 Opus 的交接复现用例

1. 同一项目创建三家执行者，在任一对话中打开标签菜单或命令面板：目前没有新交接入口。用 `handoffTargets` 填充另两家的选择，调用 `handoff` 不传 `send`，显示返回的草稿大小与省略计数；编辑后走现有发送动作。
2. 出现额度用尽、限流、登录失效时，现有错误旁还没有交接入口。接入同一目标目录；保留原错误，不自动发送或自动切换账户。入口和错误文案由 Opus 决定。
3. 运行后台 CLI 草稿命令后，源输入框和正在看的标签保持不变，目标已有执行者多一个未发送标签。用 `--focus` 或界面默认定位时，应能看到新草稿。目标在另一窗口时检查该窗口内的定位；自动将操作系统窗口置前不属于本接口承诺。
4. 将 token 预算设得小于来源与附加指示，或让保存失败：显示结构化错误。若返回草稿 ID，保留并定位可恢复的草稿，不自动重试；确认新的提示文案后再接入。

5. 在 Codex 会话浏览器预览刚发送的首轮交接：存储现在保留完整原生首条消息，对话接续通过 `transcriptMessagesToLogEntries` 正常拆掉系统封装；浏览器的 `SessionMessagesView` 仍直接显示原始内容，这是公共工具指引已记录的界面缺口。用同一公共转换消除预览里的系统前缀，不修改原生文件；不要在存储层提前拆封装，避免用户正文引用分隔符时被二次截断。

### 用户的 Mac 交接验收

需要锁定 Claude/Codex CLI、两家的可用账户及 `DEEPSEEK_API_KEY`；使用包含该功能的源码，不重新构建 hb.5：

```sh
MAESTRO_E2E_REAL=1 npm run test:e2e -- --grep 'claude handoff:'
```

场景包含三家六个方向的草稿、保持原生文件不变、同项目复用、IPC/CLI 一致及一次显式发送。真实网关、额度、macOS 与 Opus 新入口尚未验证；云端仅执行假 CLI 和合成凭据的真实模式入口。
