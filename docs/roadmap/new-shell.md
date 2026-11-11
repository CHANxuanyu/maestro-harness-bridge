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
4. **上游功能先藏后删。** Cue、群聊、自动运行、用量面板、导演笔记、插件、playbook、市场、文档图谱、Symphony 在新界面里都不出现，旧界面照常可用。用新界面一个版本、确认确实不需要以后，再删代码。
5. **新旧界面并存，一个开关切换。** 设置里加“新界面”开关，命令行有同名设置。hb.9 把新界面设为默认，旧界面再保留一个版本后删除。手机网页版第一阶段继续用旧界面。

2026-11-11 现状补充：上一句保留原计划。当前网页入口由 `src/main/web-server/routes/staticRoutes.ts` 提供 web-desktop，`src/web-desktop/bootstrap.ts` 共享 renderer，`App.tsx` 和 `index.css` 已有窄屏抽屉与触摸基础，并非手机强制旧界面。新界面手机专项验收未完成，右栏网页在浏览器环境显示不可内嵌提示。

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

## 打开项目与第一次打开（2026-11-06 第二批）

只在 `newShell` 打开时生效。旧界面、已保存的功能设置和快捷键保持原值。

- 所有入口调用同一份 `openProject(path)`：左栏项目列表末尾“打开项目…”，`⌘O` / `Ctrl+O`，命令面板和菜单。文件夹选择复用现有 dialog。旧界面的 `⌘O` 仍切换智能体；两种界面的绑定互斥，不改写用户保存的按键。
- 先用物理目录和 `normalizeWorktreePath()` 比较本机智能体的工作目录，识别符号链接别名。已有智能体直接选中；否则按 `AGENT_AUTOSELECT_ORDER` 选择第一个本机可用工具，用 `defaultAgentNameForPath()` 命名，经现有创建流程静默创建。普通非 Git 文件夹同样可打开。没有可用工具时不创建，提示安装。
- 打开后选中项目，展开左栏及该项目，输入框获得焦点。打开动作不发送内容，也不调用模型。
- 没有项目时不显示旧欢迎页和旧顶栏。中间留白、居中，只显示“选一个项目开始”、说明“你在 Claude Code 和 Codex 里的对话都会在这里，不用迁移。”、主按钮“打开项目文件夹”、可选的“最近的项目”和工具就绪状态。左栏只显示“打开项目…”。不加入图标大图、紫色装饰和 Auto Run 介绍。
- 最近项目最多 8 行，每行显示文件夹名、经 `truncatePath()` 缩短的路径、工具标记、最后活动时间，点击仍走 `openProject(path)`。没有历史时不显示列表。底部使用“Claude Code 已就绪 · Codex 已就绪”这样的普通小字，缺少工具写“未安装”。
- 最近项目由只读接口 `agentSessions:projects` 提供，只返回 `path`、`tools`、`lastActivity`、`sessionCount`。Claude 从转录里的 `cwd` 读路径；Codex 经共享 `readCodexRollout()` 读取 sessions 和压缩归档。账户目录复用现有解析，不从有损目录名猜路径，不写原生文件，不扫描 SSH 账户路径，目录不存在则排除。
- 扫描采用 30 秒内存缓存，最多 1024 个转录、8192 个目录项、每家 64 个账户，扫描与解析在步骤间检查 1500 毫秒预算。每份转录最多读取 256 KiB 原始字节、解析 64 KiB 文件头。结果按文件修改时间倒序。触及上限时只代表本次有界扫描范围，会话数不宣称是全量统计；慢文件系统中的单次 I/O 不能被这个预算硬中断。
- CLI `maestro-cli native-history projects` 和 `maestro-cli open-project <path>` 复用桌面接口，需要运行中的桌面应用；后者要求开启新界面。

## 顶部与细节（2026-11-06 第二批）

- 新界面去掉 `AppShell` 的整条标题栏和 `pt-10`。左栏在 macOS 留 48 像素固定拖动空白，不受窗口宽度影响；其他平台留 12 像素；原生标题栏模式为 0。
- 中间顶栏和右侧面板页签从顶端开始，高度 48 像素，可拖动窗口，按钮和页签不可拖动。macOS 左栏收起时，中间顶栏留 84 像素避开红绿灯，并提供展开左栏按钮；原生标题栏模式不留这块空白。
- 输入框、搜索框占位文字使用正体，按主题校正到 AA 对比度。Claude 的 `sonnet`、`opus`、`haiku` 显示首字母大写；Codex 模型名保持原样。推理强度使用本地化文字，传给工具的原始值不变。
- 主面板和右面板不再因获得焦点绘制整圈强调描边，具体控件保留可见键盘焦点。会话运行中使用现有转动圈，未读为实心点，错误为感叹圈，颜色来自主题。
- 对话代码块语言标记改成无边框小字，不带下拉箭头；项目行只显示项目名和数量，不显示 emoji。
- 窗口小于 1180 像素时右侧面板默认收起；本窗口中用户打开后保留其选择，不因后续缩放再次自动关闭。

## 文件、工具选择和回归（2026-11-06 第三批）

- 文件列表复用 `FilterInput`，顶部只有搜索、隐藏文件菜单和刷新；去掉路径、统计、查找、打开及展开折叠按钮。图标固定为单色扁平样式，不改写 `fileExplorerIconTheme`。
- `handleOpenFileTab()` 按外壳分流：新界面记录当前 AI 会话的 `newShellPanel.fileTabId` 并打开右栏，旧界面仍激活文件标签。音视频仍使用现有播放器。文件树、对话链接、改动文件名共用此入口；改动行保留单独的差异展开按钮。
- 右栏通过 `StoredFilePreview` 复用原有 FilePreview 和编辑、保存、滚动、指定行处理。顶部只保留返回、文件名及编辑保存操作，不提供“在中间展开”。返回列表保留文件缓冲区；每条会话持久化面板分页、打开状态、文件引用与搜索词。旧界面的分页选择单独保留。
- `src/shared/newShellFeatures.ts` 统一登记隐藏功能的入口、命令、快捷键与设置分页及分区；菜单、命令面板、设置搜索、插件贡献和快捷键匹配均读取此表。旧欢迎页仍只用于旧界面，新界面沿用简洁的项目起始页。
- 空的闲置会话显示项目名，以及本机可用的 Claude Code、Codex、DeepSeek。工具清单和创建动作与左栏“+”菜单共用 `context:conversation`，仅准备会话，不发送。换工具保留即时草稿、图片和输入模式，采用目标工具的模型和强度；被替换的空会话删除，无其他标签的空智能体同时移除，避免重启生成默认空会话。
- 左栏收起后内容设为 `inert`，不再留下隐藏的底部展开按钮；顶栏使用 `PanelLeft`，默认项显示“默认模型”“默认强度”，权限使用盾牌。
- CLI：`tab new --agent <id> --provider <provider> [--replace-empty <tab>]`；`tab panel <tab> <changes|files|back|open|close|edit|preview|save>`，可带 `--filter`、`--line`、`--content`。文件打开和刷新沿用 `open-file`、`refresh-files`，隐藏文件沿用 `settings set showHiddenFiles`。文本保存复用 FilePreview 保存函数。
- `e2e/native-new-shell.spec.ts` 按 hb.7 演示覆盖打开项目、Claude 改动、Codex 交接、DeepSeek 复核、三段会话切换、正常退出重启、恢复旧界面；检查界面、项目文件、原生转录和保存的会话数据。只使用合成提供方，真实模式跳过。本批按要求只写用例和做类型检查，Electron / Playwright 尚待用户运行，不宣称已完成 hb.7 真人验收。

2026-11-11 后续结果：上述“尚待用户运行”是编写阶段事实。开发构建的合成 Electron 已有通过记录，见 `docs/worklog.md`“新界面亲手走查与第一轮收口”（3 条新界面场景）及“右栏终端和任务的实跑验收”（78 条全套）；证据身份与限制见文末索引。真实三家接力、hb.7 安装包和用户全天体验仍未验证。

## 归档与删除对话（2026-11-06，T9）

- 新界面的对话右键和命令面板提供归档。归档仅保存 Maestro 标记，关闭同一工具、账户和主机下的打开标签，原生文件保持不变。运行中或排队中的对话拒绝归档。
- 项目列表底部显示“已归档 N”，展开后可以取消归档。状态由主进程保存并广播，换窗口和重启后仍保留。扫描、缓存投影和权限继承均识别归档状态；无普通对话时保留归档中的最严格权限。
- Codex 提供删除并明确确认原生记录不可恢复，沿用现有原生删除实现；Claude 不提供删除。新入口均受 `newShell` 控制。
- CLI 对应 `tab archive`、`native-history archive|unarchive`、`native-history list --archived`，删除使用 `native-history delete --yes`。边界见 [CLI-UI-PARITY.md](../agent-guides/CLI-UI-PARITY.md#new-shell-conversation-archive-and-native-deletion-2026-11-06)。
- 审查修复：取消归档保留权限元数据及原活动时间，不重新打开也不会放宽新对话权限；项目子目录和工作树共用扫描归属规则。浏览器读取和订阅归档状态，关闭标签仍由所属桌面窗口处理。
- 合成 Electron 场景在 `e2e/native-conversation-archive.spec.ts`，覆盖桌面归档往返、取消归档后的权限，以及子目录归档和取消归档后的重启保留。第四轮移除额外浏览器窗口，修改后的场景待沙箱外执行；浏览器归档读取、实时订阅、重新挂载和退订由 `useRemoteIntegration.test.ts` 单元回归覆盖，不宣称浏览器整页验收通过。

2026-11-11 后续结果：保留上述最初未运行记录。`e2e/native-conversation-archive.spec.ts` 随后已纳入 U5 的 117 条开发构建合成 Electron 记录，唯一失败为分屏综合场景，详见文末证据索引 E2。该记录没有给出被测源码 SHA，不能将记录提交冒充构建身份，也不代表当前集成全部通过。浏览器整页、真实 SSH、真实模型及安装包未验证。

## 左栏内容搜索（2026-11-06）

- 只在新界面启用。本机原生历史内容搜索与现有标题结果并列，输入至少两个字符，防抖 250 毫秒；两组依次为“对话”和“对话内容”。内容行显示标题、项目和一行高亮片段，上下键选择，回车打开，Esc 先清空搜索并回到搜索框。
- 内容搜索共用会话浏览器的解析和片段工具，读取 Claude 与 Codex 本机账户，支持 Codex 压缩归档。不扫描 SSH 内容；新界面里的远程记录只按标题匹配。
- 主进程解析账户，worker 扫描内容。新输入终止旧任务，旧返回不能覆盖新结果。单文件 8 MiB，总原始字节和展开字节合计 64 MiB，最多枚举 1024 个文件和 8192 个目录项，最多返回 50 条对话。扫描软预算 2500 毫秒，worker 硬上限 4000 毫秒，含账户发现的请求总预算 5000 毫秒。触及预算时提示搜索不完整，不能当成已搜索全部历史。
- 点击内容结果沿用原生打开与只读补读，把早于默认加载窗口的命中消息补入当前对话，再通过现有跳转机制滚动和短暂高亮。不启动模型，不改原生历史。
- CLI `maestro-cli native-history search <text> [--project <path>] [--json]` 通过桌面应用调用同一实现。点击结果后的打开、滚动和高亮，以及界面清空搜索的 CLI 对等仍列在 `CLI-UI-PARITY.md` 的 Open gaps。
- 审查修正：Codex 搜索复用显示正文的解包规则，首条用户消息不会再因内部包装而定位失败。命中已结束回合的过程消息时先展开回合，再高亮正文。旧格式从环境记录补齐项目路径；未加载项目的结果读取账户内原生标题索引，无名称时取清理后的真实用户消息。标题索引也计入搜索字节预算。
- 第三轮修正：四条 Codex Electron 场景均已搜到内容，但原生读取漏掉 `archived_sessions`，因此打开失败。共享存储发现补齐本机归档目录，保留普通文件优先和账户隔离；四条新增单元回归先失败后通过，Electron 的正文入视口与高亮断言保留，沙箱外运行仍待 Opus。
- 合成 Electron 场景位于 `e2e/native-sidebar-search.spec.ts`，分别覆盖 Claude 和 Codex 压缩归档中早于默认加载窗口的命中消息、CLI 结果、键盘操作、高亮及原生字节不变。沙箱内只做类型检查和场景收集，实际运行待 Opus。

2026-11-11 后续结果：保留上述最初未运行记录。`e2e/native-sidebar-search.spec.ts` 随后已纳入 U5 的 117 条开发构建合成 Electron 记录，唯一失败为分屏综合场景，详见文末证据索引 E2。该记录没有给出被测源码 SHA，不能将记录提交冒充构建身份，也不代表当前集成全部通过。浏览器整页、真实 SSH、真实模型及安装包未验证。

## 三家工具能做什么

界面只显示当前工具真正支持的控件，不支持的直接不出现。2026-11-05 已按附录 D 核对各家命令行的帮助和参数（记录在 [hb.7 能力核对](../verification/hb7-capabilities.md)）。标“待实测”的项必须真实调用模型才能确定，会产生费用，先问用户。

| 能力                           | Claude Code | Codex                        | DeepSeek                             | 界面上的样子                       |
| ------------------------------ | ----------- | ---------------------------- | ------------------------------------ | ---------------------------------- |
| 接续原生会话、跟随外部写入     | 支持        | 支持（含压缩历史）           | 支持（存在 Claude Code 的历史里）    | 左栏同一个列表                     |
| 任务清单                       | TodoWrite   | update_plan                  | TodoWrite                            | 任务面板                           |
| 计划模式                       | 支持        | 不支持（只有只读沙箱）       | 支持（Claude Code 的 plan 权限模式） | 权限模式菜单里的一项，Codex 不显示 |
| 推理强度                       | 支持        | 支持                         | 待实测                               | 输入框的强度菜单                   |
| 权限或沙箱模式                 | 权限模式    | 沙箱模式                     | 权限模式                             | 同一个菜单，按工具显示各自的选项   |
| 图片输入                       | 支持        | 支持                         | 待实测                               | 附件按钮                           |
| 停止当前回合                   | 支持        | 支持                         | 支持                                 | 停止键、Esc                        |
| 作为交接目标                   | 支持        | 支持                         | 支持                                 | 顶栏“交给…”菜单                    |
| 当主控派活（调用 maestro-cli） | 支持        | 待实测（沙箱默认断网，hb.8） | 支持                                 | 子任务卡片和左栏的子会话           |

DeepSeek 实际跑的是 Claude Code，只是接口地址指向 DeepSeek，所以大部分能力和 Claude Code 相同；取决于模型本身的几项标了待实测。OpenCode、Grok 等其他工具在引擎里照常可用，新界面按通用能力显示，不做专门适配。

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

- 终端、任务已实现源码。2026-11-06 把右栏扩为改动、文件、终端、任务；2026-11-10 补第五项网页，复用 `BrowserTabView`。沿用 360 像素最小宽度和每条对话的 `newShellPanel`，保存网址、页签与开合状态。本机输出链接进入右栏，外部网址行为保留。CLI 为 `tab panel web --url <url>`、`web-reload`、`web-external`，无动作时读取当前面板。`preview` 仍表示文件预览。合成场景 `e2e/native-web-preview.spec.ts` 已收集，Electron 实际运行待 Opus。
- 终端首次打开才启动；切换会话、切换面板或收起右栏保留 XTerminal。按规范化目录与 SSH 主机共享默认终端，worktree 单独匹配，顶部一行短路径、新建、关闭，多终端用下拉选择。字体、主题、宽度变化后的 fit 均沿用现有终端实现。
- 任务沿用 `agentTaskList.ts` 读取当前会话最新的顶层清单，Claude 与 DeepSeek 的 TodoWrite、Codex 的 update_plan 共用显示，Codex exec 的 todo_list 增量归一为同一工具输入。原生历史沿用转录适配器，只读，无清单时显示普通居中文字。
- 终端快捷键沿用 `⌘/Ctrl+J`，任务使用 `⌘/Ctrl+Shift+7`，均有命令面板和右栏按钮；终端聚焦时关闭、查找、清屏沿用既有动作。CLI 沿用终端读写与新建动词，补 `tab panel terminal|tasks|terminal-select|terminal-close`；旧界面保留原入口。
- 原生验收用例已补终端执行命令、切换会话后的输出保留与合成 TodoWrite 显示。Electron / Playwright 在本批编写时尚待用户运行，不宣称通过真人或发行包验收。后续“右栏终端和任务的实跑验收”记录 78 条合成 Electron 通过并实际执行终端命令（见 E1）；真实模型任务清单、真实 SSH 和安装包仍未验证。
- 改动按回合分组已实现源码。面板默认按文件，每条对话记住切换选择；从成功的 Claude 写入工具、Codex apply_patch 和 file_change 记录归类当前仍有改动的文件，最新回合在上，未归类文件在底部“其他改动”。各组均打开当前差异，不保存逐轮差异。CLI 为 `changes --by-turn --tab <id> --json`，界面切换为 `tab panel <id> changes-files|changes-turns`。已补独立于日志裁剪的写入索引与完整原生历史只读索引，长参数和旧格式 Codex 工具结果保留路径归属，按 Git 实际执行目录处理 SSH 主目录写法及本机目录别名。合成两轮及两家长历史的 Electron 场景已补，当时尚待外部运行。后续 U5 的 117 条合成 Electron 记录包含 `native-new-shell.spec.ts` 的 T8 场景，见 E2；真实 SSH、真实模型及安装包未验证，分组不是逐轮差异快照。
- 两条会话分屏已实现，合成 Electron 场景通过，真人长时间使用待验证。已有对话可从左栏右键、`⌥⌘\` / `Ctrl+Alt+\` 和命令面板在右侧打开，初始等宽，分隔线可拖动；每栏沿用对话流、输入框和运行状态，右侧面板跟随焦点。关闭分栏保留对话及进程，正常重启恢复组合和宽度。窗口不足 1180 像素或中间区域不足 720 像素时显示说明，临时退回单栏。CLI 为 `tab split <tab-id> [--ratio <fraction>]` 和 `tab unsplit`。
- 2026-11-07 分屏审查修复：新界面单栏和分屏的停止按钮、Escape 只停止目标对话及仍运行的孤儿标签，后台其他对话、排队和交接保留。附件读取绑定目标，文件树拖拽携带来源项目和主机，跨主机明确拒绝；未聚焦栏也保存阅读位置。合成 Electron 补同工具双对话同时运行和单栏后台运行场景，当时尚待沙箱外执行。后续 `docs/worklog.md`“U1 分屏 Electron 验收”记录三条合成场景通过，包含这两条停止场景。系统选图、真实拖拽、未聚焦栏滚轮、长期使用和安装包仍未验证；PR #71 新加的停止通知断言须另验。
- 项目设置完整替代智能体配置。实现分两层：PR #65 的新对话默认工具、模型、强度、权限和环境变量已有合成 Electron 通过；PR #76 的按工具账户目录、程序、参数、环境、Claude 调用方式与 SSH 主机配置已实现，最新场景 `e2e/native-project-tool-config.spec.ts` 尚无通过回执，不能将默认值验收扩成完整替代验收。多项保存不是事务。
- 子任务挂在父会话下面：@提及和 maestro-cli 派出的活能点开、插话、接着聊；来源标签关掉以后也能按原生 id 挂回去。
- 2026-11-07 U3 源码已补父子树、运行时展开、首句标题、原生 id 回填和 CLI `tab children` / `tab select`。咨询仍不产生未读，运行中插话使用既有队列。单元回归通过；`e2e/native-subtasks.spec.ts` 合成场景已收集，当时尚未运行 Electron。后续“U3 子任务 Electron 验收”记录同窗口场景通过（PR #66），不能代替跨窗口验收。界面折叠状态、已关闭父对话的 CLI 地址见 CLI 对等表的 Open gaps。2026-11-10 跨窗口 CLI 新建子任务改由目标窗口保存来源后回执，双窗口关闭和重启场景已补，Electron 待沙箱外执行；来源原生 ID 尚未到达时的跨窗口补写仍列为缺口。
- 额度用尽自动交接，在项目设置里开，默认关；开启时说清楚会用哪个账户。2026-11-11，PR #76 已实现，仅新界面额度或限流错误触发，接收方不再次转交、目标失败不自动重试；`e2e/native-auto-handoff.spec.ts` 最新产品修复后未见 Electron 通过回执，真实交接未验证。
- 实测 Codex 能不能当主控。2026-11-11，PR #77 的开发构建 `eab909e35` 已真实通过 Codex 派 Codex 子任务并引用结果；派 Claude 因访问令牌过期未完成。只覆盖完全访问 exec 路径，见 `docs/verification/real-codex.md`。

验收：检查清单逐项通过；旧界面的右栏一次都不需要打开；一个任务里 Claude 派活给 Codex，子任务在左栏能点开并插话。

### hb.9：新界面成为默认

- 新安装和升级都默认新界面，旧界面保留一个版本。
- 按决定 4 删除确认不用的上游功能。
- 手机网页版换成新界面的窄屏形态。

验收：删除后全部测试通过，安装包体积和启动时间不变差。

第一次打开的原收尾要求：更新偏好的旧标题和推荐测试版说法、紫色闪屏需要处理，崩溃报告的告知不能丢。2026-11-11 补充：PR #60、#67 已将更新偏好改为中性文案，相关记录见 `docs/worklog.md`“第一次打开和登录失败”“U6 文案审计验收”及 `e2e/new-shell-copy-audit.md`；不再把文案全部列为待做。首次真实使用、闪屏最终观感及默认切换体验仍未验证。起始页只说明工具已安装，登录有效性仍到发送时确认。

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

- IPC：`git:changes(cwd, sshRemoteId?, remoteCwd?)` 返回 `GitChanges`，`git:changeDiff(cwd, path, sshRemoteId?, remoteCwd?)` 返回 `GitFileChangeDiff`。处理函数放在 `src/main/ipc/handlers/git/changes.ts`，走 `execGitReadOnly()` 和现有的 SSH 路径；预加载在 `src/main/preload/git.ts`；渲染层在 `src/renderer/services/git.ts` 加 `getChanges()` 和 `getChangeDiff()`。
- 状态和行数一次往返：同一条命令里跑 `git status --porcelain=v2 -z` 和 `git diff HEAD --numstat -z`，未跟踪文件的行数也在这条命令里数，超过 1 MiB 或二进制的记 null。
- 还没有提交的新仓库（没有 HEAD）按空树比较，不报错。
- 命令行：`maestro-cli changes [--agent <id>] [--tab <id>] [--file <path>] [--json]`，输出同样的结构。只读，不改工作区。
- 什么时候刷新由界面决定：回合结束、切到这条会话、手动刷新。后端不加文件监听。
- 2026-11-06 补单文件收尾：`git:applyChange(cwd, request, sshRemoteId?, remoteCwd?)` 统一处理暂存、取消暂存、确认撤销和提交。CLI 为 `changes stage|unstage|revert <path>...` 与 `changes commit --message <text>`，撤销必须带 `--yes`。新界面按暂存状态分组，撤销说明文件名和删除新文件的后果；冲突文件不提供撤销。提交只包含暂存区，失败保留 Git 原始诊断。完整边界与对等关系见 [CLI-UI-PARITY.md](../agent-guides/CLI-UI-PARITY.md#new-shell-single-file-changes-2026-11-06)。

### C. 交接和复核

交接已有：`requestAiHandoff()`（`src/renderer/services/aiHandoffEntry.ts`）和 `maestro-cli handoff <tab> <provider> [--send]`。hb.7 补三件事：

1. **同一个工作目录。** 目标会话和来源会话用同一个工作目录，包括 worktree 和 SSH 主机。目标工具在这个项目里还没有配置时，按该工具的全局设置新建，DeepSeek 用它的预设。做不到就明确报错，不能悄悄换到本机或项目根目录。
2. **复核模式。** `ai_handoff` 的 `prepare` 加 `mode: 'handoff' | 'review'`，默认 `handoff`。复核草稿包含：来源会话目标的简短摘要（沿用交接的长度预算）、`git:changes` 的文件清单、请对方自己运行 `git diff HEAD` 阅读已跟踪文件的改动、直接阅读清单里的未跟踪文件、只报告问题不改文件。目标工具支持只读模式（`supportsReadOnlyMode`）时用只读模式启动。
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

2026-11-11 规格差异，**待用户确认**：以上原要求保留。当前 `src/shared/conversationChildren.ts` 的 `findConversationParent()` 和 `conversationBranch()` 排除 `handoff`，交接后的新对话保持顶层；复核与子任务仍嵌套。原因是嵌套会让归档来源时隐藏正在接力的对话，见 `docs/worklog.md`“U3 子任务 Electron 验收”。未找到用户同意该调整的记录，不能将它记为原规格完全实现。

### D. 能力核对

新界面只用 `src/main/agents/capabilities.ts` 里的字段决定控件出不出现，不在界面里另写一份。待核实的项由 Codex 用已安装的命令行核对：只看帮助和参数、不发模型请求就能确定的，直接核对，并在字段旁注明核对的命令行版本；必须真实调用模型才能确定的（DeepSeek 的图片输入和推理强度），先问用户，因为会产生费用。

### E. 新会话（界面侧，列出来说明依赖）

`SidebarProject.agents`（`src/renderer/utils/projectSessionTree.ts`）已经给出每个工具在这个项目里新会话用的配置。新界面的“新会话”菜单直接用它；某个工具在这个项目还没有配置时，用现有的新建智能体路径静默建一个，配置取自该工具的全局设置，新界面里不显示它。命令行沿用 `create-agent` 和 `tab new`。hb.8 的项目设置让这份配置可以按项目修改。

## 本轮完成情况（2026-11-11）

本表覆盖上文路线图及补充项。路线图的 hb.7、hb.8、hb.9 是原计划阶段，不等于当前包版本。核对的集成源码为 `92dd094f3`；本次仅整理记录，没有运行 Electron 或模型。“已实现已验证”仅指证据栏限定范围，不表示安装包、全平台或真人验收。没有通过回执的应用链路列“已实现未验证”，即使其单元测试已通过。工程缺口不能仅因需要真人体验就视为完成。

证据索引（均为仓库内既有记录，原始失败和未运行记录保留）：

- E1：`docs/worklog.md`“新界面亲手走查与第一轮收口”“右栏终端和任务的实跑验收”。本地开发构建合成场景，后者 78 条通过，记录提交 `502951bc9`；没有被测源码 SHA，身份待补，记录提交不等于构建提交。
- E2：`docs/worklog.md`“U5 原型验收和一个主线偶发失败”，记录提交 `e444523d8`。开发构建全套 117 条中仅分屏综合失败，修复布局比例判断后该场景 8 次通过；不是一次全套 117/117。后续全套包含搜索、归档、T8，具体场景见表；被测源码 SHA 未记录，待补，不能用当前 HEAD 代填。
- E3：同工作记录的“U1 分屏 Electron 验收”（3 条）、“U2 项目设置 Electron 验收”、“U3 子任务 Electron 验收”。对应 PR #64、#65、#66 和各同名场景；都是开发构建合成 Electron，通过记录未给出构建 SHA。
- E4：`e2e/claude-standard-approval.md` 的 11-09 真实允许结果，源码 `f5d3e7aab`、Claude Code `2.1.317`；11 条旧合成场景通过见工作记录“U4 第四轮 CLI 标准权限拒绝回执”。#73 新增停止场景没有新通过记录。
- E5：`docs/verification/real-codex.md` 的 11-11 结果，源码 `eab909e35`、`codex-cli 0.167.0-alpha.3.2`、`gpt-6-astra`，合成 app-server 与两条真实工作负载通过。不是完整协议准入，也不是安装包。
- E6：`docs/verification/v1.0.1-hb.6.md`，包来源 `df8da1690a847efb6b0d33b6cb20687953ad244d`；41 条包内合成脚本和 6 条开发构建选定真实模式分开记录。该包早于新界面，不能替 hb.7 验包。

| 路线图条目                            | 状态         | 证据与验证边界                                                                                           | 仅需真人体验的部分                   |
| ------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 新旧界面开关与 CLI                    | 已实现已验证 | PR #47、#48；E1，`e2e/native-new-shell.spec.ts` 合成切换                                                 | 切换是否顺手                         |
| 三栏骨架、项目对话左栏、中间顶栏      | 已实现已验证 | PR #47、#56；E1，`native-new-shell.spec.ts`                                                              | 全天导航与布局                       |
| 打开项目、最近项目与第一次打开        | 已实现已验证 | PR #56、#60、#67；E1，`native-new-shell.spec.ts`                                                         | 首次真实使用和登录提示               |
| 顶栏、主题、输入细节和中英文文案      | 已实现已验证 | PR #56、#67；E1，`e2e/new-shell-copy-audit.md`                                                           | 可读性与闪屏观感                     |
| 隐藏上游入口，保留旧设置              | 已实现已验证 | PR #56、#67；E1，`src/shared/newShellFeatures.ts`                                                        | 是否仍需要隐藏功能                   |
| 新对话选择 Claude、Codex、DeepSeek    | 已实现已验证 | PR #56；E1，`native-new-shell.spec.ts` 合成创建                                                          | 工具选择体验；DeepSeek 真实能力另验  |
| 改动与文件面板、指定行、编辑保存      | 已实现已验证 | PR #48、#56；E1，`native-new-shell.spec.ts`                                                              | 文件工作流是否顺手                   |
| 单文件暂存、撤销、提交                | 已实现已验证 | PR #59；E2，`native-new-shell.spec.ts`；真实 SSH 未验证                                                  | 确认文案是否清楚                     |
| 顶栏手动跨家交接与同目录              | 已实现已验证 | PR #48、#56；E1，`native-new-shell.spec.ts` 合成三家                                                     | 上下文质量；真实三家接力另验         |
| 额度用尽或登录失效旁的手动入口        | 已实现未验证 | `aiHandoffEntry.ts`；E6 的 F4 未验，#76 自动额度场景不覆盖登录失效入口                                   | 提示是否易发现                       |
| 改动面板让另一家复核                  | 已实现已验证 | PR #48、#56；E1，`native-new-shell.spec.ts` 合成复核                                                     | 真实复核质量另验                     |
| 原生历史打开、接续、外部跟随          | 已实现已验证 | PR #46；E6；新界面 E1，不代表全双端真实链路                                                              | 长历史日常阅读                       |
| 对话归档、取消归档和 Codex 删除       | 已实现已验证 | PR #62；E2，`native-conversation-archive.spec.ts`；浏览器整页未验证                                      | 归档是否符合习惯                     |
| 左栏本机内容搜索与定位                | 已实现已验证 | PR #62；E2，`native-sidebar-search.spec.ts`；SSH 仅标题                                                  | 搜索质量与操作习惯                   |
| 原生命令发现、账户切换和刷新          | 已实现已验证 | PR #62；E2，`native-commands.spec.ts`；真实 SSH 未验证                                                   | 命令提示是否好找                     |
| 工具全文与长历史性能                  | 已实现未验证 | `native-tool-output.spec.ts` 有合成记录；`docs/perf-renderer.md` 的流式按键 p95 退化仍待核实             | 长时间输入和阅读感受                 |
| 常驻终端                              | 已实现已验证 | PR #58；E1，`native-new-shell.spec.ts` 实际终端合成验收；SSH、多窗口未验                                 | 终端工作流与按键                     |
| Claude、Codex 任务清单                | 已实现已验证 | PR #58、#61；E1、E2，`native-codex-plan.spec.ts`；`docs/verification/codex-plan.md` 真实 exec 全链路未验 | 清单可读性；真实 exec 另验           |
| 右栏网页预览                          | 已实现未验证 | PR #74；`native-web-preview.spec.ts`，工作记录有修复前失败及单元结果，最新 Electron 未验证               | 常用网站兼容性                       |
| 改动按回合分组                        | 已实现已验证 | PR #62；E2，`native-new-shell.spec.ts` T8；非逐轮差异快照                                                | 分组对复核的帮助                     |
| 两条对话分屏与独立停止                | 已实现已验证 | PR #64；E3，`native-new-shell-split.spec.ts` 3 条合成通过                                                | 系统选图、真实拖拽与长期使用         |
| 新对话的项目默认值                    | 已实现已验证 | PR #65；E3，`native-project-settings.spec.ts`；SSH 只测设置隔离                                          | 默认值是否合用                       |
| 项目设置完整按工具配置替代            | 已实现未验证 | PR #76；`native-project-tool-config.spec.ts`，最新 Electron、真实 SSH 未验证                             | 账户和主机说明是否清楚               |
| 同窗口子任务可见、插话、续聊、挂回    | 已实现已验证 | PR #66；E3，`native-subtasks.spec.ts`；完成后树自动收起                                                  | 介入和收起行为是否合用               |
| 跨窗口子任务来源保存和重启挂回        | 已实现未验证 | PR #72；`native-cross-window-subtasks.spec.ts` 未运行回执；晚到原生身份补写仍有 Open gaps                | 跨窗口组织体验                       |
| 额度用尽自动交接、默认关闭、账户告知  | 已实现未验证 | PR #76；`native-auto-handoff.spec.ts` 最新 Electron 未验证；仅额度或限流                                 | 是否愿意启用及提示清晰度             |
| Codex 当主控                          | 已实现已验证 | PR #77；E5，`real-codex-orchestrator.spec.ts` 派 Codex 真实通过，派 Claude 未完成                        | 派活效率；Claude 真实路径仍需重跑    |
| Claude 标准审批                       | 已实现已验证 | PR #69、#70；E4；真实只覆盖允许，不含拒绝、停止、超时                                                    | 审批信息可读性                       |
| Claude TUI、Dynamic 禁用标准权限      | 已实现已验证 | PR #69；工作记录“U4 TUI 标准权限验收”记录用户决定；E4 合成                                               | 无新增待定产品决定                   |
| Codex app-server 审批、追加、停止原型 | 已实现已验证 | PR #68、#75、#77；E5，`real-codex-app-server.spec.ts`；仅固定版本工作负载                                | 日常可用性；全协议及包内仍需工程验证 |
| 完整停止 CLI、审批中停止及停止通知    | 已实现未验证 | PR #71、#73；`native-claude-permission.spec.ts`、`native-new-shell-split.spec.ts` 新断言待跑             | 停止反馈是否明确                     |
| 交接来源嵌套（附录 C 原要求）         | 未实现       | `conversationChildren.ts` 保持顶层，E3 解释原因；规格差异待用户确认                                      | 确认保持顶层还是恢复嵌套             |
| 新安装、升级默认新界面                | 未实现       | `src/main/stores/defaults.ts` 与 renderer 默认 `newShell: false`                                         | 候选包全天使用后决定                 |
| 删除确认不用的上游功能与旧界面        | 用户同意推迟 | 上文决定 4、5；先用一个版本确认，默认切换后旧界面再留一个版本                                            | 确认删除清单与时机                   |
| 手机窄屏新界面                        | 已实现未验证 | 共享 renderer 与 `index.css` 窄屏基础；手机专项未完成                                                    | iOS、Android 输入法和后台恢复        |
| 完整 MCP、指令文件配置同步            | 用户同意推迟 | 原路线图 hb.9 之后；About Me 基础不等于全套完成                                                          | 未来逐项写入的易理解程度             |
| Kimi、GLM 预设                        | 用户同意推迟 | 原路线图 hb.9 之后                                                                                       | 未来实际使用价值                     |
| DeepSeek 图片、推理强度与实际模型行为 | 已实现未验证 | `docs/verification/hb7-capabilities.md` 仅帮助和参数核对；真实网关未验证                                 | 模型效果和使用成本；能力仍需真实验证 |
| 全部界面动作 CLI 对等                 | 未实现       | `CLI-UI-PARITY.md` Open gaps：历史打开定位、树折叠和部分视图状态；#73 只补完整停止                       | 是否修改对等要求须用户决定           |
| hb.7 全天工作与 hb.8 完整清单验收     | 未实现       | E1、E3、E5 仅局部证据；Claude 派 Codex 插话仍只有合成通过                                                | 候选包全天工作                       |
| hb.9 删除后全测试、包体积与启动验收   | 未实现       | 删除与默认切换未发生，无对应包证据                                                                       | 无，仍需工程验证                     |
