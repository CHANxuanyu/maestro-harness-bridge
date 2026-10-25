# Factory Droid 格式确认结果

2026-10-25，后端第三阶段任务二的 Factory 部分受阻。已有代码仍可读取它原先支持的格式；本轮没有充分的官方证据证明当前 CLI 的输出和落盘契约，因此不新增解析分支、增量跟随或假程序。

## 已核对的官方来源

| 锁定来源                                                                                                                                                                                                        | 已确认的内容                                                                         | 不能证明的内容                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [@factory/cli 0.249.0](https://registry.npmjs.org/@factory/cli/0.249.0) 及同版本官方 Linux 平台包                                                                                                               | npm 入口加载平台原生可执行文件，包可只读取得                                         | 可执行文件中的字符串不足以证明 `droid exec -o stream-json` 的事件、取消语义及对应会话 JSONL；本轮未还原出可审查的完整契约 |
| [@factory/droid-sdk 0.10.0](https://registry.npmjs.org/@factory/droid-sdk/0.10.0)，[官方 TypeScript 仓库提交](https://github.com/Factory-AI/droid-sdk-typescript/tree/4e2c75277e4da54e9afca1977472063ea0a4cce2) | SDK 的 JSON-RPC 传输、消息与 `session_start` 元数据 schema                           | SDK 消息不能直接等同于产品当前调用的 `stream-json` 或原生会话文件                                                         |
| [官方 Python SDK 提交](https://github.com/Factory-AI/droid-sdk-python/tree/aa6fd945e3c487f9bbfb39bf8fbffb061070886a)，0.5.0                                                                                     | 另一份 SDK 接口可交叉阅读                                                            | 同样不能证明当前 CLI 的 stdout 与历史文件映射                                                                             |
| [@factory/cli 0.1.2-dev.7](https://registry.npmjs.org/@factory/cli/0.1.2-dev.7)，gitHead `50bcc859d6fbb320bae813061e4c991ea6a70dfe`                                                                             | 可读 `bundle/droid.js` 使用 `--session-id`、`--message-id` 和旧 `session_start` 记录 | 不含 `stream-json`、`--resume` 或当前 completion 的 numTurns 字段；不能作为当前接续适配依据                               |
| [@factory/cli 0.1.0](https://registry.npmjs.org/@factory/cli/0.1.0)，gitHead `c14a83aba8030da4b6814c910a5f48ddf8cc68c6`                                                                                         | 更早的可读 `bundle/factory.js`                                                       | 前身 CLI 不证明当前 Droid 协议                                                                                            |

当前产品的 `factory-droid-output-parser.ts` 使用 `system/init`、`message`、`completion.finalText/numTurns/durationMs/session_id`。仓库原有注释说明曾对 2026 年 1 月的实际输出做验证，但没有把它绑定到可核对的官方版本。本阶段要求不能仅凭旧测试、字符串、SDK 相似字段或版本猜测扩展产品。

## 验收边界与后续入口

本家实时/历史工具一致、取消与失败配对、迟到事件过滤、模型/effort、revision/增量读取及 a 至 f 的新端到端验收均记为受阻。没有虚构字段，没有把未知状态改成成功，也没有宣称既有实现失效。未知部分按计划跳过，其他提供方继续实施。

恢复本项需要一份锁定官方 CLI 版本、可审查的 stdout 和原生 JSONL 定义，并能定位工具调用/结果、取消及终止边界。随后仍须先失败回归、再实现、再做端到端反证。当前不提供假装可用的 Factory Mac 验收命令。真实账户、macOS 和真实 CLI 均未验。

核对只读下载与解包，未安装、运行官方 CLI、升级依赖、打包或发布；包体、转录和任何账户资料不入库。本记录不涉及界面，不产生 Opus 前端修改项。
