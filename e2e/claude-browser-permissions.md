# U5 第三轮 Claude 浏览器审批验收

本文件是交给 Opus 的沙箱外验收清单，本轮没有运行 Electron 或浏览器。所有实例、用户、
项目和审批请求均使用临时数据及合成提供方，不使用个人账户或真实模型。

## 已有可执行 Codex 回归

在本克隆执行，关闭自动重试：

```sh
MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-codex-app-server.spec.ts --workers=1 --retries=0
```

此场景重建并检查 Codex 原型的桌面允许、CLI 拒绝、追加及停止。它不覆盖 Claude
浏览器或两用户认证，不能代替下面的人工验收。不得用真实会话命令替代合成提供方。

## Claude 浏览器与多窗口补充验收

使用隔离的临时 HOME、应用数据及项目启动 Electron，构建并启用该临时实例的
web-desktop。创建临时网页登录用户 A、B。审批请求由测试夹具通过现有 Claude relay
登记及请求入口注入，关联临时对话，不能把调用方身份塞进 `permission:respond` 参数。
当前仓库尚无这组浏览器场景的自动运行脚本，以下步骤需 Opus 在隔离实例中补充执行。

分别在 `newShell=false` 与 `newShell=true` 下检查：

1. 桌面主窗口产生无所属用户的 Claude 待审批请求。已认证的浏览器用户 A 允许，响应为
   true，夹具收到 allow。另建请求，由用户 B 允许，也应成功。
2. 桌面副窗口产生无所属用户的 Claude 请求。浏览器允许应成功，不能因为 bridge 经主窗口
   转发而返回 false。用桌面主窗口尝试批准副窗口的另一个请求应失败，副窗口本身可批准。
3. 用户 A 发起的 Claude 请求，用户 B 的浏览器批准返回 false，请求仍 pending；A 批准成功。
   在消息或额外参数中伪造 userId、trustedCli、sender、webContentsId 不能改变 B 的身份。
4. 关闭网页登录后，用通过实例访问认证的浏览器批准桌面请求，仍应成功。无 acting user
   不等于未通过服务端访问认证。
5. 对已成功响应的请求再次响应、对已结束进程的请求响应，以及等到默认五分钟超时后
   才响应，均返回 false，夹具不能再收到 allow。允许和拒绝都走同一归属校验。
6. 用新的主窗口请求执行 `maestro-cli permission-respond <request-id> allow`，应成功；
   同命令处理副窗口请求应失败。CLI 仍不提供窗口选择，Claude 请求 ID 取自已有审批事件。

另在 `newShell=true` 且开启 Codex 原型时检查：浏览器 A、B 和未启用网页登录时的浏览器
都不能批准 Codex 原型请求，也不能读取 `codex-turn permissions` 对应列表；桌面所属窗口
和通过服务端认证的 CLI 保持原有用户及窗口校验。

记录首次结果，不自动重试。将真实浏览器认证、网页按钮、Electron 多窗口、CLI 和
夹具收到的决定分别记载，不能以主进程单元测试代替页面验收。
