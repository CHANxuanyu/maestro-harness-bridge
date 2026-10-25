# 共享连接器协议审计

审计日期：2026-10-25。基线为 `rust-v0.163.0-alpha.11.1`，提交 `680c4ba93ec79c292287fb9e0b627dc7a76e3b5e`。枚举当时官方 `rust-v*` 标签，包含所有版本序高于基线的正式和 alpha 标签。基线是后发布的补丁标签，因此也纳入版本序更高、发布日期更早的标签，避免漏掉桌面可能内置的版本。最新观察到 `0.165.0-alpha.1`；之后的版本不在清单中。

## 实际依赖

可读明细在 [protocol-surface.json](../scripts/codex-shared/protocol-surface.json)，逐字段基线在 [protocol-baseline.json](../scripts/codex-shared/protocol-baseline.json)。连接器测试检查 RPC 调用、参数、通知和工具字段没有超出明细。没有协议哈希，也不靠版本前缀推断兼容。

| 部分         | 实际依赖                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 初始化       | `initialize` 的 clientInfo、experimentalApi；`initialized` 通知                                                                                                 |
| 接续与准入   | `thread/resume` 的 threadId、excludeTurns；返回 ID、状态和模型；`thread/queue/list` 的 data 长度                                                                |
| 回合         | `turn/start` 的文本、图片、模型、effort、summary、sandboxPolicy、approvalPolicy、cwd、clientUserMessageId；返回 turn.id；`turn/interrupt`；`thread/unsubscribe` |
| 只读回退检查 | `thread/read` 的 ephemeral/status；`thread/loaded/list` 的游标；`thread/backgroundTerminals/list` 的 data 长度                                                  |
| 通知         | item started/completed、命令输出 delta、tokenUsage、error、turn completed；按 threadId/turnId 关联                                                              |
| 工具字段     | 明细列出的显式工具变体；其他原生工具保留完整 JSON，只检查共有错误字段                                                                                           |

每个版本都读取该提交的 `codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json`。公开 schema 不包含实验性队列和后台终端方法，因此同时核对 `src/protocol/common.rs` 的方法映射和 `src/protocol/v2/thread.rs` 的四个请求/响应声明。审计脚本只在声明完全一致后补入这部分，声明变化就报告失败。真实 CLI 检查直接使用官方 `app-server generate-json-schema --experimental --out <临时目录>`，不补造本机协议。

## 逐版本结果

下表的常用 RPC、参数、返回字段和已解析通知均与基线一致。0.164 系列及 0.165 alpha 的公开 schema 不再列出旧图片变体；进一步读取各标签的 `codex-rs/ext/items/src/image_generation.rs`，确认 `GeneratedImageRef` 使用 untagged 并 flatten：原 `result` 或新增 `fileId` 直接位于条目顶层，不存在 `image.type` 包装。连接器已有通用工具转发逻辑完整保留这两种 JSON，回归覆盖两者，无需产品分支。

| 原生版本             | 官方提交                                                                                     | 标签日期   | 差异及处理                     | 准入状态       |
| -------------------- | -------------------------------------------------------------------------------------------- | ---------- | ------------------------------ | -------------- |
| `0.163.0`            | [`8308618`](https://github.com/openai/codex/commit/83086188ae0614bd882818ff1aa23f3194962012) | 2026-10-15 | 字段不变                       | 候选，Mac 未验 |
| `0.163.0-alpha.11.1` | [`680c4ba`](https://github.com/openai/codex/commit/680c4ba93ec79c292287fb9e0b627dc7a76e3b5e) | 2026-10-21 | 字段不变                       | 既有准入       |
| `0.163.0-alpha.11.2` | [`51f97c6`](https://github.com/openai/codex/commit/51f97c6bca5500edbb986f6d9fe64fa2e63cbdd4) | 2026-10-22 | 字段不变                       | 候选，Mac 未验 |
| `0.163.0-alpha.12`   | [`6699a0d`](https://github.com/openai/codex/commit/6699a0dbccf48c747f6353c99a29dcd3a0eff30b) | 2026-10-14 | 字段不变                       | 候选，Mac 未验 |
| `0.163.0-alpha.13`   | [`de2b652`](https://github.com/openai/codex/commit/de2b65246c4de715f86e48dae454a09d88d277f2) | 2026-10-14 | 字段不变                       | 候选，Mac 未验 |
| `0.164.0`            | [`6aaac69`](https://github.com/openai/codex/commit/6aaac694803004a63c6f393d153c96d22521a6b9) | 2026-10-23 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.1`    | [`5003dcd`](https://github.com/openai/codex/commit/5003dcd68efc5b668c0264f6ff6708c7689a589b) | 2026-10-16 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.10`   | [`246178f`](https://github.com/openai/codex/commit/246178f7839a01a1e3142866c78f8cc248550305) | 2026-10-21 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.11`   | [`fd591b6`](https://github.com/openai/codex/commit/fd591b6049c2745a2097baab41180fbdb19bdac0) | 2026-10-22 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.11.1` | [`6905ece`](https://github.com/openai/codex/commit/6905ecede7816e91373e9eabda3f6b0368fc747b) | 2026-10-22 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.12`   | [`de8e7df`](https://github.com/openai/codex/commit/de8e7df8a026d30ca5e7b98fd0be8fef9249a4b0) | 2026-10-22 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.2`    | [`f37ce69`](https://github.com/openai/codex/commit/f37ce690135a69c3d4bb0210786bd95a866c370a) | 2026-10-16 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.3`    | [`bd43893`](https://github.com/openai/codex/commit/bd43893f3db678fcb7124296905a65b2dfa9dac0) | 2026-10-17 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.4`    | [`c108a58`](https://github.com/openai/codex/commit/c108a58ad4fa46c06079681e96069d01d118b4a7) | 2026-10-19 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.5`    | [`de85a07`](https://github.com/openai/codex/commit/de85a077cd48f5ce3c49ddd6037de394d8ff5f85) | 2026-10-19 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.6`    | [`835707e`](https://github.com/openai/codex/commit/835707e3d8ed3240fb467804d3715dac0e1871fc) | 2026-10-19 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.7`    | [`fe136d4`](https://github.com/openai/codex/commit/fe136d4e70ef2b5bbed40a2d22b3aabf267796d3) | 2026-10-20 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.8`    | [`57dedf2`](https://github.com/openai/codex/commit/57dedf20a502c8d1d13b89f0a9c0cbf4f5f71320) | 2026-10-20 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.164.0-alpha.9`    | [`bcee56b`](https://github.com/openai/codex/commit/bcee56bcdb74cbf08fc6dd47ef0079fded4bba9a) | 2026-10-21 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |
| `0.165.0-alpha.1`    | [`4cf2c16`](https://github.com/openai/codex/commit/4cf2c16e4bc67809f620582d1999818e1b51eb2e) | 2026-10-23 | 图片扩展新增文件引用，原样转发 | 候选，Mac 未验 |

## 复核命令与测试

- `node scripts/codex-shared/audit-protocol.cjs`：按清单中的精确官方提交重新读取 schema 和 Rust 定义，逐字段比较；不写入账户、会话或发行目录。
- `npm run test:codex-shared`：包含全部清单版本的合成服务、活动/排队拒绝、工具输出、版本拒绝和候选入口测试。
- `xvfb-run -a node scripts/native-e2e-versions.mjs`：Linux 构建一次应用，逐版本运行现有 g/h 四条端到端用例。此环境已有虚拟显示时可直接设置 DISPLAY 运行。不自动重试。每个版本单独启动服务；协议字段相同，不伪造其他版本的未知格式。

本次官方逐版本比较 20/20 无依赖字段差异；连接器 26/26、原生夹具 17/17 通过。共享 g/h 每版本四条，共 80/80 通过，测试进程累计 537.6 秒，不含一次应用构建。六项既有 CI 和 Native resume E2E 的结果在任务完成记录与 PR 中补充。合成测试不构成真实账户、桌面 Codex 或 macOS 验收。候选状态不能据此升为准入。
