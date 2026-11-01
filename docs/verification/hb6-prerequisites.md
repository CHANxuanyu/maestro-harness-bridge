# hb.6 后端与测试前置项

本轮基于 `57341e712`，分支 `codex/hb6-prerequisites`。只运行合成程序，没有运行真实模式、真实账户或模型，没有变更共享连接器的准入版本。没有制作或发布安装包。

## Codex 依据与版本决定

- 普通 exec 在 item started/completed 中给出命令状态和完成输出，忽略 commandExecution/outputDelta；item.updated 用于其他条目，不能据此承诺命令增量。依据 [11.1 JSON 事件处理器](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.1/codex-rs/exec/src/event_processor_with_jsonl_output.rs)。[11.2 同文件](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.2/codex-rs/exec/src/event_processor_with_jsonl_output.rs) 的 Git blob 同为 `73e0c9d911c82aae67c44e6b1a4ce54c7092b6be`，升级它不能解决这个输出差异。
- 原生完成命令是 `event_msg / item_completed / CommandExecution`，包含 id、command 数组和聚合输出。依据 [items.rs](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.1/codex-rs/protocol/src/items.rs)、[protocol.rs](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.1/codex-rs/protocol/src/protocol.rs) 和[持久化策略](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.1/codex-rs/rollout/src/policy.rs)。ExecCommandBegin/End 是瞬时事件，不能假定存在于持久化文件。旧 function_call 读取保留。
- effort 是可空字段。用户提供的 11.1 实机样本确实为 null，不复制样本内容或会话标识入库。默认场景核对原生值与现有“未记录”显示；显式 high 场景仍必须显示 high。
- [exec 关闭流程](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.1/codex-rs/exec/src/lib.rs) 在最终回答后仍有线程退订和客户端关闭；测试必须等进程结束。假程序复现观察到的 1100ms 间隔。
- [writer_lock.rs](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.1/codex-rs/rollout/src/writer_lock.rs) 使用 OS 文件锁与协调锁，不是按时间过期的租约。守卫释放文件句柄并清理路径；残留文件名不等于活跃锁。成功外部调用现在等管道正常关闭，不再杀整个进程组。真实冲突根因仍待实机复验，不删除锁，不自动重试。
- 真实模式继续固定 11.1，保留可重复基线。11.2 的 stdout 处理器相同不等于完整兼容性通过，自动跟随 Desktop 更新也不适合作为测试锁定策略。待维护者批准独立的 11.2 隔离验收后再决定是否更新固定版本；共享连接器仍遵循冻结清单。

## 已运行与限制

- 临时目录回归 2/2；Codex 契约、正常 teardown、外部进程隔离相关夹具 9/9；Codex 解析、消息和 revision 单元测试 219/219。
- Codex 五条新回归均先失败再通过。临时回退三个实现文件后再次出现 5 条失败，恢复后 9/9。这是夹具反证，不能替代 Electron 反证。
- 全量夹具中三条共享 socket 用例受沙箱 `listen EPERM` 阻挡，未跳过。Electron 在 renderer 构建时因外部 node_modules 链接内的 `.vite-temp` 写入被拒而停止，没有启动测试场景，也没有绕过限制。
- 单元命令：`npm run test -- --configLoader native src/__tests__/main/parsers/codex-output-parser.test.ts src/__tests__/main/storage/codex-session-storage-messages.test.ts src/__tests__/main/storage/codex-session-storage-revision.test.ts`。

## 交给 Opus 的界面验收

1. 普通 Codex exec 运行长命令，期间保持运行状态，完成后显示完整输出；共享模式保留底部跟随与手动上滚。涉及说明的范围请据此调整，本轮没有修改界面或文案。
2. 默认 effort 的历史消息信息应按原生 null 显示未记录；显式配置 high 的原生回合应显示 high。
3. 终端完成后立即在 Maestro 续接同一会话。如果 CLI 报 active writer，应清楚显示原生拒绝并保留输入；不要暗示已经恢复，也不要自动重试或删除锁。本轮没有新增提示文案。

## Mac 合成验收命令

临时目录修复需先验证默认环境，无额外变量：

```sh
npm run test:e2e:fixtures
npm run test:e2e
```

其余定向场景使用固定物理临时目录，均为假程序模式：

```sh
TMPDIR=/private/tmp/ MAESTRO_E2E_TEMP_ROOT=/private/tmp npm run test:e2e -- --grep 'codex [abdefg]:'
TMPDIR=/private/tmp/ MAESTRO_E2E_TEMP_ROOT=/private/tmp npm run test:e2e -- --grep 'omp [abcdef]:'
```

维护者需分别临时回退实现以重现失败，再恢复实现重跑，反证改动不提交。旧 hb.5 冻结资产不改写；其默认 Mac 临时目录限制应由证据维护者写入原验证记录的 limits。本轮不运行真实模式，后续真实验收须另行授权。
