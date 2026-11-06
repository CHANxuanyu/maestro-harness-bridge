# 新界面对话权限边界验收

本轮未启动 Electron。以下是交给 Opus 的场景，不能记作自动化场景已经通过。使用 `NativeApp` 的临时项目、临时应用数据与合成 Claude、Codex 提供方，禁止连接个人账户或真实模型。失败保留首次结果，不重试。

## 构建和既有自动化回归

```sh
MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-new-shell.spec.ts --grep 'permission (inheritance|review)' --retries=0
```

该命令重建源码后运行既有六条权限场景。下面的新增场景需在同样的临时夹具中补做；命令本身不包含它们。

## 暂缓恢复

1. `newShell=true`，建立两个空 Claude 对话，均设为标准权限。暂缓其中一个，填写合成唤醒提示。也可用 `maestro-cli snooze tab <tab> 1h --agent <owner> --wake-prompt <fixture-text>`。
2. 经 `update-agent <owner> --provider codex --force` 换工具，再把该工具路径和环境设为 `e2e/fixtures/native/codex` 与本次临时数据目录。
3. 用 `unsnooze <snooze-id>` 提前恢复。读取恢复对话的权限和夹具 `fixture-invocations.jsonl`：必须是 readonly，包含 `--sandbox read-only`，不包含 `--dangerously-bypass-approvals-and-sandbox`。唤醒提示只执行一次。
4. 用两条标准权限对话组成分屏组，暂缓整组，重复上述过程，核对每个成员均为只读且布局恢复。
5. 单个和分屏组分别重复定时唤醒。通过 `snooze reschedule` 改到近期时间，等待调度器一个 15 秒周期，核对与提前恢复相同。
6. 在测试构建中将目标能力设为不支持标准权限和只读。提前恢复及定时唤醒均应保留原暂缓记录、组内全部成员及提示；不得创建进程、入队或释放暂缓记录。恢复前已重新打开同一对话或同一组的重复分支也要检查。

## 分屏新建与所属窗口

复用 `native-new-shell.spec.ts` 中 owner timeout 的两个窗口夹具和只丢弃 `windows:readConversationPermissions` 消息的故障注入。保持 A 的缓存完全访问，在 B 收紧为只读并制造 250 毫秒无答复。

分别从 A 的命令面板“在下方新建 AI 聊天分屏”和对应快捷键创建。新对话必须只读，原对话权限不变，分屏布局和焦点正确。恢复 B 的应答再做一次，必须采用所属窗口实时来源。此动作没有直接 CLI 对等命令，普通 `tab new --agent <owner>` 仅对照权限解析。

## 从消息处分叉

1. 用合成 Codex 提供方建立只读对话，在一条消息上点击“从这里分叉会话”。
2. 核对新对话是新的原生会话，带有截至该消息的上下文；来源对话不变。
3. 核对自动启动的首轮已是 readonly，夹具参数包含只读沙箱且不包含完全访问参数。
4. 将另一个后台对话设为只读，来源设为完全访问，重复分叉，确认明确来源优先于底层兜底。
5. 目标不支持限制时，不创建新对话、不启动首轮。打开已有原生历史仍走原路径，不套用新建权限继承。

## 旧界面与改动面板

`newShell=false` 时检查普通新建、分屏、暂缓单个和整组恢复、消息分叉，权限字段和首次启动参数应与修复前一致。对同仓库内两条对话，展开一个文件差异后切换：旧界面不因对话 ID 改变重新请求或收起差异，新界面应刷新并收起。目录或 SSH 主机改变时两种界面都必须重载。

这些场景不覆盖真实 SSH 连接、真实提供方审批、实际浏览器控件或发行包安装。Vitest 中的权限与进程 mock 通过不能替代这里的 Electron 验收。
