# Codex app-server 原型的沙箱外验证

本文件是交给 Opus 的待执行清单。本轮仅收集了 `native-codex-app-server.spec.ts`，没有启动 Electron，也没有运行真实 Codex 会话。

## 合成 Electron 场景

在任务源码根目录运行：

```sh
MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-codex-app-server.spec.ts --workers=1 --retries=0
```

脚本重建 main、renderer、CLI，再运行 native 项目。测试创建独立临时 HOME、Maestro 数据目录和提供方目录，设置 `newShell=true`、`codexAppServer=true`，关闭自动命名及自动摘要。唯一提供方可执行文件是 `e2e/fixtures/native/codex-app-server`，它只读写指定临时夹具目录和 stdio，不调用模型、真实 CLI 或网络。不要改为 `MAESTRO_E2E_REAL=1`，本场景会拒绝真实模式。

自动化覆盖顺序：

1. 新建 Codex 对话，通过 CLI 选择标准权限。第一次发送必须为 thread/start，后续三次为同一 threadId 的 thread/resume。
2. 文件审批显示 Codex、文件路径和差异。审批前不存在标记文件；界面允许后存在，内容为一行合成数据。
3. 命令审批通过 `codex-turn permissions` 取得 requestId，再用 `permission-respond <request-id> deny` 拒绝。弹窗消失，没有标记文件。
4. 运行中输入合成追加文字，点击本轮追加按钮。最终回答含原文，草稿清空；协议记录中只有一次 turn/steer。
5. 再发一轮保持运行的合成任务，用 `codex-turn stop <process-id>` 停止。协议记录必须有 turn/interrupt，待审批列表为空。
6. 总计一条 thread/start、三条 thread/resume、四条 turn/start、一条 turn/steer。断言失败后保留 NativeApp 的失败 trace，先分析，不自动重试。

该夹具未生成真实原生转录，因此此脚本验证活动对话接续，不验证应用重启后从原生历史恢复。

## 仍需人工检查的合成场景

沿用同样的临时测试应用和夹具，不操作已安装的日常应用：

- 中文和英文分别检查设置说明、Codex 审批标题、完整命令作用目录及文件差异、本轮追加按钮和失败提示。切换语言不清空输入草稿。
- 在追加请求未确认时继续编辑草稿或切换对话。原请求确认后不能清掉新草稿；请求失败保留原文，不排队、不重发。组件回归已覆盖这三项，Electron 尚未执行。
- 主窗口等待审批时停止，弹窗应消失；随后对旧 requestId 执行允许应失败，不写文件。强制停止要确认旧进程退出后才允许下一轮，不能只看界面变为 idle。
- 开关组合 `false/false`、`true/false`、`false/true` 不显示原型控制，普通完全访问和只读对话继续既有 exec 通路。对保存的标准权限对话应明确拒绝，不能回退到跳过审批。
- 运行中切开关，再点击追加，主进程拒绝对旧 exec 进程发送 RPC，草稿保留；现有 app-server 进程仍可停止。
- SSH 普通完全访问和只读使用既有 exec 路径；标准权限拒绝。只核对模拟主机参数，真实 SSH 不属于本轮已验范围。

## 原型未覆盖

主窗口以外的审批归属、真实浏览器控制、强制并行回合、多客户端并发写同一原生对话、图片、网络授权、MCP 提问和动态工具均未完成验收。`codex-turn stop` 仅停止指定进程；界面 Stop 额外取消队列与咨询的完整对等仍在 CLI Open gaps 中。真实 CLI 版本兼容性、模型是否遵守审批和沙箱、跨平台进程树清理、发行包内转换器加载需要另外验证，本轮不执行真实会话。
