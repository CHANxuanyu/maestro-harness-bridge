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

交接当前只提取文本上下文与工具摘要，不复制图片或附件；源附件仍留在原会话。

## 关于我

### 来源、文件与现有内容

2026-10-31 核对 Claude Code 官方[记忆文档](https://code.claude.com/docs/en/memory)、[环境变量文档](https://code.claude.com/docs/en/env-vars)和 Codex 官方[AGENTS.md 文档](https://developers.openai.com/codex/guides/agents-md)。Claude 使用账户目录里的 `CLAUDE.md`，Codex 使用 `CODEX_HOME`（默认 `~/.codex`）里的 `AGENTS.md`。Codex 同目录中非空的 `AGENTS.override.md` 优先，接口以 `shadowedBy` 返回，绝不另行改写 override。

复用已有 `conductorProfile` Markdown，不增加第二份“关于我”或新存储。原来的 Maestro 系统提示注入保持现状；本轮增加原生全局文件同步。原生工具在启动时发现这些文件，不能把计划中“每轮加载”理解成已经运行的 CLI 会即时重载。实际加载及 Mac 使用未验，需要重新启动原生 CLI 并验证。

目录来自既有账户发现的原始候选：本机智能体、提供方、全局环境、进程环境、默认目录、既有规则认可的 home 账户目录；另包括预设工厂创建的 DeepSeek 目录和此前已管理的文件。SSH 智能体不加入。共享同一历史池的两个账户仍各自同步自己的指令文件；实际指向同一文件的目录别名/符号链接只写一次，返回原始路径与实际目标，保留链接本身。不搜索整个磁盘，也不猜未知账户路径。

### 共用接口与确认

`window.maestro.settings.aboutMe(command)` 与 CLI `{ type: 'about_me', request: command }` 请求使用同一服务：

- `{ action: 'show' }`：返回现有 Markdown 与 token 估算。
- `{ action: 'set', content }`：仅保存 Markdown，不写原生文件，不调用模型。保留内容原样，没有新增长度上限；拒绝包含管理标记或无效 Unicode 的内容。
- `{ action: 'status' }`：读当前文件，列出 `path`、`aliases`、`resolvedPath`、`providers`、`state`、`currentBlock`、`shadowedBy` 及文件错误。只返回管理段，不返回段外用户内容。
- `{ action: 'apply', content, confirmations?: [{ path, resolvedPath, block }] }`：`content` 必须等于刚显示/保存的档案；确认项必须来自 `status`，`block` 是当时的 `currentBlock`（不存在为 `null`）。第一次写入、链接改指新目标、管理段在外部改变均要求明确确认。提交后再次比对实际目标与管理段，旧确认不能覆盖新修改。已经确认且未外改的文件可直接更新或清空。

状态为 `synced`、`pending`、`unconfirmed`、`external-change`、`missing-directory`、`invalid-block`、`error`。成功/失败均返回 `content`、`estimatedTokens`、`files`；apply 另有 `written`，列出已实际写入的文件。`code` 区分 `invalid-request`、`profile-changed`、`confirmation-required`、`file-error`、`persistence-failed`、`unavailable`。失败可能是部分成功，不能把整个批次当成回滚：逐文件原子写入，某个文件失败或未确认不覆盖它，其他已批准文件可以完成。写后保存归属记录失败也明确报错；再次读取状态，按返回的归属/冲突状态确认，不自动重试。

在既有 settings 中以 `aboutMeApplied` 保存每个路径上次已应用的准确管理段及实际目标，不使用内容哈希或不透明版本号。段外字节（包括 BOM、CRLF、非 UTF-8 字节和无末尾换行）原样保留。标记重复/不完整或管理段不是 UTF-8 时拒绝改写；目录不存在不自动创建账户目录，已有目录内缺失的文件经确认后新建。空内容在 apply 时删除完整管理段，保留文件和其他字节。并发 Maestro 请求串行执行；没有为外部编辑器增加锁，原子替换不承诺跨进程事务。

token 沿用 `estimateTokenCount` 的字符数/4 估算，仅代表 Markdown 自身，不是提供方的真实计费或整轮系统上下文。成功 `set` 通知其他桌面窗口与 web 客户端，写入窗口从返回结果更新本地内容；apply 后重新获取/使用返回的文件状态。不会经由通用 `settings:set` 记录档案正文。

### 关于我 CLI

需连接正在运行且使用同一数据目录的 Maestro；内容只从文件或 stdin 输入：

```sh
maestro-cli about-me show --json
maestro-cli about-me set --file /absolute/profile.md --json
# 或：maestro-cli about-me set --stdin --json < /absolute/profile.md
maestro-cli about-me status --json
# 逐项查看状态中的 resolvedPath；只给明确批准的实际文件路径：
maestro-cli about-me apply \
  --confirm '/absolute/claude-account/CLAUDE.md' \
  --confirm '/absolute/codex-account/AGENTS.md' --json
# 后续正常更新已有归属且未外改的文件：
maestro-cli about-me apply --json
# 清空分为保存空内容和应用，前者不改原生文件：
maestro-cli about-me set --clear --json
maestro-cli about-me apply --json
```

`--file`、`--stdin`、`--clear` 三选一；`--confirm` 可重复，只接受当前状态中的绝对实际目标。CLI 从最新状态取得待确认的段；这条显式命令表示批准该文件当前的管理段，不提供全局 force 或跳过确认开关。未提供确认时，首次 apply 只报告未确认状态；已有归属的文件仍按常规更新。失败退出码为 1，JSON 保留部分结果，不把未知/失败显示成成功。

### 交给 Opus 的关于我复现用例

1. 在 General 设置的现有 Conductor Profile (About Me) 编辑内容。目前保存仅改变 `conductorProfile`，没有原生文件确认、状态或 token 信息。接入上述 `set -> status -> 确认 -> apply`，沿用同一 Markdown，不另建一份档案；新增界面和文案由 Opus 决定。
2. 用 CLI 保存超过 5000 字符的 Markdown，再在现有编辑框修改：原来的 `setConductorProfile` 会截到 5000 字符。新后端不截断，接入时应避免经旧 setter 丢失内容，并用返回的完整内容更新当前窗口。
3. 首次 apply、外部改段或符号链接改指目标时，展示原始路径、实际目标及当前管理段；用户明确确认后原样传回快照。期间继续外改应保持冲突，不静默覆盖，不自动重试。
4. 构造缺失目录、重复标记和一个正常文件；批量应用会返回部分完成和每个文件状态。分别呈现 `written` 与未完成项，不把它显示成全部成功或全部回滚。非空 Codex override 必须提示其优先级，不能显示为“模型已经加载”。
5. 清空后执行 apply，管理段应消失、其他字节不变；提示重新启动原生 CLI。这里只验文件，不把合成端到端结果显示为真实模型加载验收。

### 用户的 Mac 关于我验收

先使用包含本功能的源码并按上面的 CLI 顺序保存、查看和逐文件确认，不能用 hb.5 冻结源码。选择自己愿意写入的短测试偏好，记录确认的账户目录，重新启动 Maestro 对话及对应的原生 CLI：

```sh
CLAUDE_CONFIG_DIR='/absolute/approved-claude-account' claude
CODEX_HOME='/absolute/approved-codex-account' codex
```

对 DeepSeek 使用它的独立账户目录及既有网关、模型、环境变量凭据启动 Claude Code，不把密钥填进命令行参数或验收记录。分别在 Maestro 内外用同一测试问题验证偏好生效；检查 Codex 的 override，已经运行的旧 CLI 先退出再启动。外部修改管理段后运行 status/apply，应先拒绝覆盖；最后 `set --clear` 与 apply 后确认段消失、其他字节不变。每个本机账户分别记录，真实加载、Mac 和账户请求目前均未验。
