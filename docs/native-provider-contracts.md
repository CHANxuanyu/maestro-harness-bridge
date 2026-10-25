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
