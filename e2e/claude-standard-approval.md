# Claude 标准权限审批验收

本任务没有启动 Electron，也没有运行真实 Claude。单元测试和合成主机测试通过不代表下面的跨进程链路已通过。

## Opus 运行合成场景

```sh
MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-claude-permission.spec.ts --retries=0
```

命令构建主进程、renderer 和 CLI，再运行 7 条场景。全部使用 `NativeApp` 的临时项目、临时应用数据及合成 Claude；真实模式在建立夹具前直接报错。`claude-permission.cjs` 启动应用实际配置的 MCP bridge，通过 initialize、tools/list、tools/call 请求审批，不调用模型。每个场景保留首次失败，不自动重试。

覆盖内容：

1. 新界面允许一次，审批前无文件，审批后只写一次；第二次写入仍需审批。
2. 新界面拒绝，无写入，工具报告拒绝，后续普通回合能继续。
3. CLI 允许，桌面弹窗同步消失，落盘结果与按钮相同。
4. CLI 拒绝，桌面弹窗同步消失，落盘结果与按钮相同。
5. 等待审批时通过现有 `process.interrupt` 中断，bridge 退出、请求消失、临时 MCP 配置删除，无写入且能继续。
6. 不回应审批，等待真实的 300 秒超时。无需缩短生产超时或注入测试后门。界面收起、返回拒绝、无写入、迟到批准被拒绝，能继续。此用例单独允许 390 秒。
7. 旧界面的 API/print 路径仍显示原来的 Allow 按钮，审批和收尾工作。

六条新界面场景先保存 interactive token source，确认实际参数仍为 print 并携带 relay，不包含跳过权限参数。新弹窗切中文，检查完整工具输入、项目路径和默认焦点；CLI 列表不得包含认证 token。全部场景检查 bridge 退出记录、MCP 配置删除和迟到批准失败。停止场景验证进程中断链路，不冒充点击输入框停止按钮的验收。

## TUI 与 SSH 边界

`src/maestro-p/open-tool-calls.ts` 中 `withPermissionBypass()` 会在未显式给出 permission mode 时添加 `--dangerously-skip-permissions`。`tui-driver.ts` 会接受 bypass 首次确认，它没有 Maestro 的标准权限审批 relay。不能把 TUI 当作标准审批已实现。

`newShell=true` 时，标准权限固定走本机 print，不改写已保存的 token source 偏好；显式 maestro-p 路径、SSH，以及冲突的自定义权限参数会拒绝启动。权限菜单说明 TUI 和 SSH 暂不支持，启动拒绝有中英文解释。不会通过本地 realpath 解析远程目录，也不为了判断标准审批去探测远程 maestro-p。

旧界面 TUI 路径没有改变，仍存在上述绕过风险。完全访问与只读的模式选择保留原逻辑。自定义包装脚本内部行为、原生 Claude 的预先允许规则、hooks 和 settings 内容不在这次参数检查的保证范围内。标准权限只对 Claude 自身决定需要询问的工具请求弹窗，不承诺每个工具都询问。

## 最少一次真实验证，另行授权后执行

在隔离的临时项目中，用当前待验收构建、新界面、本机 Claude、标准权限和已登录账户，确认没有项目或账户预先允许该工具的规则。记录实际 CLI 版本、源码提交及构建身份。不要将合成测试改成真实账户模式。

仅发送一次明确的请求，例如：“只使用 Write 工具创建当前临时项目的 approval-smoke.txt，内容为 approval smoke。不要改其他文件。”

观察真实 Claude 是否通过 permission-prompt-tool 调到应用 bridge。审批前文件必须不存在，弹窗必须显示正确项目、工具与完整输入；只点击一次允许后，文件才出现且内容正确。回合结束后待审批列表为空，MCP 临时配置删除。若没有收到审批，保留实际参数与脱敏诊断，不能把模型直接拒绝或已预先授权当作此验证通过。

这一轮真实调用只能证实当前 CLI 版本的最小批准契约。真实模型被拒绝后是否解释、另提方案或继续推理，真实停止和超时，SSH、Windows、Linux、发行包，以及跨窗口和浏览器的审批展示仍需另外验收。本任务没有执行任何一次真实调用。

## 已知交互缺口

审批遮罩覆盖输入框的停止按钮；Escape 当前表示拒绝这个工具，不表示停止整个回合。现有 CLI Stop 也没有与桌面完整停止处理函数对等。此轮保持原动作范围，通过 IPC 中断验证收尾，将直接停止入口留在 CLI 对等表的 Open gaps。
