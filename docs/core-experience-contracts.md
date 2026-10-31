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
