# 后端第三阶段计划

状态：任务一、任务三及 Copilot 已合并；Factory 格式核查受阻，真实环境仍未验。Copilot 的最新验收、合并与主线 CI 见 [PR #15](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/15)，性能结果见[性能 PR](https://github.com/CHANxuanyu/maestro-harness-bridge/pulls?q=is%3Apr+head%3Acodex%2Fstage3-performance)。2026-10-25 起草，用户已确认由 Codex 依次完成三项任务，无需再等审阅。

前三轮（[后端可靠性](backend-reliability.md)、[后端第二阶段](backend-followups.md)、[端到端验收](native-e2e.md)）把 Codex 和 Claude Code 的原生接续做扎实了，并建好了能在 CI 里驱动真实应用的端到端框架。本阶段处理剩下的三处后端缺口，按价值排序：

1. **共享模式版本适配：** 共享连接器只接受一个写死的版本，桌面 Codex 一更新就失效。
2. **其余五家提供方的接续对齐：** 项目历史已经扫描 OpenCode、Copilot CLI、Factory Droid、Oh My Pi、Grok，但前三轮的修复和测试只覆盖了 Codex 与 Claude Code。
3. **长会话与大量历史的后端性能：** 至今没有在大数据量下测量过。

三项依次进行，每项内部可以分多个 PR。某项受阻时写明原因，继续下一项，不要停下来等。

## 任务一：共享模式版本适配

- **依据：** `scripts/codex-shared/codex-shared.py` 用 `VERSION='codex-cli 0.163.0-alpha.11.1'` 做精确比较，`MANIFEST.json` 也绑定同一版本。桌面 Codex 自动更新内置 CLI 后，连接器会拒绝启动，共享模式直接不可用，直到有人手动适配。
- **做法：**
  1. **列出连接器实际使用的协议面：** 把连接器用到的方法、参数、通知和字段写成测试里可读的明细（不是哈希），并有测试保证代码只使用明细里的部分。
  2. **差异报告：** 对锁定版本之后 openai/codex 的每个正式标签（包括桌面内置使用的 alpha 版本），根据该标签提交在仓库里的 app-server 协议定义，逐项比较上述协议面，生成一份差异报告，写进 `docs/codex-shared.md` 或其附录。
  3. **合成服务按版本切换：** 合成 app-server 支持按版本模拟。对差异报告认为兼容或已处理的版本，运行连接器测试和端到端场景 g、h。
  4. **检查命令给出原因：** `--connector-check` 遇到未知版本时，说清楚是哪些协议面不同；若本机 CLI 能导出自身的协议定义，就用它自动比较，不再只回答“未测试的版本”。
  5. **准入规则不放松：** 精确版本比较改成明确的版本清单，不用通配，未知版本仍然拒绝。一个版本要进入清单，必须同时满足两条：协议面没有变化，或者变化已经处理并有测试；并且用户在 Mac 上用该版本跑通真实模式的共享场景。只满足前一条的版本记为“候选”。候选版本只能在真实模式的验收命令里启用，日常使用不可用。
  6. **更新流程文档：** 写清楚桌面更新以后，用户先运行哪条检查命令，再运行哪条验收命令，最后由谁提交把版本加入清单的小 PR。
- **验收：** 锁定版本的行为不变；每个候选版本都有差异报告和合成测试结果；未知版本的拒绝信息能指出具体差异；没有任何绕过版本检查的路径。真实桌面验证标记为未验。

## 任务二：其余五家提供方的接续对齐

- **依据：** OpenCode、Copilot CLI、Factory Droid、Oh My Pi、Grok 的会话存储都没有实现 `getTranscriptRevision()` 和只读增量读取，也没有原生模型字段和工具结果状态的配对。`useNativeTranscriptFollow` 只跟随 Codex 与 Claude Code，端到端的假程序也只有这两家。
- **做法：** 每家单独一个 PR。顺序按格式能否从官方来源确认来排：开源的（OpenCode、Grok 等）在前，只有安装包的在后。每家做以下几步：
  1. **确认格式：** 在锁定版本的官方源码或官方包里找到实时输出和会话文件的格式，记下版本和出处。确认不了的，这家标记为受阻并跳过，不猜格式。
  2. **复查三类问题：** 用这家确认后的格式，检查 Codex 前两轮修过的三类问题：工具输入在实时解析与历史读取中不一致；失败、取消和成功分不清（包括用户中断）；回合结束后迟到的事件仍被转发。复现了才修，先补能失败的回归。
  3. **历史读取：** 按调用 ID 配对工具结果，带上状态和输出；原生记录了模型或思考等级的，填入 `SessionMessage.model` / `effort`，没记录的保持缺省。
  4. **增量读取与跨应用刷新：** 实现版本探测和只读增量读取，要求与完整读取结果一致；把这家加入 `useNativeTranscriptFollow` 的跟随范围（只改这个 hook 的提供方条件，不改界面）。
  5. **端到端：** 在 `e2e/fixtures/native/` 增加这家的假程序，覆盖场景 a、b、c、e、f；能做重启场景的也加上。真实模式在本机装有这家 CLI 时才运行。
- **验收：** 每家完成的项目和受阻的项目都写进记录；已完成的部分，实时与历史结果一致，增量与完整读取一致，端到端场景在 CI 中通过。

## 任务三：长会话与大量历史的后端性能

- **做法：**
  1. **合成数据：** 生成 Codex 与 Claude Code 的大数据量样例，包括 1 万和 5 万条消息的单个会话、超过 100MB 的转录文件，以及一个项目下 5000 个会话。脚本放在 `scripts/` 或测试夹具中，数据本身不入库。
  2. **测量与预算：** 在 `vitest.performance.config.mts` 下测量主进程的关键路径：项目历史扫描、打开会话的首次读取、跟随刷新的增量读取、分页补载、搜索，以及每次 IPC 返回的数据量。记录基线，为每条路径定预算。
  3. **只修测到的瓶颈：** 只修复测量证明超出预算的主进程热点，复用现有缓存与增量机制，不新增缓存体系或哈希。渲染层的热点只记录测量结果，交给 Opus。
- **验收：** 有可重复运行的性能用例和基线；修复项给出修改前后的数字；性能用例纳入 CI 的方式写成建议，由用户决定。

## 实施范围

- **分支与合并：** 分支从最新 `codex/i18n-zh-cn` 建立，本计划在 `codex/backend-stage3` 上。每个 PR 目标为 `codex/i18n-zh-cn`，在六项既有检查和 `Native resume E2E (Linux)` 全部通过后由 Codex 合并，再确认主线合并提交的 CI。
- **可以改的：**
  - `src/main/`、`src/shared/`、`scripts/`、`e2e/` 和对应测试；
  - `src/renderer/hooks/session/useNativeTranscriptFollow.ts` 的提供方条件；
  - 文档。
- **不改的：**
  - 前端界面、样式和文案；
  - 认证、订阅、原生写锁、进程终止方式；
  - 依赖（不升级，不新增运行时依赖）。
- **不打包、不发布、不安装：** 共享连接器包只改源码与测试，不重新生成发行附件。

## 特殊要求

沿用[后端改进计划的特殊要求](backend-reliability.md#特殊要求)七条。另外：

1. **格式来源：** 只能来自锁定版本的官方源码或包，每处写明出处。确认不了就记为受阻，不在产品代码里为未知格式加分支。
2. **版本准入：** 版本清单只能通过上面写明的准入流程扩展，不提供环境变量、参数或配置来跳过版本检查。
3. **缺陷处理：** 每个已确认缺陷先补能失败的回归，再修复；端到端用例先在已知缺陷上反证。不跳过测试、不放宽断言、不加自动重试。
4. **不入库的内容：** 大数据样例、截图、trace 和任何对话内容都不入库。
5. **前端问题：** 发现前端问题写成复现用例交给 Opus。
6. **写作风格：** 新写的文档、注释和提交说明不使用长破折号或短破折号。

## 完成记录

实施后按任务填写：问题、改动、实际测试结果、受阻与未验项，保持简短。交给 Opus 和需要用户在 Mac 上执行的事项单独列出。

### 任务一：共享模式版本适配

- **问题和修改：** 只认单版本且拒绝信息没有协议定位；`exec resume` 原先没有版本检查。本轮先补两条回归确认失败，再统一使用明确准入清单并补上接续入口检查。按实际 RPC、参数、响应、通知及工具字段建立可读协议明细；未知版本导出 experimental schema 并列出差异，导出失败保留失败原因，不自动准入。
- **官方证据：** 对基线与版本序更高的 19 个官方标签逐项核对；补查公开 schema 缺少的实验队列、后台终端定义，以及图片生成的原生文件引用变化。后者已有原样转发能力，补回归确认无损，没有新增产品格式分支。详细版本、提交和区别见[协议审计](../codex-shared-protocol.md)。基线是后发布的补丁标签，部分较早发布但版本序更高的标签也纳入审计，原因是桌面可能内置这些版本。
- **验收：** 官方比较 20/20；连接器 26/26；原生夹具 17/17；每版本 g/h 四条，共 80/80。类型检查、ESLint、全仓格式检查及发布策略检查通过。g/h 操作和断言未改，沿用[端到端完成记录](native-e2e.md#完成记录)中流式输出、忙碌/队列和摘要回合的缺陷反证；本轮新增版本检查的两条回归在修复前明确失败。虚拟显示退出导致的一次启动失败已定位并恢复环境，无自动重试。
- **准入与限制：** 日常清单仍只有既有锁定版本；19 个新版只标候选。候选入口只供测试创建的私有目录，每次检查精确版本、实际协议及原生签名，没有跳过版本检查的开关。真实账户、桌面 Codex、macOS 以及候选入口的真实签名/socket 验收未验。没有打包、安装或发布，既有附件未改变。[PR #9](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/9) 的七项 CI 通过后合并为 `de8a46fca64bd00da4e2ddc619d9f212ca1d4da9`；[主线 CI](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/40164856662) 七项全部通过。
- **Mac 与 Opus：** 桌面更新后的检查、候选真实验收和维护者准入 PR 流程见[共享说明](../codex-shared.md#桌面更新后的源码检查与验收)。本项没有界面修改或新发现的前端缺陷。

### 任务二：OpenCode

- **问题和修改：** 原生工具的 `callID` 未透传，`error` 正文与中断标记丢失，历史缺少 assistant 的模型；四条真实 SQLite 回归先失败，再修复。实时与历史共用状态转换，保留输入，按调用 ID 输出结果。新增本地 SQLite 版本探测和只读增量游标，覆盖 WAL、同毫秒更新、删除、数据库替换与分页，加入原有闲置跟随范围。
- **官方证据和判断：** 锁定 OpenCode 1.19.4 的提交与字段出处见[提供方契约](../native-provider-contracts.md#opencode-1194)。官方 stdout 只发工具终态；`step_finish` 是步骤边界，不能当整回合终止过滤后续事件，补合法多步骤回归。模型预设 `variant` 不等于思考等级，因此不填 `effort`。没有新增未知格式分支。
- **本地验收：** 相关单元测试 44/44；完整 Electron 套件 31/31，其中本家 a 至 f 6/6；合成凭据真实入口 6/6；夹具 19/19，连接器 26/26，发布策略 11/11。类型、ESLint、全仓格式、文档引用和发布策略检查通过。临时移除接续参数、错误/中断转换、历史模型和 hook 的提供方条件后，六个场景分别在下一轮回答、失败输出、停止状态、重启接续、模型和闲置追加断言上失败；临时修改未提交，恢复后完整套件通过。[PR #10](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/10) 七项检查全部通过后合并为 0f92503e317909c4bcbcb2f0ca2ca928a85173d4；[主线 CI](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/40169459141) 七项通过。
- **限制：** a 至 f 通过正常设置关闭后台摘要，摘要 h 不在本项范围；开启自动历史摘要仍沿用既有原生调用，不能宣称无转录副作用。旧版 JSON 与 SSH 格式没有用当前官方版本证明，保留既有读取但未启用增量跟随。真实账户、macOS 和真实 CLI 未验，云端合成真实入口只验证隔离及调用流程。
- **CI 修正：** 首轮 Linux 分片指出 hook 的旧测试仍把 OpenCode 归为不支持的提供方。保留对不支持提供方返回空值的断言，并新增 OpenCode 的支持、忙碌与排队保护断言；hook 测试 21/21，推送前检查再次通过。没有改前端行为、跳过或放宽断言。
- **Opus：** 本项只改允许的 hook 提供方条件。暂未发现需改界面的缺陷；若后续要使 OpenCode 自动摘要不改变原生记录，需要另立范围，现有后台摘要行为未被本轮修改。

### 任务二：Grok

- **来源与修改：** 锁定官方 grok-build 1.0.45，详细字段与提交见[提供方契约](../native-provider-contracts.md#grok-1045)。原代码已经配对结果正文，计划对此判断不准确，本次补齐调用 ID、原生状态、模型与 effort。实时和历史统一识别 Bash 非零退出及 ACP 文本错误；只有原生中断标记才取消未完成调用，回合 end 后不再转发迟到事件。
- **只读读取：** chat_history 与 updates 共同决定 revision；按字节增量读取，复用既有游标机制，不加哈希。增量和完整结果、分页、部分 UTF-8 尾行及替换文件一致；最多缓存两条会话，超过每文件 32 MiB 则完整读取。原生没有消息时间，保持缺省语义。
- **本地验收：** 修复前相关回归失败，修复后 parser/storage 72/72；合成凭据真实入口 6/6，46.8 秒，源凭据字节和临时目录清理通过。六个新增 Electron 用例均已临时回退已知缺陷，分别在接续、工具失败、模型或 revision 断言上失败；临时修改没有提交。合入 OpenCode 后，完整 Electron 37/37，4.4 分钟；Grok 与 OpenCode 的隔离真实入口 12/12，1.7 分钟；夹具 22/22，连接器与发布策略脚本 46/46。类型、ESLint、全仓格式、文档引用和发布策略检查通过。
- **前端受阻：** e 的 Message info 因空时间戳变成 NaN 而崩溃；临时开启 Grok 自动跟随后，d 的新回复显示两次，严格唯一断言失败。没有伪造时间，也没有修改界面；完整界面复现和原始失败断言保留在[Opus 交接](../native-provider-contracts.md#grok-的-opus-交接与验收边界)。当前不启用 Grok 的 hook 条件，避免引入已知重复。a 至 d 通过；e 完成历史结果和模型 IPC，f 仅完成 revision 与只读 IPC，两个界面部分明确受阻，不计作通过。
- **限制：** SSH 沿用完整读取；无 updates 的旧结果状态为 unknown，现有界面误显示运行中也交给 Opus。a 至 f 通过普通设置关闭自动历史摘要，未扩大摘要承诺。真实账户、macOS、真实 CLI 均未验。[PR #11](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/11) 合并为 `9d48072c48370b26c17367d06021a984c8af2751`，[主线 CI](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/40171573321) 七项通过。

### 任务二：Grok 终态错误路径补充

- **问题和修改：** 后续交叉审查发现 StdoutHandler 在 parseJsonObject 之前检测错误，原先只过滤解析路径仍会转发 end 后的迟到错误。新增回归先失败，再对 JSON 与纯文本错误检测沿用同一个终态边界；非零进程退出的判定保持原行为。
- **验收：** 相关 parser/storage 73/73；Grok 六个 Electron 场景 6/6，52.2 秒；夹具 22/22；连接器、协议与发布策略 46/46。类型、ESLint、全仓格式、文档引用和发布策略检查通过。此前六场景的缺陷反证仍有效；本次新增错误路径另有失败回归。前端受阻及真实环境未验边界不变。[PR #12](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/12) 合并为 `b33b51eeb1f1eb4bf6565202961d32f78a0991d5`，[主线 CI](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/40173995263) 七项通过。

### 任务二：Oh My Pi

- **来源与修改：** 锁定 18.12.6 的官方源码，见[提供方契约](../native-provider-contracts.md#oh-my-pi-18126)。修复原生 toolCall/toolResult 未识别、历史缺少模型/effort、中断与失败混淆、非最终 agent_end 提前结束、终止后仍转发，以及读取混入旁支。新增只读 revision/增量游标，限定所选目录和项目，加入 hook 跟随范围。
- **回归与本地验收：** 先有 5 条失败回归及 1 条对照通过，之后补目录切换的失败回归再修复。新增终态错误检测回归也先失败：非最终 agent_end 不应报错，最终回合后迟到错误不应转发。修复后相关单元测试和 hook 测试 55/55。六个 Electron 场景均经临时回退反证：a/c/d 移除接续参数，b 回退历史工具格式，e 移除原生模型，f 移除 hook 条件，全部明确失败。最初只移除 parser 调用 ID 的 b 反证不成立，界面仍从原始事件取 ID；新增历史与实时逐项一致断言，再回退已确认的历史格式缺陷后 b 失败。恢复后六场景通过；隔离真实入口 6/6，57.6 秒；集成已合并的 OpenCode/Grok 后，完整 Electron 43/43，5.9 分钟；三家隔离真实入口 18/18，2.6 分钟；夹具 25/25。终态错误路径修复后的 Oh My Pi 六场景复测及类型、ESLint、全仓格式、文档引用与发布策略检查通过。
- **判断与限制：** 官方分支图决定 f 的并发写入是旁支，不能强行混入当前对话；保留忙碌不读断言，Stop 后另向当前分支追加并验证恢复刷新。没有放宽目标或修改原生写锁。只有明确中断标记才取消，无机器标记的 isError 仍是 failed。非默认 profile、SSH、真实账户、真实 CLI 和 macOS 未验。自动摘要不在本家 a 至 f 的承诺内。
- **Opus：** 暂无新增前端缺陷；仅扩展允许的 hook 提供方条件。[PR #13](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/13) 合并为 `9e6c3c5c6fa384bd4a4c7cc016af345d23666ad8`，[主线 CI](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/40174252156) 七项通过。

### 任务二：Copilot CLI

- **来源与修改：** 锁定官方 @github/copilot 1.0.63 包，见[提供方契约](../native-provider-contracts.md#copilot-cli-1063)。补齐工具按原生 ID 配对、失败正文、明确 abort 的取消状态、原生模型、终止后的事件过滤，以及只读 revision/增量读取。实际 per-call effort 不落盘，保持缺省；不借用 selectedModel 或配置值。
- **实际缺陷：** 四条格式/增量回归先失败再修；随后同 ID 的不同账户回归证明读取忽略 configDir，修复后只读所选目录。端到端暴露退出后持续忙碌，另两条回归先证明退出核对错误读取 COPILOT_CONFIG_DIR 且忽略进程目录，再修正为 COPILOT_HOME 和已有进程环境。认证和进程终止方式未改。
- **本地验收：** 集成 OpenCode、Grok 和 Oh My Pi 后，相关七套单元测试 174/174，夹具 28/28；完整 Electron 49/49，6.2 分钟，其中本家六场景通过。首轮夹具漏写原生持久化 shutdown，按锁定官方源码补齐；之后暴露的产品目录错误已经修复。临时回退接续参数、历史工具/模型字段及 hook 条件，六个场景全部在各自验收断言失败；恢复后 6/6，52.6 秒。独立隔离真实入口 6/6，1.0 分钟；终态错误修复后六场景再验 6/6，48.0 秒。类型、ESLint、全仓格式、文档引用和发布策略检查通过；四家集成真实入口 24/24，3.5 分钟。
- **限制与 Opus：** 真实账户、真实 CLI、macOS 与更新版本未验；SSH 保留既有读取。自动摘要未纳入 a 至 f。暂无新增前端缺陷，只改允许的 hook 条件；真实模式不绕过原生并发写锁。PR 与实际主线合并提交的七项 CI 结果见 [PR #15](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/15)。

- **交叉审查补充：** 官方 session.error.data.message 原先漏报，独立错误检测又绕过终态过滤。分别运行回归确认有效错误漏报和迟到错误泄漏，再修复；工具失败仍只更新工具状态，非零进程退出的判定不变。

- **原生中断补充：** 复查发现来自原生客户端的 abort 在历史中取消工具，实时解析却没有处理；Maestro 的 Stop 界面原先掩盖了这条路径。新增并行工具回归先失败，再复用已有 toolResultBlocks 取消全部未完成调用，保留已完成调用和下一回合。最终 Copilot 六场景 6/6，52.9 秒；推送前检查重新通过。

- **此前 CI 受阻：** [PR #15](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/15) 的六项既有检查通过；[Native E2E](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/40173915973) 在 49/49 常规场景及 45/49 真实入口烟测通过后，被整个 job 的 15 分钟时限取消。当时因 `.github/workflows/ci.yml` 不在原计划允许路径中，提出只将 job 时限改为 25 分钟的范围扩展，等待确认期间未修改、重试或合并。
- **主线集成准备：** 已同步主线 `a4fdcc0491973fd4d5bdd416d5fc24871467a4fe`，完成记录的唯一冲突保留主线完整内容，产品代码自动合并。集成后相关测试 475/475，夹具 29/29，完整 Electron 49/49（6.2 分钟），Copilot/OpenCode 隔离真实入口 12/12（1.8 分钟），静态、文档及发布检查通过。集成稿保存在 `codex/stage3-copilot-integration`，供云端接续与审阅；未修改 CI 时限，也未更新 PR #15 的代码分支或合并该 PR。范围获准后，在此稿上仅把该 job 的 15 分钟改为 25 分钟，再更新原 PR 并等待七项检查及主线 CI。

- **历史修复集成补充：** 准备分支继续合入主线 `be88f6a8667200bc19ee96119022297b6604eaff`（PR #17、#18 的账户分页、SSH 路径及搜索语义修复），无冲突。集成后 31 个相关单元测试文件 657/657、夹具 29/29、完整 Electron 51/51（6.3 分钟）、完整隔离真实入口烟测 51/51（7.0 分钟）；烟测同时确认合成源凭据未改写、临时会话清理完成。类型、ESLint、全仓格式、文档引用、连接器 26/26 和发布策略 11/11 通过。只更新上述准备分支及本记录；PR #15 的代码分支仍为 `8d5aab0c33a458c2fcb2037b268ca83abdc9718b`，CI 时限范围确认与真实环境未验边界不变，没有重试 CI。

- **2026-10-30 收尾：** 用户批准只将 Native resume E2E (Linux) 的 `timeout-minutes` 从 15 改为 25。已在准备分支合入主线 `6d0b27f471a5c730372362bdd9e017aee5051862`，保留 Opus 的全部 Grok 修复；两处合并冲突只涉及提供方列表及同一列表的测试，均保留 Grok 和 Copilot。工作流只有上述一行差异，其他 job、步骤、用例重试及断言未变。集成后 32 个相关文件 685/685，夹具 29/29，完整 Electron 51/51（7.4 分钟），完整隔离真实入口烟测 51/51（7.9 分钟），合成源凭据未改写且临时会话清理通过。类型、ESLint、全仓格式、文档引用、连接器 26/26、发布策略 11/11 与源策略检查通过。原 [PR #15](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/15) 的[七项 CI](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/41075929794) 首次运行全部通过（20 分 15 秒），合并为 `552421e6f230bf1853a54a13dd9e52b1dccce313`。[实际主线 CI](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/41079190054) 首次运行七项通过（20 分 28 秒），夹具 29/29、完整 Electron 51/51（6.7 分钟）、隔离真实入口烟测 51/51（7.6 分钟）；Native job 用时 15 分 53 秒。没有空提交或手动重跑 CI；真实环境仍未验。

### 任务二：Factory Droid

- **受阻原因：** 当前官方 @factory/cli 0.249.0 使用原生字节码，官方 SDK 的 stream-jsonrpc 格式不能证明产品当前使用的 `droid exec -o stream-json`。可读的官方旧包 0.1.0 与 0.1.2-dev.7 也不具备当前 `--resume`、输出及会话格式。详细版本、提交、源码及证据缺口见[格式核查](../native-factory-format.md)。未猜字段、未新增假程序或产品格式分支，保留既有行为。
- **结果：** [PR #14](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/14) 只提交核查文档，七项 CI 通过后合并为 `757d67e53d36931bd8ceb6d82a39c83e81a568f5`；[主线 CI](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/40174411056) 七项通过。提供方的接续对齐、增量与端到端均为受阻，真实账户与 Mac 未验。未安装或执行官方包，也没有前端行为改动。

### 任务三：长会话与大量历史

- **问题与反证：** 固定预算的首次基线中，Codex 5 万条工具密集消息首次读取为 7673.0 至 8750.3 ms，超过 2000 ms；5000 会话搜索为 50951.2 至 53032.3 ms，超过 10000 ms，三次断言均失败。另补真实文件系统回归，40 个会话搜索枚举目录 164 次，明确超过最多 8 次的预算。
- **修改：** 工具结果在一次解析内按调用 ID 查找已有卡片，避免每个结果遍历全部消息；搜索为本次操作复用已枚举的原生路径。复用原有结果归一化、分页、元数据缓存与增量读取，没有新增持久缓存体系或哈希，旧文件名及并发搜索继续正确。Claude 已有大工具输出压缩，本次测量未发现超预算热点，没有重复修改它。
- **测量结果：** 同样本、同预算复测，两家所有性能断言通过，20.75 秒。Codex 5 万条首次读取降为 251.7 至 286.0 ms，5000 会话搜索为 715.5 至 836.3 ms。存储相关单元测试 377/377。完整基线、数据量、缓存条件、其他路径及复现命令见[性能验收](../native-backend-performance.md)。常规 Electron 43/43，5.4 分钟；隔离真实入口烟测 43/43，6.0 分钟；夹具 26/26，连接器 26/26，发布策略 11/11。类型、ESLint、全仓格式、文档引用与发布策略检查全部通过。[PR #16](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/16) 七项 CI 全部通过后合并为 `a4fdcc0491973fd4d5bdd416d5fc24871467a4fe`；[主线 CI](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/40179311864) 七项全部通过。PR CI 用时 21 分 06 秒，主线 CI 用时 20 分 01 秒。
- **端到端时序修正：** 首次完整套件 42/43，OpenCode Stop 场景在 SQLite 文件已创建但表尚未建立时查询，明确报 `no such table: session`。夹具增加独立的原生表就绪条件，oneTranscript 等表齐全后才返回；缺文件、坏库和 readOpenCodeState 的缺表错误仍抛出，不吞错或重试用例。新增空库到完整原生 schema 的回归，修正后完整套件及隔离真实入口各 43/43。产品 OpenCode 代码、场景断言与超时未改变。
- **限制与交接：** IPC 字节数是 JSON/V8 返回值估计，不含 Electron 帧开销或渲染器时间；真实账户、macOS、桌面 Codex 均未验。超过 100 MiB 的已知 ID 仍可读取，但既有元数据扫描上限会把它从项目历史及搜索发现中排除，此限制没有悄悄放宽。已加载 5 万条的前端刷新仍请求全部历史并返回约 20 至 22 MB，交给 Opus 评估请求范围及稳定消息合并，不在后端截断调用者要求的数据。性能 CI 的接入仅写建议，由用户决定。

### 需要用户在 Mac 上执行

先在仓库根目录检查桌面更新后的版本：

```sh
python3 scripts/codex-shared/check-version.py
```

只有该精确版本已经列入候选时，运行共享真实验收：

```sh
MAESTRO_E2E_REAL=1 \
MAESTRO_E2E_CODEX_PATH=/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex \
MAESTRO_E2E_SHARED_PATH="$PWD/e2e/fixtures/native/candidate-shared.py" \
npm run test:e2e -- e2e/native-shared.spec.ts
```

提供版本号及无对话内容的 `e2e-results/native-summary.json` 摘要，确认共享 g/h 通过；维护者还需核对协议审计，再提交该精确版本准入的小 PR。候选清单以外的新版本先补官方格式审计与合成测试，不存在跳过检查的入口。真实服务双客户端通过也不能代替桌面 GUI 验收。完整流程见[共享说明](../codex-shared.md#桌面更新后的源码检查与验收)。

已有匹配的 CLI 时分别运行，不安装或升级：

```sh
MAESTRO_E2E_REAL=1 MAESTRO_E2E_OPENCODE_PATH="$(command -v opencode)" npm run test:e2e -- e2e/native-opencode.spec.ts
MAESTRO_E2E_REAL=1 MAESTRO_E2E_GROK_PATH="$(command -v grok)" npm run test:e2e -- e2e/native-grok.spec.ts
MAESTRO_E2E_REAL=1 MAESTRO_E2E_OMP_PATH="$(command -v omp)" npm run test:e2e -- e2e/native-omp.spec.ts
MAESTRO_E2E_REAL=1 MAESTRO_E2E_COPILOT_PATH="$(command -v copilot)" npm run test:e2e -- e2e/native-copilot.spec.ts
```

锁定版本依次为 1.19.4、1.0.45、18.12.6、1.0.63；Copilot 已随 PR #15 合并。OMP 需要调用者提供 ANTHROPIC_API_KEY，Copilot 需要显式 COPILOT_GITHUB_TOKEN；OpenCode/Grok 使用隔离凭据副本或已支持的 API key，真实会话不复制。Factory 因格式受阻没有可宣称有效的验收命令。Grok 命令只覆盖已完成部分，不能证明详情与自动跟随的界面受阻项。所有真实模式仍标记未验。

### 交给 Opus

1. 修复 Grok 缺失原生时间导致的 Message info 崩溃、重启续接后回复重复，以及旧工具结果 unknown 被显示为运行中；复现步骤及原始失败断言见[提供方契约](../native-provider-contracts.md#grok-的-opus-交接与验收边界)。修复后才启用 Grok hook 条件并恢复 e/f 的完整界面验收。不能伪造时间或仅按正文消重。
2. 评估已加载大量历史时 `refreshNativeConversation` 按 `max(500, tab.logs.length)` 请求数据的开销。性能用例中的 `50k/loaded-tab` 可重复得到约 20 至 22 MB 返回，而普通最近 500 条约 0.20 至 0.22 MB。后端保留同一消息 ID、工具状态、模型和增量语义；前端改请求方式时仍需保证阅读锚点、草稿、未读数与旧消息内容，不用后端静默截断掩盖问题。尚未测量真实渲染耗时，不能宣称已复现卡顿。
