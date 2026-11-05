# 新界面：多家工具的 Claude Code

状态：2026-11-05 定稿。用户 2026-11-04 定下目标（基本复刻多 harness 版的 Claude Code），2026-11-05 确认了下面的五个界面决定和目标用户，全部按推荐执行。实现以本文为准。

上一轮[界面改版](claude-code-ui.md)是在旧框架里换观感；这一轮换框架本身。进程管理、输出解析、原生历史读写、SSH、打包这些引擎部分照旧沿用，数据不迁移。

## 定位

把用户已经付费的 Claude、Codex、DeepSeek 当一个团队用：同一个任务在它们之间接力，上下文不丢；额度用完一键换人；合并前换一家复核。

交互照搬 Claude Code，用户不用重新学；差异全部放在“跨家”上。Anthropic 不会让 Claude Code 帮用户用 OpenAI 的额度，OpenAI 也不会把 Claude 的会话当一等公民，这是本项目的位置。

目标用户（已确认）：同时付费好几家订阅、在 Claude Code 和 Codex 之间来回切的开发者。DeepSeek 用来干便宜的活。

| 卖点             | 用户得到什么                                                                                                 | 已有基础                                                                                 | 排期                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| 额度用完不断工   | 一家的额度用完或出错，同一个任务一键交给另一家，上下文一起带过去                                             | `maestro-cli handoff`（目标 claude-code、codex、deepseek）、额度用尽提示、Codex 重置额度 | hb.7 一键交接；hb.8 可选自动交接，默认关 |
| 合并前换一家复核 | 改动面板里一键让另一家审这些改动，复核本身也是一条能点开的会话                                               | git 状态、差异和行数接口（含 SSH）、`maestro-cli ask`                                    | hb.7                                     |
| 子任务是真对话   | 能跑 shell 的工具都能用 maestro-cli 派活；子任务由 Maestro 启动，挂在发起它的会话下面，能点开、插话、接着聊  | @提及、`ask`、`dispatch`、`handoff`                                                      | hb.8                                     |
| 上下文跟着你走   | 终端或官方应用里开的对话都能在这里打开、接着聊、交给另一家；配置写一次，同步成各家自己的格式，写入前逐个确认 | 原生历史读写、About Me 写入原生指令文件、coworking 往各家写 MCP 配置                     | 历史已有；配置同步在 hb.9 之后           |
| 分层省钱         | 贵的模型做规划，便宜的模型干活；DeepSeek 在新会话里直接可选                                                  | DeepSeek 预设（跑的是 Claude Code，接口地址指向 DeepSeek）                               | hb.7；Kimi、GLM 预设在 hb.9 之后         |

用户最初提的两点：“任意工具当主控”改写为“子任务是真对话”，因为互相调用本身不稀缺，Claude Code 自己就能调 `codex exec`，稀缺的是子任务看得见、插得上话、结果不用手动搬；“记忆外置”单独不成立，AGENTS.md 已是各家通用的格式，真正把人绑住的是历史和配置，所以并入“上下文跟着你走”。

不当卖点：支持的工具数量（越多维护越重）；追 Claude Code 的功能清单（追不完）；同时开很多个 agent（瓶颈在人审改动，所以复核和子任务都连着审查做）。

## 五个界面决定

1. **右侧面板放改动、文件、终端、任务、预览。** 旧右栏的文件、历史记录、自动运行在新界面里不出现；历史会话本来就在左栏。
2. **界面上没有智能体这一层。** 左栏只有“项目 → 会话”，新会话时选 Claude、Codex 或 DeepSeek。账户、模型、环境变量、SSH 改到项目设置里按工具配置。引擎里的智能体数据不动，现有配置一个都不丢。
3. **中间没有标签栏。** 一次看一条会话，靠左栏切换。文件、终端、网页进右侧面板。同时看两条会话在 hb.8 用分屏解决。
4. **上游功能先藏后删。** Cue、群聊、自动运行、用量面板、导演笔记、插件、playbook、市场、文档图谱在新界面里都不出现，旧界面照常可用。用新界面一个版本、确认确实不需要以后，再删代码。
5. **新旧界面并存，一个开关切换。** 设置里加“新界面”开关，命令行有同名设置。hb.9 把新界面设为默认，旧界面再保留一个版本后删除。手机网页版第一阶段继续用旧界面。

## 布局

左栏约 260 像素；右侧面板在 360 到 560 像素之间可拖宽、可收起；中间占剩下的宽度。

**左栏：项目和会话。** 按项目分组，组内按最近活动排序；运行中、未读、出错用点的颜色和形状区分。每行是工具标记、标题、时间，worktree 会话带分支标记，复核和子任务挂在来源会话下面。现有的会话优先侧栏（`ProjectSessionTree`）就是基础，主要工作是去掉智能体那一层。

**中间：当前会话。** 顶栏是标题、分支或 worktree、工具和模型、“交给…”、面板开关；现在的状态徽章和计数大多移走。对话流沿用：工具调用折叠成“已处理 Xm Ys”，运行状态在对话里，发送键运行时变停止键，Esc 停止。输入框留附件、模型、推理强度、权限模式、发送和停止，其余控件收进“更多”。

**右侧面板：这条会话的产出。** 每条会话记住上次打开的面板。

| 面板 | 内容                                                                                     | 来源                                             |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 改动 | 这条会话工作目录（含 worktree 和 SSH）的改动文件、增删行数、逐文件差异；回合结束自动刷新 | 新建：后端见附录 B，界面 Opus                    |
| 文件 | 点对话里提到的文件或手动打开，跳到指定行，可编辑                                         | 沿用文件预览                                     |
| 终端 | 在这条会话的工作目录开终端，跟着会话走                                                   | 改造现有终端                                     |
| 任务 | Claude 的 TodoWrite、Codex 的 update_plan，显示最新清单，历史会话也能看到                | 改造：沿用 `src/renderer/utils/agentTaskList.ts` |
| 预览 | 本地开发服务器等网页                                                                     | 沿用浏览器标签                                   |

## 三家工具能做什么

界面只显示当前工具真正支持的控件，不支持的直接不出现。标“待核实”的项按附录 D 核对。

| 能力                           | Claude Code | Codex                  | DeepSeek                          | 界面上的样子                     |
| ------------------------------ | ----------- | ---------------------- | --------------------------------- | -------------------------------- |
| 接续原生会话、跟随外部写入     | 支持        | 支持（含压缩历史）     | 支持（存在 Claude Code 的历史里） | 左栏同一个列表                   |
| 任务清单                       | TodoWrite   | update_plan            | TodoWrite                         | 任务面板                         |
| 计划模式                       | 支持        | 待核实                 | 待核实                            | 权限模式菜单里的一项             |
| 推理强度                       | 支持        | 支持                   | 待核实                            | 输入框的强度菜单                 |
| 权限或沙箱模式                 | 权限模式    | 沙箱模式               | 权限模式                          | 同一个菜单，按工具显示各自的选项 |
| 图片输入                       | 支持        | 支持                   | 待核实                            | 附件按钮                         |
| 停止当前回合                   | 支持        | 支持                   | 支持                              | 停止键、Esc                      |
| 作为交接目标                   | 支持        | 支持                   | 支持                              | 顶栏“交给…”菜单                  |
| 当主控派活（调用 maestro-cli） | 支持        | 待核实（沙箱默认断网） | 支持                              | 子任务卡片和左栏的子会话         |

DeepSeek 实际跑的是 Claude Code，只是接口地址指向 DeepSeek，所以大部分能力和 Claude Code 相同；取决于模型本身的几项标了待核实。OpenCode、Grok 等其他工具在引擎里照常可用，新界面按通用能力显示，不做专门适配。

## 阶段

每个阶段发一个版本。hb.6 仍按旧界面发布，不加新功能，作为改造期间每天用的稳定版本。

### hb.7：新框架能用

- “新界面”开关和命令行同名设置。
- 三栏骨架；左栏去掉智能体层；中间去掉标签栏、重做顶栏。
- 右侧面板容器，先做“改动”和“文件”。
- 上游功能入口在新界面里隐藏。
- 新会话可选 Claude、Codex、DeepSeek。
- 顶栏“交给…”：连同上下文交给另一家；额度用尽的提示里是同一个入口。
- 改动面板“让另一家复核”，复核是一条新会话。

演示：Claude 做到一半，交给 Codex 接着做，DeepSeek 复核改动，用户合并。全程在新界面里，三段对话都能在左栏点开。

验收：用户用新界面完成一整天的 Claude 和 Codex 工作，不用打开旧界面，也不用打开 Claude Code 或 Codex。

### hb.8：面板补齐

- 终端、任务、预览三个面板。
- 改动按回合分组，能看出哪一轮改了什么。
- 两条会话分屏。
- 项目设置完整替代智能体配置。
- 子任务挂在父会话下面：@提及和 maestro-cli 派出的活能点开、插话、接着聊；来源标签关掉以后也能按原生 id 挂回去。
- 额度用尽自动交接，在项目设置里开，默认关；开启时说清楚会用哪个账户。
- 实测 Codex 能不能当主控。

验收：检查清单逐项通过；旧界面的右栏一次都不需要打开；一个任务里 Claude 派活给 Codex，子任务在左栏能点开并插话。

### hb.9：新界面成为默认

- 新安装和升级都默认新界面，旧界面保留一个版本。
- 按决定 4 删除确认不用的上游功能。
- 手机网页版换成新界面的窄屏形态。

验收：删除后全部测试通过，安装包体积和启动时间不变差。

hb.9 之后：配置同步（MCP 服务器、指令文件，写入前逐个确认）；Kimi、GLM 等预设。

## 分工

Opus 负责规格、全部界面和交互、审查 Codex 的改动、在真实数据上验收。Codex 负责附录里的后端接口、命令行对等、测试、CI、打包发布的机械步骤和删除代码。需要后端的面板，接口先写在附录里，Codex 按接口实现并写测试，Opus 同时对着假数据做界面。

每个界面操作都有对应的命令行，这条规矩不变；新增的操作在 [CLI-UI-PARITY.md](../agent-guides/CLI-UI-PARITY.md) 里登记。

## 风险

- **和上游分叉。** 新界面以后基本不再合并上游，只挑引擎修复。
- **多标签习惯。** 去掉标签栏后，同时开着好几条会话只能靠左栏切换，hb.8 才有分屏。
- **智能体配置迁移。** 项目设置要能读出现有每个智能体的账户、环境变量和 SSH，一个都不能丢；Codex 写迁移测试。
- **卖点会被追上。** Claude Code 的子 agent 已经能调别的工具。本项目守的是跨家接力和原生历史互通，不是“能调”。
- **自动交接花另一家的额度。** 默认关；开启时说清楚会用哪个账户。
- **Codex 当主控可能受沙箱限制。** 沙箱默认断网，连不上本机的 Maestro 就只能 Claude 和 DeepSeek 当主控；hb.8 实测。

## 附录：hb.7 接口

### A. 新界面开关

- 设置键 `newShell`，布尔，默认 `false`。按设置的登记步骤同时改 `src/shared/settingsMetadata.ts`、`src/renderer/stores/settingsStore.ts`、`src/main/stores/defaults.ts` 和 `src/renderer/components/Settings/searchableSettings.ts`。
- 命令行走现有的通用设置命令：`maestro-cli settings set newShell true`、`maestro-cli settings get newShell`，不加新动词。
- 切换不重启应用：渲染层直接换外壳，引擎状态、运行中的回合和草稿都不受影响。

### B. 改动面板

现有 `git:numstat` 只跑 `git diff --numstat`，不含暂存区和未跟踪文件；状态、行数、差异还要三次往返，SSH 下每次一个连接。新增两个只读调用，类型放在新文件 `src/shared/gitChanges.ts`，两端共用：

```ts
export type GitChangeStatus =
	| 'modified'
	| 'added'
	| 'deleted'
	| 'renamed'
	| 'copied'
	| 'typechange'
	| 'untracked'
	| 'conflicted';

export interface GitChangedFile {
	/** 相对仓库根目录，用 / 分隔；Windows 和 SSH 一样。 */
	path: string;
	/** 改名或复制的来源。 */
	oldPath?: string;
	status: GitChangeStatus;
	/** 有任何部分已暂存。 */
	staged: boolean;
	/** 相对 HEAD 的增删行数，暂存和未暂存合计；二进制为 null。 */
	additions: number | null;
	deletions: number | null;
}

export interface GitChanges {
	/** 仓库根目录，和传入的 cwd 同一种形式（本机路径或远程路径）。 */
	root: string;
	branch: string | null;
	/** 按 path 排序。 */
	files: GitChangedFile[];
	/** 全部改动的合计，不受 files 截断影响。 */
	totals: { files: number; additions: number; deletions: number };
	/** 文件数超过 500 时为 true，files 只含前 500 个。 */
	truncated: boolean;
	notARepo?: boolean;
	/** git 超时；调用方保留上一次的结果。 */
	timedOut?: boolean;
}

export interface GitFileChangeDiff {
	/** 相对 HEAD 的统一差异；未跟踪文件按新增文件生成。 */
	diff: string;
	binary: boolean;
	/** 差异超过 1 MiB 时不返回正文，界面提示用编辑器打开。 */
	tooLarge: boolean;
	timedOut?: boolean;
}
```

- IPC：`git:changes(cwd, sshRemoteId?, remoteCwd?)` 返回 `GitChanges`，`git:changeDiff(cwd, path, sshRemoteId?, remoteCwd?)` 返回 `GitFileChangeDiff`。处理函数放在 `src/main/ipc/handlers/git/read.ts`，走 `execGitReadOnly()` 和现有的 SSH 路径；预加载在 `src/main/preload/git.ts`；渲染层在 `src/renderer/services/git.ts` 加 `getChanges()` 和 `getChangeDiff()`。
- 状态和行数一次往返：同一条命令里跑 `git status --porcelain=v2 -z` 和 `git diff HEAD --numstat -z`，未跟踪文件的行数也在这条命令里数，超过 1 MiB 或二进制的记 null。
- 还没有提交的新仓库（没有 HEAD）按空树比较，不报错。
- 命令行：`maestro-cli changes [--agent <id>] [--tab <id>] [--file <path>] [--json]`，输出同样的结构。只读，不改工作区。
- 什么时候刷新由界面决定：回合结束、切到这条会话、手动刷新。后端不加文件监听。

### C. 交接和复核

交接已有：`requestAiHandoff()`（`src/renderer/services/aiHandoffEntry.ts`）和 `maestro-cli handoff <tab> <provider> [--send]`。hb.7 补三件事：

1. **同一个工作目录。** 目标会话和来源会话用同一个工作目录，包括 worktree 和 SSH 主机。目标工具在这个项目里还没有配置时，按该工具的全局设置新建，DeepSeek 用它的预设。做不到就明确报错，不能悄悄换到本机或项目根目录。
2. **复核模式。** `ai_handoff` 的 `prepare` 加 `mode: 'handoff' | 'review'`，默认 `handoff`。复核草稿包含：来源会话目标的简短摘要（沿用交接的长度预算）、`git:changes` 的文件清单、请对方自己运行 `git diff HEAD` 阅读改动、只报告问题不改文件。目标工具支持只读模式（`supportsReadOnlyMode`）时用只读模式启动。
3. **记录来源。** 交接和复核产生的新会话在标签上记录来源，随会话持久化：

```ts
// 加在 src/renderer/types/index.ts 的 AITab 上
export interface ConversationOrigin {
	kind: 'handoff' | 'review';
	sourceSessionId: string;
	sourceTabId: string;
	sourceProvider: string;
	/** 来源会话的原生 id；来源标签关掉以后靠它找到父会话（hb.8 用）。 */
	sourceNativeSessionId?: string;
	createdAt: number;
}
```

- 命令行：`maestro-cli handoff <tab> <provider> --review [--send] [--json]`。JSON 结果包含新会话的智能体 id、标签 id 和 `mode`，来源能用现有的标签读取命令读回。
- hb.7 的左栏只把还开着的复核、交接会话挂在来源下面；关掉以后按原生 id 挂回去，和子任务一起放到 hb.8。

### D. 能力核对

新界面只用 `src/main/agents/capabilities.ts` 里的字段决定控件出不出现，不在界面里另写一份。待核实的项由 Codex 用已安装的命令行核对：只看帮助和参数、不发模型请求就能确定的，直接核对，并在字段旁注明核对的命令行版本；必须真实调用模型才能确定的（DeepSeek 的图片输入和推理强度），先问用户，因为会产生费用。

### E. 新会话（界面侧，列出来说明依赖）

`SidebarProject.agents`（`src/renderer/utils/projectSessionTree.ts`）已经给出每个工具在这个项目里新会话用的配置。新界面的“新会话”菜单直接用它；某个工具在这个项目还没有配置时，用现有的新建智能体路径静默建一个，配置取自该工具的全局设置，新界面里不显示它。命令行沿用 `create-agent` 和 `tab new`。hb.8 的项目设置让这份配置可以按项目修改。
