# Codex / Maestro 双端接续使用说明

适用版本：Maestro Harness Bridge `1.0.1-hb.4`，macOS Apple Silicon 预览。共享模式是单独启用的本地连接器；只安装 Maestro 应用不会自动开启。

hb.4 沿用 hb.3 的连接器实现，仅随新版本重新归档。已经正常启用共享的用户可继续使用现有连接器目录和自定义路径，无需为信息流更新重新启用或退出 Codex。

## 能做什么

Codex 和 Maestro 保持打开，轮流继续同一条已有原生 Codex 会话。消息仍由 Codex 原生 harness 执行，沿用其登录、订阅和上下文；没有复制历史、新建替代会话或分支。两端连接同一个原生执行进程，保留单写入者约束。

上一轮结束后再换端发送。正在生成或有队列时连接器会拒绝追加；状态检查不是跨客户端原子锁，因此不要在两端同时按发送。Maestro 会约每两秒检查当前可见本地 Codex 会话的变化，重新获得焦点时也检查。后台更新保留草稿和阅读位置，不自动跳到其他聊天。

## 安装前提

- 当前只验证 `codex-cli 0.163.0-alpha.11.1`。连接器版本检查遇到其他版本会拒绝启用；不要修改版本字符串绕过检查。
- 本次验证的桌面发行包位于 `/Applications/ChatGPT.app`，内置 CLI 位于 `Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`。其他安装布局尚未适配，不要把任意可执行文件冒充该原生程序。
- 安装 Python 3 和 Node.js 22 或更新版本。启动器使用 `/usr/bin/python3`；Node 从 PATH 寻找，缺省再尝试 `~/.local/bin/node`。可在启动环境中明确设置 `MAESTRO_SHARED_NODE` 为 Node 的绝对路径。
- 先在 Codex 原生客户端登录，并确认同一账户、同一主机能打开目标会话。连接器不提供统一登录或跨账户订阅共享。

## 首次启用

1. 下载本 Release 的 `Maestro-Codex-Shared-1.0.1-hb.4.zip`，按 SHA-256 清单校验，解压到固定位置，例如 `~/Applications/Maestro-Codex-Shared-1.0.1-hb.4/`。不要在运行时移动目录。
2. 等 Codex 与 Maestro 中的生成和队列结束，正常退出 Codex。启动器不会替你关闭应用。
3. 在终端运行：

   ```sh
   zsh "$HOME/Applications/Maestro-Codex-Shared-1.0.1-hb.4/enable-sharing.command"
   ```

4. 脚本检查文件完整性、原生版本与签名，再请求打开桌面 Codex。若共享进程已经运行，会提示无需重复启动。
5. 在 Maestro 中打开目标 Codex 智能体配置，把自定义可执行路径设为解压目录中的 `codex-shared.py`。这项配置作用于该智能体下所有页签，不是仅当前页签。仅给需要接续已有会话的配置使用；新建会话继续使用普通 Codex 配置。
6. 从项目会话列表打开已有的原生会话，在两端分别核对标题及历史，再轮流发送。遇到失败时保留错误，不删除原生写锁或历史。

## 日常启动和退出

两款应用已经打开时，切换发送不需要重启或重跑命令。彻底退出 Codex 后，通过 `enable-sharing.command` 再开；从原生 Dock 入口冷启动不会自动接入共享服务。没有修改全局环境变量、登录项或官方应用图标。

Codex 拥有执行进程，退出前应结束两端的活动回合。原生客户端要求确认权限时，到同一条 Codex 聊天处理，或者停止该轮；连接器不会代替你批准。

只读检查包与版本：

```sh
/usr/bin/python3 "$HOME/Applications/Maestro-Codex-Shared-1.0.1-hb.4/codex-shared.py" --connector-check
```

检查已运行的共享进程：同一命令最后参数改为 `--connector-verify-runtime`。检查会输出本机运行信息，请勿把原始输出当作可公开日志。

## 回退

1. 等两端所有任务、队列和后台终端结束，正常退出 Codex。
2. 运行同目录 `disable-sharing.command`。它检查共享服务身份和活动状态，仅在空闲时请求正常停止；不强制杀进程，不删除原生写锁或历史，再请求按原生方式打开 Codex。
3. 将 Maestro 对应智能体的自定义可执行路径恢复为先前值；之前未设置则清空。原生会话 ID 和历史不变。

脚本拒绝回退时，按它报告的活动状态处理，不手动删锁。旧安装包和自己的配置备份可用于应用回滚。

## 已知限制

- 支持已有本地会话的顺序接续，不支持通过连接器创建新会话、分支、远程主机或双端并发发送。完整实机验收针对同一条已有 Codex 会话；不能外推到所有账户、智能体配置或提供方。
- Stop 已验证中断原生对话轮，随后可换端继续。已启动的终端命令可能继续运行：验收中的等待命令在中断对话后自然结束，不能把 Stop 当作立即终止全部子进程的保证。
- 当前源码的 Codex 历史条目改用最终回答首段的本地摘录，不经共享连接器追加 Summary，也不覆盖共享线程的模型或思考等级。原有 Summary 轮保留；已发布的 hb.4 包仍可能追加摘要轮。
- 原生权限、网络和版本升级仍受 Codex 本身约束。版本改变后需重新验证，不能承诺后续升级自动兼容。
- 当前源码的连接器会按调用增量推送命令的累计输出，约每 200ms 合并一次，完成前补发剩余部分。回答正文仍按完整条目传递，不承诺与 Codex 逐字刷新的粒度或延迟一致；已发布的 hb.4 包不包含这次源码变化。
- 连接器运行目录在 `~/.codex/maestro-shared-v2`，含仅本用户可读的运行描述和日志，不应提交到 Git。凭证仍由原生 Codex 管理。

## 源码与实现边界

源码在仓库 `scripts/codex-shared/`；`npm run package:codex-shared` 生成独立包，`npm run test:codex-shared` 运行不接触真实账户的合成测试。包包含 ws 的许可证和本仓库许可证，不分发 Codex 二进制或个人认证。

启动器通过 exec 保留签名原生进程作为桌面的直接子进程，独立 sidecar 只转换传输封装。没有修改官方应用、签名检查或授权机制。Maestro 通过 `exec --json resume` 适配器连接原生服务，不重新实现模型的执行循环。

## 桌面更新后的源码检查与验收

本节适用于后端第三阶段源码；上文已发行 hb.4 附件没有重建。版本明细和逐标签差异见[协议审计](codex-shared-protocol.md)。`versions.json` 中只有 `admitted` 能日常启动；当前仍只有原锁定版本。`candidate` 不等于可用版本，未知版本也不会自动加入候选。

1. 桌面更新后，在仓库根目录运行只读检查：

   ```sh
   python3 scripts/codex-shared/check-version.py
   ```

   已安装新版源码连接器时，也可运行其 `--connector-check`。未知或候选版本返回非零，并报告方法、参数或字段差异；导出不受支持时明确报告导出失败，不把缺少证据当作兼容。协议相同也会提示仍缺 Mac 验收及明确准入。检查不会启动共享服务或修改版本清单。

2. 版本已列为候选时，在 Mac 上用精确的桌面内置 CLI 运行共享真实验收：

   ```sh
   MAESTRO_E2E_REAL=1 \
   MAESTRO_E2E_CODEX_PATH=/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex \
   MAESTRO_E2E_SHARED_PATH="$PWD/e2e/fixtures/native/candidate-shared.py" \
   npm run test:e2e -- e2e/native-shared.spec.ts
   ```

   候选入口只接受测试创建的私有目录，每次调用都重新检查精确版本、实际导出的协议和原生签名。它没有跳过检查的参数，不安装为桌面启动器，也不开放日常使用。测试沿用独立账户副本和临时会话；原账户不写入。它验证真实原生服务上的双客户端和摘要行为，桌面 GUI 操作仍不能由 Linux 合成结果代替。

3. 向维护者提供版本号和 `e2e-results/native-summary.json` 的无对话内容摘要，确认 g/h 全通过。不要提交截图、trace、原始日志或会话。维护者结合协议审计和用户 Mac 验收，在小 PR 中把该精确版本的状态改为 `admitted`，记录验收依据，跑全套检查后合并。没有两项证据不准入。候选清单以外的新版本先由维护者按官方提交补齐审计与合成测试，再重复此流程。

本轮没有安装、打包或发布；源码通过不代表现有发行附件已经更新。
