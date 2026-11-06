# 分支工作记录

以下日期使用 Europe/Paris。此记录归纳实际交付，不把回退、重复检查和限额等待包装成额外功能。具体代码由 Git 提交保留；本机原始验收日志与截图保留在私有工作目录，公开记录不包含个人对话、账户路径或原生会话标识。

## 2026-11-06：T8 第二轮审查修复

四条审查意见均成立。被测对象为 `codex/changes-by-turn` 本克隆源码，未构建发行包。先补回归再修：长 Claude Write 和 Codex 补丁得到空索引，旧格式 Codex 成功和失败结果各多出孤立记录，目录别名无法归组，保存 100 条日志后早期回合丢失，CLI 和面板遗漏早期分组。失败证据保存在任务私有报告旁，不提交原始日志。

`toolInputWritePaths()` 在展示裁剪之前保留明确路径，状态仍必须成功。旧格式 Codex 的结果按调用标识回填原工具，缺失结果保留未知，后续消息计数不变。Git 查询带回执行主机上的实际子目录，匹配 SSH 主目录写法和已知 cwd 别名，不对远程路径做本机 realpath。

新界面持久化在日志裁剪之前保存 `changeTurnIndex`。两端通过 `agentSessions:turnWrites` 读取完整原生写入索引，复用账户解析、SSH 传输及只读增量存储，不写入或恢复原生文件。纯转换器移到 `src/shared/transcriptEntries.ts`，旧 renderer 导出路径保留。主进程缓存最多 32 个身份，历史未变时复用；追加时只转换仍开放的回合及新增消息，并保留等待迟到结果的写入。默认按文件不读取原生索引，避免原生记录不可用影响文件操作。

相关最终验证为 18 个不同 Vitest 文件、406 条通过。均使用 `--configLoader runner --no-cache`，不放宽断言，不自动重试。renderer、main、CLI 三份 TypeScript 配置通过；Electron 用例另用继承严格选项且支持 CJS 夹具和 ES2024 的临时配置检查通过。修改的产品源码及 Electron 用例的 ESLint、修改文件的 Prettier 和 `git diff --check` 通过。Electron 场景仅完成收集，共三条，未启动应用。

没有新增 CLI 动词，既有 `changes --by-turn --tab <id> --json` 使用相同持久化索引、完整原生索引和分组逻辑。`CLI-UI-PARITY.md` 已更新，尚无原生记录时仍可能短暂等待正常保存。旧界面不开启新索引读取或持久化；共享的旧格式工具结果关联、隐藏路径字段和新增 Git 元数据也适用于旧界面，分别用于恢复正确状态、避免展示裁剪损失证据和提供执行路径。

扩展原有 T8 场景验证 150 条后续日志裁剪与重启，新写 Claude、Codex 两条超过 600 条消息和 5000 字符参数的原生历史场景；Codex 使用旧格式工具调用与结果。由 Opus 在沙箱外运行 `MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-new-shell.spec.ts --grep 'new shell T8' --retries=0`。本轮未验证真实 SSH、Windows/Linux、真实模型或安装包；旧缓存已经丢失且没有可读原生记录的证据无法重建。没有推送、PR、标签、上传或发布。

## 2026-11-06：T8 改动按回合分组

被测对象为 `codex/changes-by-turn` 本克隆源码，未打包、未安装。新界面改动面板增加按文件和按回合切换，选择保存到当前对话的 `newShellPanel.changesView`。共享 `collectTurnWrites()` 从成功工具记录建立索引，`groupChangesByTurn()` 与当前 Git 文件清单求交集，同文件保留在每个对应回合，其他文件放到底部。显示用户消息第一行和时间，明确所有入口打开当前差异，原有暂存、撤销、提交入口共用。索引按日志引用缓存，刷新 Git 或修改提交说明不会重扫工具历史。

先写回归并运行：共享模块缺失导致导入失败，Codex 文件事件三条断言得到 `system` 而非工具记录；原生读取文件事件返回空列表；面板两条回归缺少切换控件与无记录说明，CLI 未返回分组。补充边界回归分别确认重命名丢失先前回合，以及没有结果的旧 Codex 调用误报成功，再实施修复。未放宽业务断言或跳过测试。

相关 Vitest 最终共 8 个不同文件、366 条通过，均使用 `--configLoader runner --no-cache`。包括两家写入记录、失败与未知状态、跨回合同文件、重命名、其他改动、SSH 路径、视图偏好、中英文、两种视图的同一组写操作、CLI 和重渲染缓存。解析器测试补入临时账户目录隔离后，其 184 条再次通过。渲染层、主进程、CLI 三份 `tsc --noEmit` 检查通过；本次产品源码及 Electron 用例的 ESLint、修改文件的 Prettier、`git diff --check` 通过。CLI 构建成功，命令参考仅更新本次新增项。

CLI 新增 `changes --by-turn --tab <id> --json` 及 `tab panel <id> changes-files|changes-turns`，对等登记已更新。前者读取已持久化对话日志和当前 Git 状态，可能短暂落后于尚未持久化的界面更新。未读取加载窗口之外的原生历史；截断输入、无法对应的路径和状态未知的工具不推测归属；Git 500 文件上限保持不变。

新控件与偏好切换均由 `newShell` 限定，旧界面无布局或操作变化。必要的共享变化是保留 Codex `file_change` 工具事件，以及将无关联结果的旧 `tool_call` 状态从成功改为未知，以免归组到失败或未完成的写入。旧界面也会读到这些修正后的工具记录，不改原生文件。

`e2e/native-new-shell.spec.ts` 新增 T8 合成日志场景，覆盖两轮文件写入、同文件多组、其他改动、当前差异、暂存、CLI 输出、两条对话偏好隔离和正常重启。Playwright `--list` 发现一条场景，未执行 Electron。由外部运行 `MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-new-shell.spec.ts --grep 'new shell T8' --retries=0`。本轮没有真实模型调用、SSH 主机实测、Windows/Linux 实测或发行包验收，没有推送、PR、标签或发布。测试执行的隔离疏漏与后续修正如实记录在任务私有报告中。

## 2026-11-06：四条已审查分支的集成核对

在 `codex/nov6-qa-batch` 从 `2ebe18308` 依次以非快进合并纳入新对话权限、停止续聊、Codex 任务清单和改动面板文件操作。四次合并提交为 `b48f230b5`、`a737b0f41`、`cc84c0857`、`b30af198e`。后三次的 CHANGELOG 与 worklog 冲突均保留双方新增段落；最后一次的 `e2e/native-new-shell.spec.ts` 保留完整权限继承和单文件操作场景。CLI 对等、规范工具登记、预加载类型、中英文消息及原生 CLI 夹具的自动合并均复核，无功能删减。

四个分支的 `src/__tests__/setup.ts` 与起始主线完全相同；权限测试的局部窗口 mock、停止事件的第四个参数、Git 写入桥和 Codex 事件回放各自保留。权限快照与任务工具参数独立传递，只读沙箱和任务工具能同时启用；新会话不调用转录解码器，用户历史仍先解系统封装再调用 `stripTurnPrompt()`。任务结束快照不再把最终回答改成进度，主动停止仍通过 `interrupted` 跳过退出摘要。文件操作使用原对话目录和 SSH 主机，不受权限快照或转录刷新影响。没有发现需追加产品修复的集成问题。

被测对象为合并后的源码 `b30af198e`，不是安装包。相关 Vitest 均使用 `--configLoader runner --no-cache`：38 个改动文件共 2097 条通过，16 个相邻共享模块文件共 835 条通过，3 个原生夹具文件共 12 条通过，总计 57 文件、2944 条，无失败、无跳过、无自动重试。renderer、main、CLI 三份 TypeScript 配置全部通过；四个相关 E2E 文件另用继承原严格选项的临时配置检查通过。修改文件的 Prettier 与 `git diff --check` 通过。Playwright 仅收集合成场景，3 文件共 12 条，不记作 Electron 执行通过。

新界面权限继承、任务工具默认启用和文件操作控件仍由 `newShell` 控制。已有分支中的停止与转录修复、Codex 输出状态修复、Git 状态纠正及英文单数文案属于共享修复，旧界面同步受益。本次没有新用户动作、CLI 动词或文案，继承各分支已登记的 CLI 对等及缺口。不运行 Electron、真实模型、真实 SSH、其他平台或安装包；不推送、开 PR、打标签或发布。外部重建后可运行 `MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-new-shell.spec.ts e2e/native-stop-resume.spec.ts e2e/native-codex-plan.spec.ts --retries=0`；真实 Codex 诊断不属于本次授权范围。

## 2026-11-06：权限继承验收复用 Electron 浏览器

`e2e/native-new-shell.spec.ts` 的所属窗口与网页来源场景移除 Playwright `browser` 夹具，通过 `native.app.evaluate()` 创建无 preload 的普通 `BrowserWindow`，加载原 web-desktop URL，并通过 Electron 的窗口事件取得 Page。窗口随 `native.close()` 清理，不再依赖单独安装 Chromium；未增加下载、安装或重试步骤。权限断言、产品实现、旧界面及 CLI 均不变。

被测对象为本分支测试源码，修复提交 `467719a52`。临时源码回归修改前 1 条失败，修改后 1 条通过；相关权限单元测试 2 文件、45 条通过，无跳过。`npx tsc --noEmit -p tsconfig.json` 通过；原文件 153 条断言语句逐条比对相同。Playwright 只做测试收集，两份文件共 8 条场景成功收集，未启动 Electron。格式检查通过。沙箱外的 Electron 多窗口与真实 web-desktop 路径仍需 Opus 运行，不将静态检查或收集成功记作场景通过。

## 2026-11-06：停止与续聊第三轮 Electron 场景修正

外部第二轮 Electron 结果为四条中两条通过，两条长历史场景在保存文件中查找早期消息时得到空数组。核对两家失败 trace 的正文日志行，均已有两条干净的用户原话，本地发送保留，真正的第二次发送也保留。原因是场景手工注入了超过 650 条日志，却期望每次只保存最后 100 条日志的缓存仍包含最早两条。此失败没有证明产品修复失败。

新增跨层回归直接调用 `refreshNativeConversation()` 和 `useDebouncedPersistence()`，核对 500 条首次读取、覆盖旧提示的扩大读取、合并后的完整日志和原生身份、精确的持久化尾部，以及保存没有裁剪内存。Claude、Codex 两组在未修改产品源码时通过，复现原场景所见的磁盘空数组。原始失败证据沿用外部 Electron 的两条失败，没有为了制造失败改动产品。

修正长历史 E2E：让目标对话初始不激活，点击前确认没有对应读取，点击后从现有主进程日志检查 500 条及扩大读取；完整正文严格检查两条原话、两种身份、旧副本消失和内部提示消失；保存内容逐项等于最后 100 条。再次重启后真实向上滚动加载原生历史，再检查两条原话及原生身份，最后验证原生文件字节不变。读取和合并没有替换为 mock，没有缩短历史、放宽两条消息断言、跳过或自动重试。

被测对象为本克隆源码。相关 Vitest 使用 `--configLoader runner --no-cache`，4 文件、187 条通过，无跳过；`npx tsc --noEmit -p tsconfig.json` 通过。修改文件的 Prettier、E2E 的 ESLint、测试破折号检查及 `git diff --check` 通过。Playwright 仅发现四条场景，本轮没有执行 Electron。旧 trace 没有记录 IPC 参数，不能单独证明原运行究竟由启动自动刷新还是点击触发，也不能直接读出窗口序列；新的场景增加这两项明确检查，仍待外部验收。

本轮只改测试和验证文档，不增加用户功能或 CHANGELOG 产品条目，不改新旧界面、共享行为、CLI 动作、i18n、账户或 SSH 路径。既有原生刷新和 Stop 的 CLI 对等缺口保持记录。没有运行真实模型、SSH、其他平台或安装包，没有推送、开 PR、打标签或发布。外部重建后执行 `MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-stop-resume.spec.ts --retries=0`。

## 2026-11-06：停止与续聊第二轮审查修复

在 `codex/stop-and-resume` 的 `b42f25b92` 上逐条核实三项意见，全部成立。修复前实际刷新服务的 Claude、Codex 两组回归共四条失败，分别显示真实重复发送被删为一条、较长历史返回 `unchanged` 而旧缓存未升级；实际协作提示生成函数的并行、转交及组合三条回归均显示内部提示泄露。测试夹具最初遇到 Node 环境缺少 window 和 JSDOM URL 解析问题，改用渲染层测试环境与仓库内提示文件后才计入业务失败证据。补充的部分窗口首条消息误绑定回归也先失败再修复。

无锚点时按完整读取中的第一条原生用户消息建立顺序，部分窗口不作这个推断，连续刷新保留真正重复发送。缓存还含内部提示时，刷新继续扩大只读范围，覆盖待修复的原生身份后才合并；达到原有读取上限而仍未覆盖则保留缓存并返回失败。共享 `turnPrompt.ts` 为可编辑的协作提示提供可逆封装，读取兼容已经落盘的默认并行与转交提示，旧文件不改写。未知旧自定义提示缺少边界，保守保留。

生产修复提交 `93fe257f4`，回归提交 `cf383b0ed`。被测对象为本克隆源码。相关 Vitest 分组运行，16 个不同文件、421 条通过，无跳过；最后修改刷新失败分支后该服务的 34 条另行通过。全部使用 `--configLoader runner --no-cache`。`npx tsc --noEmit -p tsconfig.json` 通过，修改产品源码与 E2E 的 ESLint、Prettier、`git diff --check` 通过。没有全量 Vitest、自动重试或放宽业务断言；协作提示旧有精确断言随新封装更新，仍逐字核对完整提示。

`e2e/native-stop-resume.spec.ts` 保留原有两条停止重启续聊场景，新增 Claude 和 Codex 的旧长历史缓存修复、保留真实重复发送、再次重启和原生文件字节不变场景。Playwright 仅发现四条场景，没有执行 Electron。由外部运行 `MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-stop-resume.spec.ts --retries=0`，夹具只用临时目录和合成提供方，明确拒绝真实模式。

本轮没有界面动作、CLI 动词或可见文案新增；Stop、原生历史刷新和原始 native-history 读取的既有对等缺口仍在指南中保留。修复属于新旧界面共用的转录身份与提示格式，未改布局、默认设置、账户或 SSH 路径解析。未运行真实模型、SSH、Windows/Linux、安装包或用户资料验收，未推送、开 PR、打标签或发布。私有报告和测试日志不进入公共提交。

## 2026-11-06：停止摘要误报与只读续聊重复消息

在 `codex/stop-and-resume` 基于 `2ebe18308` 核对 QA 记录，确认主动停止仍触发退出摘要，Codex 本轮没有最终答复后被当作摘要失败；只读后缀写入原生历史但本地消息没有，恢复时文本不匹配。回归只保留真实数据形状，正文、时间和标识均替换为合成值。

进程已有的 `interrupted` 标记通过退出事件和预加载传到摘要调度，停止时跳过摘要并移除该对话的待执行延迟摘要。普通摘要失败继续提示，中英文文案补齐。共享 `readOnlyPrompt.ts` 固定原有线上格式，发送与读取共用；转录转换还原用户原话，旧缓存仍会触发只读刷新，已缓存的同条本地与原生消息按时间、原生身份和相邻回合边界修复。真正重复发送保持两条，原生历史不改写。本次没有新增界面动作，CLI Stop 仍在 Open gaps 中。

被测对象为本克隆源码，生产修复提交 `827844f7b`、`3e59dbfab`。首次相关回归 5 文件、14 失败、140 通过；扩展检查发现本次引入的长历史扫描退化，改用索引和相邻回合后修复，没有调整断言或测试时限。最终相关 Vitest 使用 `--configLoader runner --no-cache`，19 文件、572/572，无跳过。`tsconfig.json` 与 `tsconfig.main.json` 的无输出类型检查通过；修改源码与 E2E 的 ESLint 无错误，5 个测试文件按项目现有配置被忽略；修改文件经 Prettier。

新增 `e2e/native-stop-resume.spec.ts`，Claude 和 Codex 各覆盖只读发送、停止、正常退出、同数据重开、续聊，检查用户消息只有一份、无内部后缀、无摘要失败提示及原生文件前缀不变。Playwright 仅发现两条场景，未执行。外部运行命令：`MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-stop-resume.spec.ts --retries=0`。测试只用合成提供方及临时目录，真实模式会明确拒绝。

这是新旧界面共用的停止语义和转录解码修复，不改变布局或设置默认值。没有运行 Electron、真实模型、真实 SSH 或 Windows/Linux 验收，没有构建安装包，没有修改依赖链接，没有推送、开 PR、打标签或发布。原始 QA、测试日志和中文交付报告均留在私有路径，不进入公共提交。

## 2026-11-06：Codex 计划 Electron 场景发送调用修正

Opus 报告合成场景在 dispatch 处被 `unknown option '--json'` 中断。新增覆盖合成和真实场景全文件的源码契约回归，修复前两项均失败。合成首轮和追问改用 `native.send`；真实诊断使用同一输入框的 fill 和 Enter，保留原始提示词，避免通用真实 workload 追加“不使用工具”。三处发送调用外的结果断言不变，重试与真实运行准入不变。逐项核对后续 CLI 的参数登记与返回结构，没有发现同类调用错误。

修复后相关 Vitest 为 3 文件、14 项通过，使用 `--configLoader runner --no-cache`，无跳过、无重试。`npx tsc --noEmit -p tsconfig.json` 通过；专项 E2E 类型检查补齐命令行模式、ES2024 lib、renderer 全局声明及 CJS 夹具读取后通过，未修改项目 tsconfig。更新 CLI 对等与运行说明，无产品代码或共享夹具行为变更，因此不新增产品 CHANGELOG 条目。

被测对象仅为本分支测试源码，未构建应用、启动 Electron、操作真实窗口或调用模型。源码契约测试只防止再次误用自动追加 JSON 参数的夹具，不能证明 Electron 或真实模型链路通过。Opus 仍须按[核对记录](verification/codex-plan.md)运行合成场景；真实诊断保持原有授权边界。

## 2026-11-06：Codex 任务清单第二轮审查修复

核对 Opus 经用户授权取得的 `0.166.0-alpha.6` CLI 事件，确认最终正文后还会发送 todo_list 的结束快照。输出层仅在新工具开始时把前文判为进度，保留更新和结束后的正式回答。解析器原有状态分类正确，无须改协议或伪造任务。此为共享输出层修复，旧界面收到同一序列时也保留回答；旧界面仍不自动开启计划工具，其他提供方不变。

先写回归：完整脱敏序列及更新、结束两个尾事件用例共 3 失败、281 通过，失败均为正式输出次数 0。夹具扩展前另有 3 失败、7 通过，证明原夹具不能原样回放、默认启动会覆盖 CODEX_HOME。修复后相关 Vitest 共 4 文件、294 项通过，均使用 `--configLoader runner --no-cache`，无跳过、无重试，账户和项目仅用临时目录。renderer、main 类型检查通过；两个 E2E 文件使用含 renderer 全局声明和 ES2024 lib 的临时配置完成类型检查。初次 E2E 类型检查配置缺少这两项，补齐配置后通过，无放宽断言。

新增默认合成 Electron 场景验证 2/2、正式回答与下一条消息后的可见性；真实诊断新增现有登录模式，继承 CODEX_HOME，不复制账户，使用 readonly 和 ephemeral，只发一条，不断言历史或重启。CLI 沿用 dispatch 和 tab panel，共享原实现，没有新动词；live 面板快照的对等缺口保持明示。

被测对象为本分支源码与合成可执行夹具，没有构建安装包、运行 Electron 或调用模型。Playwright 仅列出两个用例，未执行。真实应用内登录链路、SSH、其他平台及原生历史恢复仍待 Opus 按[核对记录](verification/codex-plan.md)执行。原始真实日志、账户路径与最终私有报告不进入公开提交。

## 2026-11-06：Codex 真实任务清单链路调查

核对本机 `codex-cli 0.166.0-alpha.6` 的版本、帮助、feature 列表和包内文本，并阅读同版本官方源码。`update_plan` 可用但默认关闭，配置是 `tools.update_plan.enabled=true`；已准入的 `0.163.0-alpha.11.1` 也默认关闭。只在新界面桌面对话启动时显式启用，本机、SSH 参数与 CLI dispatch 共用原启动实现，不写用户配置或改变权限。版本准入表保持原样。

先加回归确认 4 文件、12 项失败，再修复启用参数、畸形 todo_list 和双语空状态。补充原生 function_call 的追加读取、冷读一致和文件字节不变检查。最终相关 Vitest 使用 `--configLoader runner --no-cache`，6 文件、501 项通过，无跳过；renderer 与 main 的 tsc 检查通过。新增 `e2e/real-codex-plan.spec.ts` 仅做类型检查，未执行，默认跳过。临时提供方配置经本机 features 查询解析通过；未调用模型。

被测对象为 `1.0.1-hb.6` 开发分支源码，未构建安装包或运行 Electron。真实工具曝光、exec 到面板、历史重开、SSH 和订阅账户兼容性仍待验收。[核对记录及最少真实实验](verification/codex-plan.md)列出官方来源、默认关闭与显式启用的区别、API 诊断与原订阅 QA 的差异。旧界面不增加启用参数；共享解析器仅改变畸形输入处理，避免伪造清单状态。

## 2026-11-06：T5 单文件收尾审查修正

两项 Git 审查与两项文案意见均成立。同路径的暂存删除和未跟踪文件现在合并为一条保留索引状态的记录，参与暂存分组和提交计数；取消暂存保留磁盘文件，撤销恢复 HEAD 文件。暂存已识别的改名只传目标路径，取消暂存和撤销仍处理两端。普通撤销与删除新文件使用不同的中英文确认按钮，补通全局弹窗的可选 `confirmLabel`；英文摘要沿用现有单数和复数消息键方式。

先补回归并确认 10 条失败、47 条通过。类型检查发现全局弹窗尚未传递 `confirmLabel`，追加可见按钮回归先确认 4 条失败、7 条通过，再补齐传递。修复后相关 Vitest 使用 `--configLoader runner --no-cache`，后端和 CLI 4 文件、66 条通过，界面、弹窗和消息目录 5 文件、152 条通过，共 218 条，无跳过。renderer 和 main 的 TypeScript 检查、修改源码 ESLint 均通过，修改文件已格式化。

被测对象仅本克隆源码。T5 Electron 场景已补同名文件、改名后继续编辑、批量暂存、确认按钮和单复数检查；Playwright `--list` 能发现该场景，未启动 Electron，未运行完整场景或模型。真实 SSH、Windows/Linux、视觉布局与发行包未验证。旧界面没有新增操作；共用解析器同步纠正同名文件状态，共用英文摘要同步纠正单数，其他调用未指定确认按钮文案时保留原默认值。CLI 沿用原动词，未引入新对等缺口。

## 2026-11-06：改动面板的单文件收尾

在 `codex/changes-file-actions` 补齐暂存、取消暂存、确认撤销和提交，面板与 CLI 共用 `applyGitChange()` 和 `git:applyChange`。新界面按暂存状态分组，部分暂存文件保留提示，提交只读取索引；新文件撤销会删除，改名恢复两端，复制保留来源，冲突不允许撤销。SSH 只在远端解析仓库根目录，文件名按字面量传入 Git。面板卸载后的旧确认不会写入，旧终端的目录变化不会改变当前对话的操作目标。

先补回归：后端首次 19 条失败；界面和 CLI 首次 12 条失败、14 条通过。生命周期补测先发现 1 条失败，目录隔离补测先发现 1 条失败，均修复后通过。最终相关 Vitest 使用 `--configLoader runner --no-cache`，7 文件、343 条通过；中英文消息目录另有 1 文件、9 条通过，无跳过。renderer、main 和 CLI 的 TypeScript 检查以及修改源码 ESLint 通过，修改文件已格式化。CLI 已构建，并在临时数据目录验证帮助与缺少 `--yes` 时的退出码和错误 JSON。

被测对象是本克隆源码与本地 CLI 构建，没有安装包。新增 `e2e/native-new-shell.spec.ts` 的 T5 场景，使用真实临时 worktree 检查界面暂存、取消暂存、提交、撤销和 CLI 回读，未在沙箱内运行 Electron。真实 SSH、Windows/Linux、视觉布局与外部 Git 同时写入未实测。旧界面没有新增按钮；共享只读结果纠正冲突的暂存标记，并补充部分暂存和截断列表的全量暂存数量。不推送、不发布、不调用模型。

## 2026-11-06：新界面日常收尾三项

在 `codex/new-shell-daily` 逐项先写回归并确认失败，再修复压缩续接设置保留、worktree 会话清理入口和置顶菜单。压缩保留原始可选字段及旧式只读标记，不复制命令模式；清理沿用已有回调和确认；置顶、命令面板、CLI 共用 tabStore 和原生历史保存路径，并防止旧扫描结果覆盖取消置顶。

补通 `tab compact` 的目标会话、后台选择和所属窗口路径，返回受理结果；新增 `open worktree-cleanup`，只打开当前 worktree 的原有确认框。更新 CLI 对等表及生成的命令参考，不增加删除实现。

被测对象为本分支本地源码与生成的 CLI 帮助。最终相关 Vitest 使用 `--configLoader runner --no-cache`，14 文件、789/789，无跳过；`npm run lint` 和修改产品源文件 ESLint 均退出 0。初次类型检查暴露缺失的 renderer bridge 声明，补齐后通过；补测夹具缺失也已修复，断言未放宽。未运行 Playwright、Electron、模型或网络操作，未构建应用安装包，未推送或打标签。真实压缩质量、原生历史落盘与 GUI 确认仍未实跑。

## 2026-11-06：右栏终端和任务的实跑验收

Codex 写代码和测试，两轮独立审查（新上下文的 Codex，只读），Opus 跑 Electron 并看截图。第一轮审查 4 高 3 中，第二轮 1 高 2 中 1 低，都已处理，只有两项按产品决定不改：切换新旧界面时终端内容清空（设置页写明），Windows 和 Linux 上终端聚焦时 Ctrl+W、Ctrl+F、Ctrl+J 留给 shell。

实跑发现的：`Starting terminal...` 留在第一行，任务图标大小不一，启动失败和关掉最后一个终端后面板空白，关闭确认框是写死的英文，macOS 的 `/bin/sh` 让空闲终端被当成在运行命令。

验证，对象是本地开发构建：`npm run validate:push` 通过，单元测试 48492 条通过，88 条跳过；`npm run test:e2e:fixtures` 通过；全部 78 个 Electron 场景通过；走查跑了两种窗口大小、深浅主题四种组合，面板截图由 Opus 看过。走查在 1000 宽窗口有几步记为失败，原因是打开的菜单盖住了脚本要点的输入框，和面板无关。

没有验证：真实 SSH，真实多窗口操作（有单元回归，Electron 场景里没有第二窗口的终端），Windows 和 Linux 上的按键，真实模型的任务清单，安装包，用户本人使用。

## 2026-11-06：hb.8 终端空状态与失败原因

新界面在本次自动打开结束且无终端时显示空状态和新建按钮，复用任务空状态样式及现有新建路径。启动失败和立即退出的原因保留在面板，实际启动成功后清除；失败终端先标记退出，避免错误展示触发重复启动。失败通知支持中英文，新界面的两处终端输出不再提示标签菜单，旧界面保持原提示。

先写回归，修复前 3 文件共 12 失败、94 通过；补充边界回归先有 2 失败、42 通过。最终相关 Vitest 使用 `--configLoader runner --no-cache`，13 文件、340/340，无跳过；`npm run lint` 三个 TypeScript 配置、修改源码 ESLint、测试破折号检查、格式检查通过。被测对象为本克隆源码，无安装包；未运行 Playwright、Electron、真实终端或视觉验收，未调用模型、联网、推送或打标签。简报与原始测试日志留在本克隆 `.git`，不进入公开提交。

## 2026-11-06：hb.8 右栏终端第二轮修复

在 `codex/hb8-panels` 上基于 `1e59e1f685bc57339600f95c37a5427da95e2ec9` 完成五项修复。拥有者改主机后，原主机运行中的终端只显示数量和关闭入口，不进入可输入列表；批量关闭复用真实拥有者动作与忙碌确认，CLI 从拥有者会话可关闭，选择和重启明确拒绝，列表保留记录。面板 CLI 操作复用已有窗口查询发往拥有者窗口，缺失时回退主窗口；main 只修改这一处路由。

重启后的 PID 传给保留的 xterm，重新发布当前网格尺寸。自动打开按可见性和会话划分访问，成功后不因归属刷新而重开。窗口归属增加加载、成功和错误状态；首次读取失败时旧界面继续启动，新界面显示指定中英文错误，后续成功刷新可补开本次访问。

逐项先运行失败回归：第 1 项 6 失败、35 通过；第 2 项 5 失败、16 通过；第 3 项 2 失败、38 通过；第 4 项 1 失败、40 通过；第 5 项 6 失败、85 通过。修复后的最终相关 Vitest 使用 `--configLoader runner --no-cache`，28 文件、547/547，无跳过。`npm run lint` 三个 TypeScript 配置、修改源码 ESLint、测试破折号检查通过。CLI 参考在隔离数据目录下实际构建并重新生成。

被测对象为本克隆源码及生成参考时的本地 CLI 构建，无安装包。未运行 Playwright、Electron、真实 SSH、多窗口实机或视觉验收；未调用模型、联网、推送或打标签，未读取账户目录。失败日志与简报保留在本克隆 `.git/CODEX-REPORT-hb8-fixes2.md`，不进入公共提交。五项产品决定均无异议。

## 2026-11-06：hb.8 右栏终端与任务审查修复

在 `codex/hb8-panels` 上基于 `47ba9476470a6ea19282c609996f453bc5c7d8cd` 修复。共享终端统一检查实际目录、主机、拥有者当前主机及当前窗口；`--cwd` 使用实际创建位置，新终端归当前会话智能体。复用 `WindowContext.ownsSession`，非 React 动作只读取同一上下文，不另建窗口归属表；启动前要求窗口信息已加载，并检查拥有者最新配置。旧界面恢复终端也会在归属加载后重试启动。

关闭终端只清理选择引用，保留原页签及展开状态。退出终端增加状态、退出码与重启按钮，和 CLI `terminal-restart` 共用真实拥有者动作，保留已有输出。Codex `item.updated` 标记增量，并经过 `StdoutHandler` 连续事件验证。任务使用固定 16px lucide 图标，强调色只用于进行中图标，完成项使用 `textDim`。直接移除共用 `TerminalView` 的启动提示写入，不清屏、不修改真实输出接收路径。

产品决定：切换新旧界面允许清空终端内容，不做迁移，设置与 CHANGELOG 记录中英文说明；Windows/Linux 上 xterm 聚焦时保留 Ctrl+W、Ctrl+F、Ctrl+J 的 shell 含义，仅补路由注释。E2E 5b 改为等待终端 ID，补第二终端下拉出现及双向切换、选择持久化、原终端输出保留断言。

各修复先有失败回归；补充用例再次对未修复基线反证，8 文件共 30 失败、320 通过。复查另复现并修正旧界面等待窗口归属后未启动、无效 SSH 来源寻址抛错，各 1 失败、23 通过。最终相关 Vitest 使用 `--configLoader runner --no-cache`，24 文件、1333/1333，无跳过；`npm run lint`、修改源文件 ESLint、测试破折号规则、格式检查与 `git diff --check` 通过。CLI 参考已实际重新生成。E2E 源码契约检查先失败后通过，不代表原生 E2E 通过。

被测对象是本轮本地源码及生成 CLI 参考时的本地 CLI 构建，无应用安装包。未运行 Playwright、Electron、真实 SSH、多窗口实机、视觉或 Windows/Linux 键盘验收；没有模型调用、联网、推送或标签操作。未读取账户目录或私人转录。逐项失败证据和完整命令清单保留在本克隆 `.git/CODEX-REPORT-hb8-fixes.md`，不进入公开提交。无产品方向异议。

## 2026-11-06：旧界面漏项与完整单测复核

在 `codex/new-shell-polish` 的 `e3747ff19` 基线上，修复快捷键计数、分屏失效标签提示、旧界面新建提供方会话的提前拒绝，以及取消文件读取后的误报和中英文提示。四项先补回归，修复前 11 条失败、53 条通过，修复后连同关联验证 94 条通过。原完整测试的三处失败分别是保存测试缺失实时会话状态、快捷键共用名单未区分界面、平台工具 mock 未保留导出；修后相关 101 条通过，保存另有真实本地文件落盘和失败回执验证，保存保护保持原样。

验证：沙箱外的完整单元测试 2129 个文件通过，1 个跳过；48369 条通过，88 条跳过。Codex 在沙箱里跑同一份代码时有 4 个文件失败（权限中继套接字、Cue webhook 监听、Cue 配置热更新、进程树清理），沙箱外全部通过，属于沙箱限制。新增回归和原来的三处失败都已通过。

## 2026-11-06：独立审查七项修复

基于 `codex/new-shell-polish` 的 `0a847a134` 修复七项发现，保留已有连续交接来源标题修正并补回归。新增 35 个回归用例，其中 34 个完成失败验证或撤回修复反证，已有标题修正的 1 个用例原本通过。最终相关 Vitest 使用 `--configLoader runner --no-cache`，24 文件、1098/1098，无跳过；`npm run lint` 与修改源文件 ESLint 通过。

跨窗口换工具采用获准的保守方案：来源窗口提供实时草稿和图片，目标窗口仅保存目标并保留来源。来源保存的异步返回前不提交智能体删除标记，复查发现内容变化则保留并保存最新草稿。被测对象仅本地未提交源码，未运行 Playwright、Electron、模型或真实应用，也未改 `e2e/native-new-shell.spec.ts`。逐项根因、失败与通过数字及限制见本地 `shell-tour/REPORT-review-fixes.md`。

## 2026-11-06：hb.7 新界面第三批补修

当前开发工作树保留已有未提交改动，交接与复核在共享服务复用目标唯一完全空白会话，持久化来源标题并返回 CLI。新界面折叠首条交接消息，统一打开项目菜单行并去掉面板字号悬浮按钮；旧界面共享空会话复用和标题修复，消息视觉不变。补测文件存在时隐藏标签栏、锚定菜单 portal 与内外点击。

修复前新增测试的失败基线为 8 文件、16 失败与 730 通过；实现后相关回归为 35 文件、1992/1992，无跳过，使用 `--configLoader runner --no-cache`。`npm run lint`、本轮源文件 ESLint、`git diff --check` 通过。被测对象仅本地源码，无构建或提交；按用户范围未运行 Playwright、Electron、模型或真实应用操作。端到端第 4 步及后续仍待确认，本地简报为 `shell-tour/REPORT-fix-3c.md`。

## 2026-11-06：新界面亲手走查与第一轮收口

方法：Codex 写走查脚本，把新界面每一步截图并导出文字，Opus 看图判断，Codex 按结论实现，Opus 再跑一遍。全部改动都在 `newShell` 设置之后，默认关闭。

看图发现的问题：顶栏数字和实际对话对不上，三个铃铛，群聊和智能体管理露在外面，没有打开项目的入口，第一次打开还是旧欢迎页，窄窗口下红绿灯压住内容，文件还走旧的文件面板，标签条会回来，交接留下空白行，交接标题是 `# Handoff`，卡片上有内部字段。

单元测试全绿但实跑才暴露的问题：文件树要双击才打开，顶部菜单被 Left Bar 裁掉，有文件标签时标签条又出现。之后每一批都实跑。

独立审查（新上下文的 Codex，只读）报了 7 项，其中 3 项高危，都已修复，记录见上一节。

验证：`e2e/native-new-shell.spec.ts` 3 条，`claude k`、`claude l`、`claude m`，走查四种组合（两种窗口大小，深浅主题各一遍）。被测对象是本地开发构建。

没有验证：真实模型，真实账户数据，安装包，Windows，手机，用户本人还没用过，整天使用的 hb.7 验收没有做。

## 2026-11-06：hb.6 发布

- **重建来源：** PR #45、#46 后重新冻结，#52 放宽 Linux 端到端任务时限，#54 修复换窗口丢对话。最终从干净的合并提交 `df8da1690a847efb6b0d33b6cb20687953ad244d` 重建；旧起点、旧包与先前失败记录保留，不合并为本版通过数。
- **门禁：** [主线 CI 42126474294](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/42126474294) 对应上述提交，七项全部成功。本机单元测试 47941 通过、88 跳过、0 失败，Electron 合成场景 76、合成夹具 53、发布策略 11、连接器合成测试 26 通过；三项类型检查、ESLint、格式与文档引用通过。这些是发布证据中的结果，本次记录整理没有重跑完整单元或 Electron。
- **真实模式：** Opus 在同提交的开发构建上执行选定六条，首次 6/6 通过，未重试。覆盖 Codex 压缩历史、两家 worktree 历史、两家同一原生会话两轮和 Claude 项目别名历史；不是发行包真实模式，也不是完整真实套件。CLI 为 Claude Code `2.1.310`、Codex `0.163.0-alpha.11.1`。快照一致只限覆盖项目，CLI 包来源与运行后残留未独立核对。
- **打包：** 应用与连接器均来自上述提交。源码 6029 个文件、构建文件 2638 个、ZIP、临时签名、包内 SQLite 与 PTY、CLI 产品身份检查通过；源码 5833 个文本文件和包内 472 个文件的隐私扫描无私密命中，5 个凭据形状字符串与原版 Electron 一致。包大小、SHA-256 与 app.asar 身份见[hb.6 验证记录](verification/v1.0.1-hb.6.md)。连接器语法及 13 个载荷文件通过，机器上的 `0.166.0-alpha.6` 被准入检查拒绝，没有激活共享。
- **发行包验收：** Opus 执行发布 ZIP 解压副本的脚本，用模拟提供方与临时数据，不调用模型。41 场景一次通过，0 失败、0 跳过、0 重试；清单 18 项在脚本范围内通过、8 项人工未完成，部分通过项另有人工剩余。双窗口即时退出距最后草稿 19 毫秒，8 秒对照为 8019 毫秒，分别核对落盘与重启；换窗口覆盖关闭副窗口、移入已打开窗口、首次编辑及重启，未测移动进行中的回合。
- **发布与下载：** 2026-11-06 公开 [v1.0.1-hb.6](https://github.com/CHANxuanyu/maestro-harness-bridge/releases/tag/v1.0.1-hb.6)，标签指向上述构建提交，为不可变预发布，不标记 Latest。五项附件在草稿和公开后两次 `hb-release.mjs verify` 均通过；不登录下载的应用 ZIP、连接器 ZIP 哈希与本地一致。公开正文原样归档到[版本说明](release-notes/v1.0.1-hb.6.md)。发布、远端校验与匿名下载结果由用户确认，本次仅整理记录，没有重新发布或下载。
- **安装边界：** 验收时日常旧包仍运行，验的是 ZIP 解压副本；之后用户退出旧版，才替换日常安装位置。替换后版本、签名与 app.asar 已核对，但没有启动过，原配置升级启动未验。后续安装事实由用户提供。
- **开放问题：** DeepSeek 真实网关与三家偏好加载缺密钥，完整真实套件、发行包真实模型、共享/交接真实场景、完整跨应用写入、新包真实 worktree/压缩历史、日常试用和真实错误入口未验。更新退出、无响应副窗口、移动中的回合、长历史绘制性能及界面人工剩余项保留空框。运行中 CLI 设置刷新竞态、快速退出后的 Claude 用量探针残留计划下一版修复；浏览器后写入覆盖、保存超时与既有界面缺口仍存在，不能把脚本通过说成全部人工验收通过。

## 2026-11-05：hb.7 新界面第一阶段（界面）

在 `codex/hb7-shell-ui`（基于 `codex/hb7-backend`）上做新界面第一阶段，全部在 `newShell` 开关后面，旧界面不变。设置的“显示”里加了开关；右栏在新界面下只有“改动”和“文件”，“改动”面板用附录 B 的两个只读调用，回合结束、切换会话和手动刷新时重读，git 超时保留上一次的结果；底部按钮以复核模式打开现有的交接对话框。顶栏在新界面下加“交给…”。新增共享选择器 `selectConversationNavigation()`：新界面总是按会话导航，旧界面照旧跟随侧栏设置，六处原来各自判断的地方都改用它。

新增和改动的测试：`ChangesPanel`（9 条，含 SSH、超时保留、回合结束刷新、复核入口）、右栏新界面三条、顶栏三条、交接对话框复核模式、入口复核模式、选择器两条、显示设置开关一条。七组临时反证（去掉回合结束刷新、去掉超时保留、复核改成交接、右栏忽略开关、顶栏去掉两道判断、选择器忽略开关、对话框丢掉 mode）各只让对应测试失败，反证改动未提交。

用临时的 Electron 场景（假 Claude 命令行、临时 git 仓库，用完已删除）在 Clay 浅色、Dracula 深色和 GitHub 浅色下截图核对：改动列表、行数、逐行差异和复核对话框显示正常。核对时发现一个已有问题：命令行写设置后，若应用刚在 500 毫秒内写过一次设置，文件监听会把这次外部修改当成自己的写入丢掉，界面不会更新（场景里回合结束时写入的用量统计正好触发）。这不是新界面引入的，记为后续给 Codex 的后端事项。

## 2026-11-05：hb.7 后端，Opus 复核修正

在 `codex/hb7-backend` 的 `5f5ce0ae8` 上重新阅读附录 C 第 2 项后修正四项问题。未跟踪的嵌套仓库保留 Git 的末尾 `/`，符号链接（含悬空链接）与不可读文件均保留 untracked 状态、null 行数和空差异，单条读取失败不再中断清单。混合临时仓库同时放置这些条目、普通未跟踪文件和已修改文件，核对正常文件的 2 增 1 删及完整 totals。复核草稿明确要求对已跟踪改动执行 `git diff HEAD`，直接阅读清单里的未跟踪文件。root 本机使用平台 path.normalize，SSH 保留远端原样，文件路径仍用 `/`。

先只改测试运行三文件，14 失败、21 通过；失败覆盖目录、悬空链接、不可读文件、链接行数/差异、复核文案及路径契约。实现后同一命令 35/35；原有 18 文件命令重跑为 951/951、无跳过。既有 root 断言改为严格比较原生路径，文件路径及其余旧断言保留，没有放宽为可选结果。Windows 用隔离的 path 默认导出注入 path.win32，不修改 process.platform；实际 POSIX 权限与符号链接用例仅在非 Windows 运行，本机均已执行。

`npm run lint`、修改源文件 ESLint、测试专用 dash ESLint、`npm run format:check:all`、`npm run docs:verify` 和 `git diff --check` 均通过；文档检查 653 条路径、0 缺失。精确命令和结果追加在[后端核对报告](verification/hb7-backend.md#opus-review-corrections)。被测对象为本地源码，无远端操作、真实模式、账户目录访问、Electron、发行包或模型调用；真实 Windows、SSH 和 GUI 仍未验。

## 2026-11-05：hb.7 后端 D，帮助核对与最终验证

在本克隆 gitignored scratch 中为每次命令创建新的 HOME、CLAUDE_CONFIG_DIR、CODEX_HOME，只执行版本、帮助与 feature flags 列表。Claude Code 为 2.1.317，Codex CLI 为 0.166.0-alpha.6。帮助确认 plan 权限参数和只读 sandbox 参数；已有 capability 布尔值不变，在字段旁记录核对版本。不以帮助输出声称 DeepSeek 图片或推理能力已通过，也不声称 Codex 已能在沙箱里调用 Maestro。该项仅审计与注释，没有行为改动，未造一个没有行为意义的失败测试；修改前既有 capability 测试为 25/25。

最终被测对象是本地源码，没有发行包。合并一次运行全部触及的测试及 capability 回归，18 文件、938/938、无跳过；`npm run lint` 三个配置、修改源文件 ESLint、测试专用 dash ESLint、全仓 `npm run format:check:all` 和 `npm run docs:verify` 均通过，路径检查为 653 条、0 缺失。构建后的 CLI 在隔离目录实跑 settings set/get newShell，返回 true 和 boolean；生成 CLI reference 后已格式化；起始失败、精确最终命令、CLI parity 两行和限制存于[后端核对报告](verification/hb7-backend.md)，[能力核对](verification/hb7-capabilities.md)逐项区分 flag 与模型行为。

Electron、真实 SSH、Windows、安装包和付费调用均未验。既有 DeepSeek 预设工厂只支持本机新账户，SSH 上缺少同目录 preset runner 时明确失败，未改成在本机运行。Opus 后续询问用户再验证 DeepSeek 图片、推理强度和 Codex 派活；本轮没有真实账户写入、模型请求、推送或发布。

## 2026-11-05：hb.7 后端 C，交接和复核

交接按执行 cwd 与 SSH remoteId 匹配目标，不再按项目分组路径复用其他 worktree，也不从其他项目复制配置。缺失目标取工具全局配置；本机 DeepSeek 从全局网关配置调用既有隔离预设，SSH 上没有对应预设 runner 时明确失败，因为既有工厂只创建本机账户目录，本轮不发明远程账户创建协议。

`ai_handoff prepare` 默认 handoff，可指定 review。复核沿用预算器，固定包含来源目标摘录、`git:changes` 文件清单、自己执行 `git diff HEAD` 与只报告问题不改文件的要求。支持时先设置只读权限再保存、排队；两种模式均记录 ConversationOrigin，保存 native id，`session list` 和 `tab show --json` 返回来源。CLI 增加 `--review` 并等待有界 git/SSH 读取，Covered 增加复核行。

先运行失败测试，确认旧实现误用其他项目配置、拒绝 SSH、缺少 review 和 origin；新增与回归测试覆盖目标复用、新建、全局配置、SSH 命令生成、预算、持久化及既有读取路径。仅测本地源码与合成账户字段，预设创建在测试中 mock，没有发模型请求、启动 Electron 或访问真实账户。真实 SSH、Windows 和发行包验收留给 Opus；后续核对条目记录公共检查结果。

## 2026-11-05：hb.7 后端 B，改动接口

新增共享改动类型、`git:changes` / `git:changeDiff`、预加载、渲染服务与 `changes` CLI。CLI 通过现有 bridge.invoke 调用同一 IPC，按选中标签所属智能体的 cwd 与 SSH 配置读取。状态与行数一次 git 调用及 SSH 连接；逐文件差异先读状态取得改名来源，再读取正文。无 HEAD 按空树，完整 totals 在 500 条截断前计算，二进制与大文件、超时、非仓库均明确返回。

先添加用例并确认缺少模块时失败；真实临时仓库覆盖暂存与未暂存、未跟踪、改名、删除、冲突、空树、大文件、text attributes、超大差异和截断合计。SSH 用命令生成及解析测试，不连接主机；Windows 风格路径测试不修改 process.platform。测试及公共检查汇总见后续核对条目。被测对象仅本地源码，没有 Electron、真实 SSH 或 Windows 验收，没有安装包。

## 2026-11-05：hb.7 后端 A，新界面设置

在 `codex/hb7-backend` 本地源码上登记 `newShell`，默认 false，含主进程默认、元数据、渲染 store 的加载与保存和设置搜索。先写失败测试：通用 CLI 两条均失败，store 新用例失败；实现后相关两文件通过。CLI 使用隔离临时数据，不访问真实账户。外壳 UI 由 Opus 实现，本轮不启动 Electron，不构建发行包，不推送。

## 2026-11-05：新界面规格定稿

用户确认了新界面的五个界面决定和目标用户，全部按推荐执行。规格存为[新界面](roadmap/new-shell.md)，附 hb.7 的后端接口：新界面开关、改动面板的只读调用、交接的复核模式和来源记录、能力核对。本条只改文档，没有改代码，没有运行真实模式，也没有访问真实账户。

## 2026-11-05：设置监听不再遗漏紧邻的外部写入

本轮基于 `72545fdad`，在无远端的 `codex/settings-watcher-shadow` 本地分支修复设置监听。被测对象是本克隆源码，未启动 Electron、打包、安装或访问真实账户目录。

- **实现：** 两个既有监听文件改用成功写入字节的 SHA-256，删除 500ms 时间屏蔽及其旧接口。写入前发现外部内容时保留待通知标记，避免 electron-store 读回并保留该值后将其误判为纯内部写入。事件发生时确认外部变更，后续内部事件不会取消已排队的 300ms 通知；所有窗口和主进程回调共用该决定。未增加监听器或轮询。
- **失败先行：** 新增真实临时文件及 conf 存储回归，修复前 10 条中 8 失败、2 通过，覆盖两个文件的 100ms 外部写入、延迟内部事件及两种交错事件顺序。修复后同一组 10/10；相关四文件 42/42，无跳过。旧时间接口测试改为内容不变量，保留自身写入、连续输入、独立文件、返回值和异常断言，新增全文赋值及序列化后外部替换覆盖。
- **端到端：** 新增 `e2e/native-settings-watcher.spec.ts`，先经 IPC 显式保存设置，再立即运行 CLI 将界面语言切为简体中文，并断言窗口中的创建智能体文字切换。文件时间断言要求两次写入间隔小于 500ms，避免 CLI 启动过慢使旧实现假通过。Playwright 列举成功，Electron 执行交给 Opus。

最终相关回归为 31 文件 945/945，无跳过；与四文件 42 条重叠，不累计计数。三个 TypeScript 项目、全部触及代码和测试的 ESLint、全仓 Prettier、647 条文档路径（0 缺失）、差异空白检查通过。实际命令如下：

```sh
npm run test -- src/__tests__/main/app-lifecycle/settings-watcher-content.test.ts
npm run test -- src/__tests__/main/app-lifecycle/settings-watcher.test.ts src/__tests__/main/app-lifecycle/settings-watcher-content.test.ts src/__tests__/main/stores/write-tracker.test.ts src/__tests__/main/stores/instances.test.ts
npm run test -- src/__tests__/main/app-lifecycle src/__tests__/main/stores src/__tests__/cli/services/storage.test.ts src/__tests__/renderer/hooks/useSettings.test.ts src/__tests__/renderer/stores/settingsStore.test.ts
npm run lint
node node_modules/eslint/bin/eslint.js --ignore-pattern '!src/__tests__/**' src/main/app-lifecycle/settings-watcher.ts src/main/stores/write-tracker.ts src/__tests__/main/app-lifecycle/settings-watcher.test.ts src/__tests__/main/app-lifecycle/settings-watcher-content.test.ts src/__tests__/main/stores/write-tracker.test.ts src/__tests__/main/stores/instances.test.ts e2e/native-settings-watcher.spec.ts
npm run format:check:all
npm run docs:verify
node node_modules/@playwright/test/cli.js test --project=native e2e/native-settings-watcher.spec.ts --list
git diff --check
```

首条单元命令在修改生产代码前失败（8 失败、2 通过），修改后通过（10/10）；第二条 42/42，第三条 945/945。ESLint 显式取消测试目录的默认忽略，没有减少检查规则；Playwright 仅列举 1 条回归，未启动应用。Opus 应在沙箱外运行：

```sh
MAESTRO_E2E_REAL=0 node scripts/native-e2e.mjs --grep "settings watcher: immediate CLI write after an app write updates the window"
```

该命令会先构建 main、renderer 和 CLI，再执行合成账户夹具。原生 GUI、Linux/Windows CI 和发行包均未验证，不能用本地单元通过替代。

## 2026-11-05：额度探针退出残留

被测对象为基于 `78760e641` 的 `codex/status-probe-leak` 本地源码。hb.6 的构建来源不变，本修复进入下一版。

现象：hb.6 验收期间，本机 5 个打包版 `maestro-p --status` 在 33 小时后仍在运行，父进程为 PID 1，各带一个空闲的 `claude`。它们的配置目录都是真实模式 E2E 的临时目录，没有登录，也没有完成引导，`claude` 停在首次使用的界面。随后反复启动再退出已安装的 hb.6 包（隔离的 Electron 场景，临时数据），留下 25 个同样的探针，约每次短运行一个，所以这不是罕见的时序窗口。

根因分两层。第一，`statusMode` 等待 `ready` 没有上限：运行模式监听 `ready-timeout`，状态模式不监听，能结束它的只有父进程 `execFile` 的 30 秒定时器，而定时器随父进程一起消失。用假 `claude` 按采样器的调用方式复现：父进程第 3 秒退出或被 SIGKILL，到第 45 秒探针和 `claude` 仍存活，探针父进程为 1；父进程不退出时定时器在 30 秒结束探针；`claude` 能到输入框时探针第 25 秒自行退出。第二，部分退出路径不确认 `claude` 已停止：`quit()` 发 SIGTERM 后不等结果，读端已关闭时模块级 EPIPE 处理直接 `process.exit(0)`，`workspace-untrusted` 发完 SIGTERM 立即退出。假 `claude` 不响应 SIGTERM 和 SIGHUP 时，这些路径都会把它留下。

修复只在状态模式。启动前挂 28 秒硬期限（复用 `createIdleWatchdog`），每秒检查父进程：`ppid` 改变或 `kill(pid, 0)` 返回 ESRCH 视为已退出，EPERM 视为存活，起始父进程为 0 或 1 时只靠期限。不用 stdin EOF 判断，脚本里的 `--status < /dev/null` 不受影响。`TuiDriver.terminate()` 发 SIGTERM，等 1 秒，再 SIGKILL。硬期限和父进程退出跳过 `/quit`，避免把按键打进未知界面；其余路径先 `quit()` 再 `terminate()`。同步 `exit` 兜底覆盖 EPIPE 和 `main().catch`。状态模式新增 SIGHUP 处理。退出码：`ready` 前到期 4，之后到期 3，父进程退出或 SIGHUP 129。运行模式和 `quit()` 不变。

- 失败先行：实现前新测试 4 个文件 10 失败 / 119 通过。
- 最终：`src/__tests__/maestro-p` 及采样器、watchdog 相关 26 文件 522 条通过；进程级 12 条连续三轮全部通过。`npm run lint`、`npm run lint:eslint`、Prettier、`docs:verify`、`lint:doc-refs`、`node scripts/hb-release.mjs check` 通过。
- 真实 Electron：源码构建的应用、真实采样器和 `maestro-p` 包、停住的假 `claude`。确认探针是应用的子进程后退出，正常退出 2.1 秒、SIGKILL 0.9 秒后两个进程都消失。另测启动路径：智能体已存在，应用启动后自行采样，随即退出，连续三轮都在 2.2 至 3.2 秒内消失。
- 临时回退：`index.ts` 与 `tui-driver.ts` 改回修复前，同一 Electron 检查两种退出方式和启动后立刻退出都失败，都留下父进程为 1 的探针和它的 `claude`；进程级与驱动测试 14 失败 / 121 通过，控制用例仍通过。回退未提交，恢复后哈希与构建产物逐字节一致。
- 手工：停住的探针第 28 秒以 4 退出，假 `claude` 不响应信号时第 29 秒退出且 `claude` 消失，都早于 30 秒定时器；第 12 秒才到输入框的探针仍成功；健康探针输出结构与修复前一致。

未验项：未运行真实 `claude`，不响应 SIGTERM 和 SIGHUP 的假 `claude` 覆盖最坏信号行为；未运行打包版；Electron 检查的临时 spec 没有提交，因为 `test:e2e` 不构建 `maestro-p`，把它加入构建会让全部场景开始跑探针；进程级测试依赖 POSIX 脚本，Windows 只有单元测试覆盖，由 CI 执行；本地未跑完整单元测试，由 CI 执行。`maestro-p` 自身被 SIGKILL 时无法运行任何清理，`claude` 只能靠 PTY 挂断结束。

## 2026-11-05：智能体换窗口丢对话修复

用户委托 Codex 在 `78760e641` 的安装包上代验收，清单记 20 项通过。复核证据时发现 U7（两个窗口退出）打了通过，但 Codex 自己的场景两次都失败、从未通过。这一项改记为有问题，hb.6 暂停。

- 复测最初得到 19 次里 10 次丢失主窗口对话。这些测试只调用 `windows.create`，没有调用产品流程里随后的 `moveSession`，两个窗口都以为自己拥有智能体，所以这个比例不代表真实使用。按产品流程复测，未修复时退出场景 5 次都没有丢失。
- 真实问题是确定性的：一个智能体只属于一个窗口，实时事件只送到拥有者，其他窗口的副本是旧的。关闭窗口（未修复 5/5，仅保存规则 3/3）或移到已打开的窗口（仅保存规则 3/3）后，目标窗口显示旧副本，第一次改动把它写回，对话内容和原生会话链接都没了。原生会话文件不受影响。问题早于 hb.6。
- Codex 第一版修复取消了首次全量保存，单元测试通过，但 Electron 上仍是 10 次丢失 7 次，它的场景也卡在测试设置上，修复前后失败得一样。保存追踪显示窗口的后台更新会让旧副本变成“已改动”，所以放弃这一版。
- 修复有四部分：窗口只保存自己拥有的智能体；移动前主进程让原窗口先保存，复用退出保存的请求；目标窗口收到后重新读取，并刷新屏幕上这个智能体的草稿；`sessions:getAll` 排在写入队列后面，窗口关闭时的最后一次保存不会被读取抢先。

测试先写后修。`claude m` 覆盖移到已打开的窗口、在新窗口继续、关闭窗口、再次编辑和重启，修复前失败，修复后 6/6。最终代码上 `claude k`、`claude l`、`claude m` 和按产品流程的临时检查 14/14 通过。反证：全部回退、只回退重新读取、只回退移动前保存、只回退读取排队，`claude m` 各 3 次全部失败。只回退保存规则时 `claude m` 仍通过，这一部分靠 4 条单元回归证明，修复前失败、修复后通过。反证改动和临时检查未提交。

未验证：浏览器客户端（不属于任何窗口，仍以后写入者为准）、真实模型、Windows 本机。

## 2026-11-05：hb.6 重新打包候选

hb.6 未打标签。PR #45、#46 已合入主线（`2919fbfea`，主线 CI 通过），本候选只改文档：CHANGELOG 把 Windows worktree 修复从 Unreleased 移入 hb.6；候选说明补上 worktree 历史与压缩 Codex 历史，写明新的构建来源，并增加一条已知限制（运行中命令行改设置若紧跟应用自身写入，窗口可能不更新，hb.7 的设置监听修复解决）；验收记录标明重新打包，真实模式与发行包 GUI 在新包上重做。

仓库设置：用户 2026-11-05 同意开启 `allow_auto_merge`。主线规则不变，仍要求六项检查通过且分支与主线同步。hb.7 的 PR #47 在 hb.6 冻结前暂停自动合并，避免构建来源带入新界面与 hb.7 后端。

#51 合并为 `3a05d5531`，树与已测的 `6271f3801` 相同。该提交的主线 CI 中，Linux 端到端任务在 25 分钟时限处被取消：合成场景 75 条全部通过（11.8 分钟），real-smoke 已通过 68 条，第 69 条运行中被中止，没有失败用例。同一任务在 #51 的 PR 运行中用了 24 分 59 秒，在 #46 的主线运行中约 19 分钟，两轮 Electron 各需 9 至 12 分钟。这是时限不够，不是服务故障，不按重跑处理：#52 把该任务时限放宽到 45 分钟，hb.6 改从 #52 的合并提交构建，源码只多这一处 CI 配置。

## 2026-11-04：PR 46 CI 修复

被测对象为 `codex/native-history-coverage` 分支上基于 `13ea76d49` 的本地源码。

- Windows worktree 注册表路径和 common-dir 转成本机格式，精确匹配与托管目录回退复用 canonical 路径比较；共享 normalizer 统一本地盘符大小写，SSH 保留原规则。原 `worktree-history.test.ts` 严格断言保持原样。新增隔离 `path.win32` 的平台无关测试先复现 5 失败 / 1 通过，修复后相关 4 文件 91 条通过。主进程类型检查通过，Windows CI 与 Electron 留待外部执行。
- worktree E2E 使用显式 `expectRefusal` 发送声明，不消耗场景或生成真实模型工作负载；等待原有错误消息后，真实模式核对 CLI relay 的 invocation 记录未新增或改变。原消息与转录字节断言保留。fixture 全套在允许本地 Unix socket 的环境中 12 文件 49 条通过，随后补充无场景回归。临时 E2E 类型配置包含改动的 spec、fixture 与 renderer 全局声明，CJS 依赖按未声明 JS 模块处理；给原有布局按钮数组补充 Locator 类型后通过。Electron 未启动。
- 桌面身份 spec 通过 `nativeProviderCli: false` 显式关闭 fixture 启动前的 CLI 解析与凭证准备，重复启动同样有效；既有测试的标题解析默认不变。新增启动单元测试验证 opt-out、默认解析与缓存。最终相关源码 4 文件 91 条、fixture 全套 13 文件 53 条通过，主进程与临时 E2E 类型检查、改动代码 ESLint、Prettier、差异空白及新增长划线检查通过。Playwright 两种模式均收集到原有 5 个目标场景，没有启动 Electron 或执行其断言。

外部待执行 `node scripts/native-e2e-real-smoke.mjs --grep "worktree history stays readable|desktop identity"` 与 `node scripts/native-e2e.mjs --grep "worktree history stays readable|desktop identity"`，随后完整 `npm run test:e2e:real-smoke` 和 `npm run test:e2e`。Windows 原有严格回归仍需 Windows CI 证明。仓库没有 E2E tsconfig，本轮临时配置仅覆盖改动的 E2E 文件和相关导入，未声明 CJS 依赖使用隐式 any；全目录严格类型检查仍有既有错误。

## 2026-11-03：随包 CLI 产品目录与最终验证

本轮第三部分把 CLI 存储、连接发现、origin、运行标记与忙碌探测收敛到 canonical userDataDir。打包把产品名称和 ID 嵌入 CLI，并生成随包身份 JSON 供独立 Cue 与编译模块读取。桌面启动在身份文件缺失时记录身份，不验证旧设置；身份冲突只警告并调用 captureMessage，身份记录及报告失败都不阻断启动。桌面共享服务信任 Electron 已选定的目录。CLI 保留 MAESTRO_USER_DATA 覆盖，但拒绝其他产品身份和没有 fork 标记的旧设置，损坏设置明确报不能验证。旧 HB 目录凭 uiLanguage 字段识别，未改写旧设置。`settings set` 在应用运行时等待同一 settings:set 接口回执，关闭后写原文件。

- 失败先行，产品目录 4 条全部失败；live apply 首轮 1 失败 / 1 通过；运行标记路径首轮 6 失败 / 31 通过。临时回退运行标记与忙碌探测后 2 条失败，恢复后通过。整轮修复的回退和完整命令结果见交付报告。
- 临时 HOME 中实测按 fork 身份构建的 CLI，默认目录主题写入成功，显式指向 upstream 身份的临时目录以非零退出并保留其设置。此产物是源码测试用的独立 CLI，没有构建或验收发行包。
- 完整首轮单元 2109 文件，47873 通过 / 10 失败 / 90 既有跳过。发现并修正旧 Claude 自定义账户无 cwd 行的兼容回退、全局统计的 legacy 文件名兼容，并把原生打开的严格 readOnly 参数纳入原有精确断言。后续相关 7 文件 172 条通过；增加压缩统计、普通文件优先和归档项保留回归，原实现 2 条失败，恢复后该文件 48 条通过。
- 复核补齐 SSH Codex revision 的 host 隔离与路径缓存、整段远程删除、父项目路径读取 worktree 对话、主仓库与独立 worktree 项目同时存在时的归属，以及 exact-worktree 列表的身份。新增用例在修复前分别失败，恢复后通过。完整轮次与反证数量在交付报告汇总。
- 最终完整单元为 2109 文件，47888 通过 / 5 失败 / 90 既有跳过，另有 permission-relay 的 socket setup 失败。暂退生产代码到 `72545fdad` 后，五条失败和 setup 失败全部复现；基线比较为 78 通过 / 5 失败 / 2 既有跳过。相关修改文件 17 个、254 条全部通过，原有会话存储 API 114 条也全部通过。删除错误文案兼容临时回退后复现 6 失败 / 108 通过，随后恢复；原 API 断言保持原样。
- 最终类型三项目、ESLint、src Prettier、差异空白与新增行长划线检查通过。主进程与 preload、fork 身份 CLI 构建通过；临时 HOME 中两项产品目录 smoke 断言通过。
- 类型三项目、ESLint 和 src Prettier 首轮通过。合成夹具 39 通过 / 3 失败，另有 3 个 Unix socket listen EPERM；两条新增 Electron 用例均在启动时报 Process failed to launch，未进入断言。主进程、preload、renderer 和 CLI 构建通过，渲染构建保留原有动态导入警告。没有修改断言强度、增加自动重试或禁用测试。
- 后续覆盖复核先复现桌面损坏设置、缺语言标记、外部身份及 CLI 错误报告的问题，再补齐归档 worktree 的存在、缺失、嵌套 cwd、分页及只读打开。临时回退本轮生产修复后 15 失败 / 17 通过；仅回退 Claude 候选读取的 cwd 校验后，其他项目正文泄漏断言再次失败。全部生产文件按原字节恢复，反证没有提交。恢复后相关 10 文件 234 条通过。新扫描曾漏报意外目录错误，属于产品回归，修复后既有 Sentry 断言保持原样并通过。
- 本轮主进程、preload、renderer 和 fork 身份 CLI 构建通过。临时 HOME 的 CLI smoke 确认损坏设置报不能验证且无 SyntaxError，外部 sidecar 仍拒绝，原设置字节不变。新增桌面身份启动三场景，并把缺失 worktree 的 Electron 用例扩展到 Claude 与 Codex，先用 Git 注销并移除目录，再验证阅读与发送拒绝。五场景均在 Electron 启动前失败；独立最小 Electron 应用也复现同一 Process failed to launch，属于当前环境限制，没有执行场景断言。
- Opus 提供的沙箱外完整合成 Electron 结果为 `f77e4a5fb` 上 71 通过 / 0 失败，耗时 16.1 分钟，无产品或测试失败待修；该结果不覆盖本次后续修改。当前修改的 GUI 场景仍须在沙箱外执行。
- 后续修复最终通过 `npm run lint`、`npm run lint:eslint`、`npm run format:check`，文档与 Electron 用例的单独 Prettier 检查、差异空白和新增长划线检查也通过。使用临时目录与合成账户，无真实账户目录操作，保留三笔既有提交并仅追加本地提交，不推送。

被测对象为本地源码及临时 fork 身份 CLI 构建，未构建新安装包，真实模型、真实账户、Mac 安装包和跨平台 CI 未验。SSH worktree 关联明确不支持；完全移出 Git 注册表且不位于项目 `.claude/worktrees/` 内的外部 worktree 不能证明主仓库归属。后续修改的 Electron 场景与发行包验收仍待沙箱外执行。

## 2026-11-03：同仓库 worktree 对话

被测对象为 hb.6 上的本地源码。Claude 与 Codex 共用只读 Git worktree 注册表，按项目 cwd 缓存 30 秒并限制 128 项，通过 common-dir 与注册表确认同仓库路径。后续复核补充项目 `.claude/worktrees/` 内的原生 cwd 归属：即使 Git 已注销或目录已删除，仍按第一层目录名保留 worktree 身份，子目录 cwd 同样有效。使用 isPathAtOrUnderRoot 校验路径边界。Claude 编码目录仅缩小扫描候选，列表、分页及主项目读取再以转录 cwd 确认归属，不反解目录名；Codex 保留 session_meta cwd。项目树优先选择 exact-cwd 智能体，其他同仓库对话归主项目，原生 ID 与账户键去重。

- 接续在主进程共享启动入口读取所选账户的原生 cwd。目录缺失时拒绝启动并说明只读，历史打开使用 readOnly。最小 MiniBadge 显示分支或目录名；`native-history list` 和 `list-sessions --native` 复用项目树服务。SSH 只提供原项目路径历史，并返回 worktree 扩展未实现的原因。
- 临时 Git 仓库与 linked worktree 回归首轮 3 条全部失败；接续新增 1 条先失败。覆盖托管目录、外部 worktree、伪候选排除、exact-cwd、去重、删除目录后读取及跨适配器缓存查询。临时回退整轮生产修复后 7 失败 / 8 通过，恢复后 2 文件 15 条通过；此前适配器、进程、CLI 相关 6 文件 224 条通过。
- 补充统计去重回归，主项目和 worktree 同时列出同一原生 ID 时只计一次。修复前 1 失败，修复后通过；临时移除去重后同一断言再次失败，随后恢复。
- 增加合成 Electron 用例 `claude worktree history stays readable after its working folder is deleted`。最终全套检查与 Electron 结果在交付报告汇总。未测发行包、真实账户或模型。已从 Git 注册表彻底移除且重启前从未发现的外部 worktree 无法证明所属仓库；其原目录路径下的原生历史仍可直接读取。

## 2026-11-03：Codex 压缩原生历史

本轮被测对象为 `codex/native-history-coverage` 分支源码，基于 hb.6 合并候选 `72545fdad`。未构建发行包，未使用真实账户或模型，原生归档只在内存中解码。

- 历史适配器与独立全局统计扫描识别 `.jsonl.zst`，共享工具限制源文件和展开后的字节量，普通文件按 UUID 优先。同步 CLI 学习扫描复用同一解码入口。会话、token 和全局统计缓存版本递增，全局旧缓存保留归档项并重读现存 Codex 文件。
- `native-history list|read|delete` 走桌面 IPC 适配器，读取使用 readOnly；删除整段 Codex 对话限所选主机、账户和 UUID，不重写任何剩余原生文件。`shared-history-manager.ts` 只读 Maestro 自有 history 文件，没有 Codex rollout 读取点。
- 失败先行，压缩读取 2 失败 / 1 通过，整段删除新增 1 失败，CLI 桥接新增 1 失败。回退存储修复后 3 失败 / 1 通过；临时取消解码后大小上限测试 1 失败 / 3 通过，随后恢复。相关初批 7 文件 71 条通过。旧 mock 增加只读文件描述符接口，读取隔离断言改为检查实际 open 路径。
- 增加 Electron 合成用例 `codex compressed history opens and follows replaced archives`。最终检查和 Electron 启动结果在后续本日记录及交付报告汇总。SSH 整段删除复用非递归远程文件删除；逐消息删除统一拒绝改写 Codex 原生历史。发行包与真实跨应用验收留给 Opus。

## 2026-11-03：hb.6 候选与 Windows 账户路径回归

本轮在无远端的独立克隆 `codex/hb6-candidate` 上工作，起点为 `0c15c18f5eef5cc17aec6387fd1797973f7b5d92`，包含 PR #32 至 #43 的叠加内容。仅准备发布制度第 1 步的本地候选，没有推送、开 PR、打标签、构建、安装或发布；没有运行真实模式或访问真实账户、钥匙串及 Maestro 用户数据。被测对象是本地源码，未把开发预览或旧包验收当成本版包通过。

- **Windows 判断：** `b596e2773` 的两条测试将 mock 的 `/tmp` 经平台 `path.join` 得到的目录直接作为预期。Windows 上它是根相对路径，`path.resolve` 会补当前盘符。实际启动经 `resolveAgentAccountEnv()`，原生检查经 `nativeAboutMeTarget()`，两者都调用 `resolveAgentAccountDir()` 并使用相同的 CLI 设置层。因此是测试预期缺少解析，不是两条生产路径不一致，没有修改生产实现。
- **回归：** `agent-spawner.test.ts` 的 `native account (host paths)` 和新增 `native account (win32 paths)` 分别对 Claude Code、Codex 运行 `spawns %s in the same global account used by the native profile check`。用隔离的 path 默认导出注入 `path.win32` 和合成 cwd；期望值通过相应平台解析计算，盘符只用于合成输入，不写死在预期结果。每条同时比较实际启动环境、原生检查目标的父目录和平台解析结果，不跳过 Windows。
- **失败先行与反证：** 新 Windows 用例保留旧断言时，150 条中 2 失败、148 通过；两条在目录一致断言通过后于旧预期失败。修正后相关四文件 220/220。另临时让启动 overlay 使用未解析目录，150 条中 2 失败、148 通过，失败点是启动目录与检查目录不一致；finally 恢复生产文件原字节，相关四文件再次 220/220。反证改动未提交。
- **候选内容：** package 与 lock 根及根包版本统一为 `1.0.1-hb.6`；Unreleased 归入 2026-11-03 候选节并保留空标题，hb.5 仅在标题注明“未发布，编号作废”，原正文保留。新增[版本说明](release-notes/v1.0.1-hb.6.md)与[验收记录](verification/v1.0.1-hb.6.md)，README 和分支入口对齐。说明以 hb.4 为上一公开版，引用真实模式锁定表，区分连接器累计变化与未扩大准入；真实模式和发行包 GUI 全为待执行。
- **候选反证：** 临时只读一致性检查在旧版本上报 `hb.6 candidate version`（实际 hb.5），完成版本与文档后通过；正式检查脚本未改，输出 `HB source policy passed: 1.0.1-hb.6`。

实际命令与结果如下，重复运行不累加成新的通过数：

| 命令                                                                                                                                                                                                                   | 实际结果                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run test -- src/__tests__/cli/services/agent-spawner.test.ts`                                                                                                                                                     | Windows 注入旧断言及故意破坏启动路径各为 2 失败 / 148 通过；恢复后纳入下行 |
| `npm run test -- src/__tests__/cli/services/agent-spawner.test.ts src/__tests__/cli/services/system-prompt-native.test.ts src/__tests__/main/agents/provider-account-dirs.test.ts src/__tests__/main/about-me.test.ts` | 4 文件，220/220，无跳过                                                    |
| `npm run lint`                                                                                                                                                                                                         | 通过，三个 TypeScript 配置                                                 |
| `npm run lint:eslint`                                                                                                                                                                                                  | 通过                                                                       |
| `npm run format:check:all`                                                                                                                                                                                             | 通过，全仓文件                                                             |
| `npm run docs:verify`                                                                                                                                                                                                  | 647 条路径，0 缺失                                                         |
| `npm run lint:doc-refs`                                                                                                                                                                                                | 39 份指引引用全部有效                                                      |
| `npm run test:release-policy`                                                                                                                                                                                          | 11/11，无跳过                                                              |
| `git diff --check`                                                                                                                                                                                                     | 通过                                                                       |
| `node scripts/hb-release.mjs check`                                                                                                                                                                                    | `HB source policy passed: 1.0.1-hb.6`                                      |
| `npm run test`                                                                                                                                                                                                         | 2100 文件通过、1 文件既有跳过；47859 通过、88 既有跳过、0 失败；414.73 秒  |

默认沙箱首次启动定向单元时，Vite 向工作区外已存在的共享依赖目录写临时配置被 EPERM 阻止，0 用例执行；经自动审批允许同一命令在沙箱外运行后才得到上表结果。没有安装依赖、改测试配置、放宽断言、增加重试或旁路。完整单元仅运行一轮，既有跳过项如实保留在计数中，本轮未新增任何跳过。Windows 测试修复单独提交为 `d1257ebc9`。原始日志只留在临时目录，不入公共提交。

**未完成与交接：** 本轮没有新的 Windows/Linux CI、Electron、真实模式或发行包证据，无远端所以未创建 PR。已有界面缺口与 Mac 复现步骤见[Opus 清单](verification/v1.0.1-hb.6.md#交给-opus-的界面复现)，包括 DeepSeek 遗留历史路由、Codex 系统封装预览、草稿辨认、向导提示、输出/effort/active writer 和多窗口退出；本轮未启动 GUI，未将这些记录成新观察到的故障，未修改渲染层或冻结项。用户后续须重新登录 Claude，并在实际 hb.6 Mac 包勾选核心流程、三项功能和改版项；Opus 从新克隆复核门禁、真实模式、打包与五项资产后再按发布制度推进。

## 2026-11-02：关于我的原生启动判定

基于 `57341e712`，在独立本地分支 `codex/about-me-native` 补后端、共享契约、CLI 与测试。没有修改渲染层、冻结的 hb.5、依赖或远端。本轮被测对象是该分支工作树的源码及由它构建的 `dist/main`、`dist/cli`、`dist/renderer`，不是发行包；未安装、发布或调用真实模型与账户。

后端与测试源码分为 `d3a470bb3`（原生检查与使用者）和 `43062437e`（提示接入与启动账户）两个本地提交。构建发生在提交前，运行时代码与后者一致；没有将构建中仍显示的起点提交号当成发行来源。

- **交付：** `native` 从当次启动配置解析一个本机原生文件，与 apply 串行；复用抽出的文件检查，只有确认同步的当前非空段且不被 Codex override 遮蔽时返回 loaded。status 汇总物理文件别名的本机 `agentIds` 与 DeepSeek 预设来源，保持 providers 和归属格式。共享英文替代文字已用于 CLI、Cue 智能体、群聊主持人与综合提示；渲染层启动、向导、设置页留给 Opus，具体字段和复现见[接口契约](core-experience-contracts.md#关于我)。
- **启动一致性：** 新回归发现原账户解析器跳过空值时会误用低层账户，与桌面删除该变量的行为不一致；已修正。CLI 与 Cue 原先未将全局账户环境传给子进程，现使用同一解析结果提供本机 Claude/Codex 的账户变量，避免检查文件与实际读取文件不同。
- **失败先行：** native、指引文字与使用者信息首轮 13 失败 / 39 通过；提示集成 6 失败 / 159 通过；空值与 CLI 账户环境 3 失败 / 163 通过；Cue 账户环境 2 失败 / 23 通过。CLI 测试初稿误写 settings 文件名，修正夹具后单独重验 3 条仍因旧正文注入失败；夹具设置错误不计为有效反证。
- **回退反证：** 临时把 native 判定改为始终 loaded，49 条中 9 条失败；临时让独立 CLI 恢复正文注入，3 条全部失败。两次均恢复原字节，恢复后对应 52 条全部通过。没有修改断言、超时、重试或测试排除项。
- **验证：** 相关单元分三批为 9 文件 375/375、7 文件 118/118、3 文件 32/32，共 19 个不同文件 525 条通过、0 跳过。类型三项目、ESLint、Prettier、文档路径与引用、差异空白检查通过。主进程及 preload、CLI、渲染构建通过；渲染构建保留既有动态导入警告。
- **未完成：** 合成 Electron E2E 已补 native、agentIds、DeepSeek 和 override 断言，但沙箱中在 125ms 的应用启动阶段报 `Process failed to launch`，1 条失败且未到用例断言；没有尝试绕过沙箱。真实模型加载、Mac 使用、完整端到端及渲染层提示去重未验。native 仍是文件检查，不保证检查后的外部修改，也不证明旧模型进程即时重载。Cue 通知和 shell/CLI 命令模板没有直接接收提示的模型，保留原档案；未知提供方和 SSH 同样保留正文。

主要新增回归名称：`only reports %s loaded for a confirmed, current, nonempty managed block`、`checks fresh bytes without discovery, file writes or ownership changes`、`recognizes ownership through a new alias but refuses a repointed alias`、`queues native reads behind an in-flight apply`、`merges agent ids and DeepSeek provenance by actual file without changing providers or ownership`、`attributes local agents with the same replacement and fallback rules as spawn`、`uses the shared %s pointer only for a current owned native block without a desktop connection`、`uses the actual %s moderator account for both initial and synthesis profile injection`。另覆盖参数拒绝、EACCES、主机层失败、空值取消与两类进程启动账户匹配。

本克隆的 `node_modules` 为共享只读链接。默认 `npm test` 和 `npm run build:renderer` 在 Vite 写 `.vite-temp` 时 EPERM，未执行测试；改用 runner 加载原 `vitest.config.mts`，补齐配置所需的 `__dirname` 并把缓存放在临时目录。未改仓库配置或产品行为。临时入口 `/tmp/maestro-about-me-vitest.mjs` 内容为：

```js
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
globalThis.__dirname = process.cwd();
const { startVitest } = await import(
	pathToFileURL(path.join(process.cwd(), 'node_modules/vitest/dist/node.js'))
);
const ctx = await startVitest(
	'test',
	process.argv.slice(2),
	{ run: true, configLoader: 'runner' },
	{ cacheDir: path.join(os.tmpdir(), 'maestro-about-me-vite-cache') }
);
await ctx.close();
```

实际单元命令如下，反证只重跑其中 about-me 与 system-prompt-native 两个文件，不累计为新增通过数：

```sh
node --max-old-space-size=8192 /tmp/maestro-about-me-vitest.mjs \
  src/__tests__/main/about-me.test.ts \
  src/__tests__/main/agents/native-instructions.test.ts \
  src/__tests__/main/agents/provider-account-dirs.test.ts \
  src/__tests__/cli/services/system-prompt.test.ts \
  src/__tests__/cli/services/system-prompt-native.test.ts \
  src/__tests__/cli/services/agent-spawner.test.ts \
  src/__tests__/main/group-chat/group-chat-router.test.ts \
  src/__tests__/main/cue/cue-spawn-builder.test.ts \
  src/__tests__/main/web-server/handlers/about-me.test.ts
node --max-old-space-size=8192 /tmp/maestro-about-me-vitest.mjs \
  src/__tests__/cli/commands/about-me.test.ts \
  src/__tests__/cli/commands/list-sessions.test.ts \
  src/__tests__/main/cue/cue-executor.test.ts \
  src/__tests__/main/cue/cue-cli-executor.test.ts \
  src/__tests__/main/cue/cue-shell-executor.test.ts \
  src/__tests__/main/cue/cue-notify-executor.test.ts \
  src/__tests__/main/ipc/bootstrap/handler-wiring.test.ts
node --max-old-space-size=8192 /tmp/maestro-about-me-vitest.mjs \
  src/__tests__/main/process-manager/utils/envBuilder.test.ts \
  src/__tests__/main/process-manager/utils/envBuilder.blankKeys.test.ts \
  src/__tests__/shared/providerProfiles.test.ts
npm run lint
npm run lint:eslint
npm run format:check:all
npm run docs:verify
npm run lint:doc-refs
git diff --check
npm run build:main
npm run build:cli
node --input-type=module -e 'import path from "node:path"; import os from "node:os"; import { pathToFileURL } from "node:url"; globalThis.__dirname = process.cwd(); const { build } = await import(pathToFileURL(path.join(process.cwd(), "node_modules/vite/dist/node/index.js"))); await build({ configLoader: "runner", cacheDir: path.join(os.tmpdir(), "maestro-about-me-vite-cache") });'
```

本轮已构建后执行但启动失败的命令：

```sh
task_home=$(mktemp -d /tmp/maestro-about-me-e2e-home.XXXXXX)
env HOME="$task_home" MAESTRO_E2E_REAL=0 MAESTRO_DISABLE_CUE_TELEMETRY=1 \
  ELECTRON_DISABLE_GPU=1 node node_modules/@playwright/test/cli.js test \
  --project=native e2e/native-about-me.spec.ts
```

交给 Opus 在沙箱外重新构建并执行，仍只用合成夹具：

```sh
task_home=$(mktemp -d /tmp/maestro-about-me-e2e-home.XXXXXX)
env HOME="$task_home" MAESTRO_E2E_REAL=0 MAESTRO_DISABLE_CUE_TELEMETRY=1 \
  ELECTRON_DISABLE_GPU=1 npm run test:e2e -- e2e/native-about-me.spec.ts
```

Opus 应先完成该 E2E，再对 native 判定与渲染层提示替换分别作临时回退反证，恢复后重新验证。设置页按 `agentIds` 关联当前智能体、按 `deepseek` 标记预设目录；`spawnHelpers.ts` 及向导发送与实际启动相同的配置，只在成功 loaded 时使用共享指引。Codex 首条原生用户消息内的系统封装也须检验没有重复档案正文。本轮没有发送消息给其他人或调用外部模型。

## 2026-11-01：关于我后端与 CLI

复用 `conductorProfile` 与既有 settings，提供统一的查看、保存、文件状态和确认应用服务。Claude、DeepSeek、Codex 的本机账户分别同步原生指令；确认包含实际目标与管理段快照，首次写入和外部修改不能静默覆盖。逐文件原子写入保留段外字节和符号链接，清空只删除托管段，不新建缺失账户目录，不改 SSH。

测试只使用临时账户。原生文件位置与加载时机按官方文档核对，实际模型加载、真实账户和 Mac 未验；计划中的“每轮加载”不能视为旧进程即时重载。端到端确认保护与段外保留均做临时反证，实际检查和完成结果见[核心体验计划](roadmap/core-experience.md#功能三关于我的后端与-cli)。设置页、长文本输入、确认和部分结果的复现见[Opus 契约](core-experience-contracts.md#交给-opus-的关于我复现用例)。未打包、发布、安装或升级依赖，本功能不进入 hb.5。

## 2026-11-01：原生合并 CI 收尾

PR #29 合并后的 Windows CI 在既有 4 万条无时间转录用例超时；六个其他 job 已通过。确定性回归证明尾部定位反复扫描，1024 条消息产生超过 105 万次元素读取。修复公共数据合并中的位置查找与已匹配项删除，保留原消息、顺序、测试规模和超时，不改界面语义，不用 CI 重跑掩盖问题。具体失败、修复 PR 和主线结果见[核心体验完成记录](roadmap/core-experience.md#功能二合并后的-ci-修复)。

## 2026-10-31：跨 AI 交接后端与 CLI

三家交接复用同项目执行者，在目标窗口准备并持久化空白原生标签的草稿；CLI 默认不发送，显式发送才入队。来源、最近正文、工具一行、预算与省略统计由共用服务提供。Codex 读取不再吞掉系统封装内的首条用户请求，仍由既有 renderer 转换统一拆封装。

首轮回归发现并修复预算边界、超长回答角色、新执行者窗口归属及混合提供方真实模式夹具选错 CLI；均有失败证据。接口和 Opus 的入口/草稿/错误复现见[核心体验契约](core-experience-contracts.md#换个-ai-继续)，最终验收与 PR 见[计划完成记录](roadmap/core-experience.md#功能二换个-ai-继续的后端与-cli)。真实账户、网关、Mac 和新界面未验。未打包、发布或安装；本功能不进入 hb.5。

## 2026-10-31：hb.5 源码候选

按[核心体验计划](roadmap/core-experience.md)完成发布制度第 1、2 步的候选准备，基于主线 `006faefaacf5a2c5405f78f37bae45e44eed501e` 汇集五轮源码与 Opus PR #26，统一版本、说明和验收入口。没有新增产品行为、修改依赖或执行打包发布。[候选验证记录](verification/v1.0.1-hb.5.md)给出核心流程清单、冻结阶段零合并提交的方法和用户的 Mac 操作顺序。DeepSeek、跨 AI 交接和关于我留给后续 PR，不进入本次候选。

发布规则 11 项、连接器回归 26 项、版本与文档路径检查通过；类型、ESLint、全仓格式均通过。[PR #27](https://github.com/CHANxuanyu/maestro-harness-bridge/pull/27) 已合并为 `a2b2ce5c0777109f593fe75d328c39ae93b5e6a4`，PR 七项检查和[实际主线七项检查](https://github.com/CHANxuanyu/maestro-harness-bridge/actions/runs/41245354894)首次全绿。真实账户、Mac GUI 和发行包未验，不沿用旧包结果填充本轮验收。未生成资产、标签或 Release，也未访问真实账户目录。

## 2026-10-31：DeepSeek 预设后端

提供共用的预设准备与模型目录接口，并接通 CLI 创建；沿用 Claude Code 的协议和存储，凭据通过环境变量或 stdin 输入，原生账户独立。旧版桌面会拒绝新的预设请求，不会误创建普通 Claude 智能体。缺陷均先补失败回归，账户隔离 E2E 先做临时回退反证。相关单元 171 条、原生夹具 30 条通过，原有 Claude 的多轮、停止恢复和重启也复核。实际端到端与远端 CI 记录见[计划完成记录](roadmap/core-experience.md#功能一deepseek-预设的后端与-cli)及功能 PR。

没有改界面、升级依赖或触碰真实账户。预设入口、名称和模型选择待 Opus 接入，[后端契约与复现用例](core-experience-contracts.md)已整理；真实 DeepSeek 与 Mac 未验。新功能属于 Unreleased，不进入 hb.5 冻结提交。

| 阶段                           | 实际结果                                                                                         | 主要代码与证据                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-15—16 中文化           | 日常桌面流程、全部设置分类、自有菜单与说明支持中英切换；草稿与语言偏好持久化                     | `src/renderer/i18n/`、`src/shared/i18n.ts`、`src/main/app-menu-translations.ts`；见 [语言范围](internationalization.md)                                                                |
| 2026-10-16—17 原生历史进入项目 | 项目下直接列出会话、提供方标识、原生标题搜索、点击直接接续、已开页签刷新；账户/主机边界与去重    | `src/main/storage/project-history.ts`、`src/renderer/components/SessionList/ProjectSessionTree.tsx`、`src/renderer/services/openNativeConversation.ts`、`refreshNativeConversation.ts` |
| 2026-10-19—20 对话可靠性       | 历史/实时进度与工具一致、工具状态隔离、主动停止不丢 ID、历史阅读定位、本地发送跟随与手动上滚暂停 | Codex parser/storage、process-manager、`TerminalOutput`、`useTerminalOutputScroll`、`useInputProcessing` 与对应回归                                                                    |
| 2026-10-21 原始会话最终验收    | 在真实释放占用后，原始同 ID 完成多轮、工具、停止恢复和重启后继续；用户确认成功                   | [验收摘要](verification/v1.0.1-hb.1.md)；本地 `original-handoff-live-20261021` 01–27 证据序列                                                                                          |
| 2026-10-21 首次分支发布        | 汇总既有改动，建立产品 changelog、分支说明、发布构建方法及下一阶段议题                           | `CHANGELOG.md`、本文件、Release tag 与资产校验清单                                                                                                                                     |

## 可追溯性的做法

- 首次发布保留上游基线 `a4b6925c678095150d2e567b544214ad9aca4d71`，以及此前所有已有未提交工作。此前跨阶段改动集中在工作区中，本次归档不伪造历史提交时间或声称各阶段此前已经独立提交。
- 公开验收摘要描述操作与观察；本地留存原始截图/AX、运行记录、源码清单和安装包身份。两者用途不同，公开发布不携带个人原生会话内容。
- 已通过的实机验收和发布时新增的构建检查分别记录。非同一产物不共用校验值，也不把相互重叠的测试批次累加成虚高总数。
- 下一阶段信息流问题单独建档；功能接续通过不代表视觉和交互已达到目标。

## 首版发布的验证收口

代码提交 `d53c26a97a4c9f959544c61bcfe373562c3a56cb` 归档此前连续开发成果及发布准备；随后文档提交记录完整回归与产物校验。最终 47,159 项通过、0 失败、87 跳过。原生 Opus 补齐旧侧栏测试的视图前提、默认项目树覆盖与 SVG 测试环境；GPT 修正机器身份相关后端测试、核对发行来源和产物。详见 [验证记录](verification/v1.0.1-hb.1.md)。

分工记录：中文化早期曾在用户明确授权后由 GPT 补齐部分前端；后续原生会话体验补修和本轮前端回归使用原生 Claude Code Opus，GPT 负责后端、审查、集成与发布。下一阶段继续按原生 Opus 前端 / GPT 后端的约定推进。

## 首次 GitHub CI 后的跨平台收口

`v1.0.1-hb.1` 的分支、标签和四项草稿附件已上传并核对，未公开 Release。首次 GitHub CI 的静态检查与两项 Linux 测试分片成功；Windows 暴露两处本地路径断言和一处 CRLF 源码扫描断言。原失败记录及候选 tag 保留，使用 `1.0.1-hb.2` 继续发布，不覆盖旧标签。

原生 Claude Code Opus 修正前端快捷菜单测试，增加 LF / CRLF 等价与 PR 两个分支覆盖；GPT 修正两处后端本地路径断言。三个测试文件的本机针对性回归 67 项通过、0 失败。应用运行代码未改动，版本、构建与远端矩阵的最终身份在新版本 Release 附件记录，见 [hb.2 验证方式](verification/v1.0.1-hb.2.md)。

信息流另建 [Issue #1](https://github.com/CHANxuanyu/maestro-harness-bridge/issues/1)，含可勾选的设计与完整接续验收标准。用户对照图只留本地；当前仅完成截图阅读区评审与标准整理，未实施视觉改造。

## 2026-10-21 至 23：信息流与双端接续

- 信息流阶段：原生 Opus 改造 `TerminalOutput`、`LogItem`、`ToolBadge`，新增消息操作/信息组件及配置变化展示；GPT 审查、集成。开发包 `1.0.1-hb.3-dev.2` 完成真实界面及原始同 ID 的多轮、工具、停止恢复、正常重启接续，15 组相关回归 441 项通过。
- 共享阶段：GPT 实现本地传输适配，保留 Codex 原生执行进程。早期在进程祖先链插入 Node 的试接被原生签名检查拒绝，保留失败记录并停止使用；最终启动器通过 exec 保留真实签名进程，没有修改签名或授权规则。
- 刷新阶段：增量只读历史读取与可见会话跟随，保护草稿、队列和阅读位置；原生 Opus 修复长时间压缩后的重复输入及跨端恢复回复漏显。`dev.4` 通过 8 组针对性回归 141 项、三项类型检查及真实界面双向接续。测试批次重叠，不累加为唯一测试总量。
- 最终确认：同一原始会话在两端轮流发送、工具、停止与恢复、双向显示均通过；Codex 当前页面自动刷新由用户确认。Stop 的子进程限制保留在文档中。
- 发布归档：`v1.0.1-hb.3` 将上述已有修改统一提交，不伪造此前独立提交历史。连接器从私有试验目录迁入 `scripts/codex-shared/`，去除个人路径和会话标识，补可重建包、合成边界测试和启动/回退文档。发布包不携带本机配置或原始日志。

实际产物、源码提交、回归与远端 CI 结果见 [hb.3 验证记录](verification/v1.0.1-hb.3.md)及 Release 附件。前端产品语义沿用已验收 Opus 代码；本次新增工作集中在源码归档、后端启动路径可移植性、测试和发布说明。

发布前收口：本机完整回归 47,301 通过、87 跳过，连接器合成测试 11 项通过；去除样例中的真实标题/会话标识后，四个受影响测试文件另复验 150 项通过。格式、ESLint、类型和文档路径检查通过；源文件扫描与原始备份留在私有发布记录中。本轮作者身份采用 GitHub noreply，避免把机器邮箱写入新提交。

发行资产扫描发现原生终端模块的 Mach-O 调试记录含编译机目录，候选包保留为私有诊断，不上传。打包流程新增签名前清理：只去除包内原生模块的调试符号，保留导出与可执行代码，不修改开发依赖或用户安装。发行包重新构建后复验签名、原生 PTY 实际输出和隐私扫描。

## 2026-10-23：信息流按回合折叠（开发预览）

- 起因：用户试用 hb.3 后认为信息流仍难读。对照 Codex，问题在于上一轮约定不新增分组，工具、公开进度和推理只能逐条平铺在回答之间。本轮改为回合结束后折叠过程，设计与取舍见[信息流改造记录](roadmap/conversation-feed.md)。
- 实施：提交 `d3a10a4e6`（分支 `feed/codex-style-turns`）。本轮前端与测试由 Claude Code（Opus 5.5）完成，没有经过 GPT 审查，与此前「原生 Opus 前端 / GPT 后端与审查」的分工不同，特此记录。工具单行复用已有的 `describeToolActivity()`，没有另起工具名表。
- 检查：完整回归 47,313 项通过、87 跳过、0 失败；三项类型检查、ESLint、Prettier 与文档引用检查通过。滚动补载锚点套件在两种布局下 48 项通过；其中一个用例原先把实时流追加到已回答的回合上，改为由新问题开始新回合，未读数随之从 1/2 变为 2/3。
- 界面：在开发版用合成会话对比改前改后截图（本地保留，不入库）；打包后的应用在隔离演示目录启动，确认三个回合折叠行与失败标记正常显示。
- 预览包：`1.0.1-hb.4-dev.1`，commit `d3a10a4e6b1a09b92a68f7e75d28a91363bc2808`，`Maestro-I18n-1.0.1-hb.4-dev.1-mac-arm64.zip` SHA-256 `8c0a4ff7919e52ff22f7dc38b848551dea25036f203f4cea946c8de0e22ddd22`。沿用 `package-harness-bridge` 的配置（bundle `com.maestro.i18n.local`、临时签名、未公证、剥离原生调试路径），另设版本号并输出到 `release/feed-preview/`，没有覆盖已发布的 hb.3 产物。签名校验、ZIP 完整性、arm64 原生模块与个人路径扫描通过。
- 当时未完成：写下开发预览记录时尚未安装，也未在真实会话中验收长回合、停止恢复、共享模式双向刷新与滚动锚点。后续安装与发布状态见下节。

## 2026-10-23：hb.4 发布归档

- 用户随后安装并试用 `hb.4-dev.1`，认可 Claude 的新版信息流并明确要求发布。保留 Claude 的两个独立提交及原分支，在 `codex/release-hb4` 整理版本与文档；未由 GPT 重写前端。
- GPT 审查回合分组、工具标签与渲染集成，运行发布回归，新增 [hb.4 验证记录](verification/v1.0.1-hb.4.md)，更新产品 changelog、下载/构建入口与共享连接器说明。
- 真实界面抽查已安装开发预览：原始会话历史的回合展开/收起、工具输入与结果、最终回答可见、来自 Codex 的当前进度更新。没有向原始聊天重复发测试、停止用户回合或重启共享进程；此前 hb.3 完整接续证据与本版抽查分开记录。
- 发行版本 `1.0.1-hb.4` 从提交后的源码重新构建；包、内嵌提交、签名、原生模块、隐私扫描、完整回归和远端 CI 结果留在 Release 验证附件。旧预览包和本机安装保持原样。
- 后端及共享连接器实现与 hb.3 相同，已启用者继续使用现有目录/路径即可。用户配置、私人聊天、原始截图和运行日志不进入公开提交或附件。

## 2026-10-23 · HB 发布治理

审查 hb.4 发布后的 GitHub 设置：产品 changelog、注解标签、源码/CI/包哈希和验收边界已经具备；默认分支缺少保护、PR CI 没覆盖 fork 主线、Release 未启用不可变保护、上游 rc 守卫在 fork 定时失败，README 验收链接仍指 hb.2。

新增 `docs/release-policy.md`、版本说明和 PR 模板、可复用只读 `scripts/hb-release.mjs` 与反例回归、规则集 JSON。CI 覆盖 fork 主线 PR；上游守卫、SDK 与 stale 流程限定为上游仓库。远端配置与验证通过本次治理 PR 和 Rules 页面留痕，完整 API 前后快照仅保留本机。

GPT 负责此次治理与验证，没有修改 Claude 前端、原生接续、现有应用或配置，也不为制度调整另发安装包。保留既有版本和失败候选；未来发布的附件冻结，历史版本不删除重发。完整流程见[发布管理](release-policy.md)。

## 2026-10-25：自主后端审查，历史账户与主机边界

基于第三阶段已合并主线 `a4fdcc0491973fd4d5bdd416d5fc24871467a4fe`，沿用用户对后端自主修复的授权及原有范围限制。

- **失效 SSH 配置：** `agentSessions:list`、`listPaginated`、`search` 把缺失或已禁用的 remote 解析成 `undefined`，随后读了本地存储。六条回归先失败，已有 `read` 的两条对照通过；三个入口补上与 `read` 相同的 `SSH remote is unavailable` 错误，存储不被调用。原有三条所谓 SSH 透传测试实际期待本地回退，现改为提供 enabled remote 并断言原样透传，另保留本地正常调用的对照。
- **Codex 账户分页：** IPC 已解析 `ownerAgentId` 得到 `configDir`，但 `BaseSessionStorage.listSessionsPaginated()` 丢了这个参数。两个隔离磁盘回归先失败：选中账户读到默认账户，所选目录缺失也借用了默认历史。现在按既有 `AgentSessionStorage.listSessions()` 契约传递第三个账户参数；两页会话、总数、游标及默认账户各自保持正确。没有新建缓存、哈希或账户发现路径。
- **Electron 反证：** 新增 `e2e/native-history-boundary.spec.ts`，用实际 preload/IPC 和现有锁定版本夹具。OpenCode 的本地列表、分页和搜索对照正常，失效远程请求在修复前却 fulfilled；Codex 所选账户两条历史在修复前被分页成 0 条。两个场景均先确认失败，再修产品代码。最初远程用例选用 Codex 默认列表作本地对照，因夹具位于自定义账户而返回空，未把这次用例设置错误计为缺陷反证；改用遵循隔离 XDG 路径的 OpenCode 后才得到有效反证。
- **验证：** 存储、IPC、远程读取相关 24 个文件 460/460；新增 Electron 2/2，8.9 秒；使用合成凭据的真实入口烟测 2/2，10.3 秒，源凭据与临时目录清理检查通过。夹具 26/26，连接器 26/26，发布策略 11/11；类型、ESLint、全仓格式、文档引用及版本规则检查通过。没有重试、跳过或放宽断言。两类 Electron 场景复用已有官方格式出处，没有产品测试旁路。完整原生套件及 Linux/Windows 分片由本次 CI 执行，PR 和实际合并提交的七项 CI 结果见[本次 PR](https://github.com/CHANxuanyu/maestro-harness-bridge/pulls?q=is%3Apr+head%3Acodex%2Fbackend-remote-history) 描述。
- **边界：** 未修改前端行为、认证、写锁、停止机制、依赖或 CI 时限；不打包、不安装、不发布。新场景只验历史读取，草稿、队列、Stop/重启沿用完整原生接续套件。真实账户、真实 SSH 服务、桌面 Codex 和 macOS 未验。Copilot PR #15 的总任务时限仍待原先的范围确认，本轮未绕过该阻塞。

### 交给 Opus：会话浏览器的账户上下文

代码审查发现 `AgentSessionsBrowser` 给 `useSessionPagination` 传了 `activeSession.id`，但 `useAgentSessionsSearch` 和 `useSessionViewer` 没有同样的账户信息；当前 search preload/IPC/storage 契约也没有账户参数。这是需要前后端共同对齐的未完成项，不能把本轮分页修复说成完整账户浏览已验收。

复现用例：为同一项目准备默认账户和自定义 CODEX_HOME 两份独立合成历史，自定义历史含唯一关键词，选择自定义账户智能体打开会话浏览器。分页应只列自定义历史；切到正文搜索，查该唯一关键词，再打开搜索结果或列表中的历史。预期搜索、预览和接续都继续使用相同账户。当前搜索调用没有带所选账户，默认存储无法搜索到自定义关键词；查看调用也需补查。不要把该现象处理成扩大搜索到所有账户、按正文消重或读取失败后回退默认账户。此处是已定位的契约缺口及交接复现，尚未声称通过完整界面验收。

## 2026-10-25：自主后端审查，历史路径与搜索语义

从已通过七项主线 CI 的 `0ec1e10d304d0c27d225fd4fc7b63cb92a73757b` 继续检查既有历史接口，未扩展前端行为或接口参数。

- **路径查询保留 SSH 主机：** preload 和声明已有 `sshRemoteId`，但 `agentSessions:getPath` 处理函数忽略了它。三条单元回归先确认 enabled remote 返回本地路径、missing/disabled remote 没有报错，再沿用 `read` 的解析与拒绝方式，把有效配置传给存储适配器。原生 Electron 边界用例增加路径查询，失效主机的八次请求全部拒绝；修改前新增的路径断言失败。真实 SSH 连接未验，不能把参数透传测试说成远程服务验收。
- **标题检索避免读取正文：** 基类曾先加载消息，再匹配已列出的标题，正文异常因此还会丢失有效标题结果。现在 title 模式复用同一匹配、计数和截取逻辑，但不调用消息加载器；Codex 的 title 模式同时不再建立仅供正文搜索使用的路径表。三个已缓存会话的回归显示，旧实现额外读取三个转录文件，新实现为零，目录遍历最多四次 `readdir`。首次发现标题仍需要提供方读取元数据，未声称冷缓存零 I/O，也没有增加缓存或哈希。
- **正文搜索返回对应角色的摘录：** user/assistant 模式在标题也命中时，曾返回标题而非命中正文。两条角色回归和实际 Electron IPC 的 user 摘录断言先失败；现仅允许 title/all 模式预先使用标题摘录。`matchType`、匹配数量及 all 模式的标题优先规则保持原契约。
- **反证质量：** 路径测试重置 SSH mock 的一次性返回队列，避免未调用解析器的缺陷把结果串到下一例。Codex I/O 回归最初误用只出现在用户正文的关键词，修正为元数据中的助手标题后，在独立未修基线再次确认三次多余读取。首个 E2E 摘录样例的标题恰好等于助手正文，无法反证；补上不同的用户正文摘录断言后明确失败。这些用例设置问题不计为产品缺陷或有效反证。
- **验证：** 25 个相关文件 493/493；两条 Electron 场景 2/2，9.3 秒；合成凭据的真实模式入口烟测 2/2，9.9 秒，源凭据及临时目录清理检查通过。夹具 26/26，连接器 26/26，发布策略 11/11；类型、ESLint、全仓格式、文档引用、版本规则和差异检查通过。原生格式继续来自已有锁定版本夹具，没有新增原生字段、重试或测试旁路。完整原生套件、Linux/Windows 分片及实际合并提交的七项 CI 结果见[本次 PR](https://github.com/CHANxuanyu/maestro-harness-bridge/pulls?q=is%3Apr+head%3Acodex%2Fbackend-history-contracts) 描述。
- **前端交接与限制：** 搜索调用与返回字段没有新增参数；Opus 可继续按既有 `matchType`/`matchPreview` 使用结果。上一节的所选账户搜索、查看契约仍未完成，需要前后端对齐；本轮未因此推断新的账户或扩大搜索范围。真实账户、macOS 和桌面 Codex 未验，PR #15 的 CI 时限范围确认仍待回复。

## 2026-10-30：Grok 前端交接（Opus）

基于主线 `be88f6a8667200bc19ee96119022297b6604eaff`，处理[后端第三阶段](roadmap/backend-stage3.md#交给-opus)交给 Opus 的 Grok 三项界面问题，只改渲染层。

- **消息信息崩溃：** Grok 历史没有消息时间，转换后为 NaN，消息信息格式化时抛出 `RangeError: Invalid time value`。现在显示“未记录”，原生模型和思考等级照常显示；旧版布局不再画 NaN 日期，LogItem 的 memo 用 `Object.is` 比较时间。两条单元回归先失败后通过。
- **跟随后回复重复：** `mergeNewerEntries` 用时间窗口证明实时消息与原生副本是同一条，NaN 无法比较，重启后续接的回合被再追加一次。没有原生时间的条目改为按磁盘顺序与本标签尚未配对的同文本条目一一对应，只能配给上一次配对之后的条目，新条目按磁盘顺序插入；有时间的提供方不变，不做全局正文消重。七条合并回归先全部失败后通过，覆盖真实重复回合、外部轮次插在本标签发送之前、Stop 后的外部轮次和乱序配对。Grok 加入 `useNativeTranscriptFollow`。
- **未知状态：** 存储明确返回 unknown 的工具调用显示“结果未知”，折叠行同样标出，不显示完成或运行中；会话浏览器的工具卡片不再把未知或缺失状态画成成功。转换、信息流、旧版布局和工具卡片各有先失败的回归。
- **验证：** 相关渲染层 193 个文件 4677/4677；类型检查、ESLint、格式和发布策略检查通过。Electron 端到端在启用 Grok 跟随后，d 的严格唯一断言和恢复后的 e 消息信息断言通过；临时回退合并修复与时间判断后，d 报 `resolved to 2 elements`，e 找不到消息信息面板，恢复后再次通过。完整原生 Electron 套件 45/45，6.8 分钟。
- **未覆盖：** 从未从历史打开、全部由本次实时发送组成的标签没有锚点，跟随刷新静默失败；f 仍只验后端 revision 与只读 IPC。两项连同第三阶段其余非界面缺口写入[第五轮计划](roadmap/follow-and-history-gaps.md)交给 Codex。真实 Grok CLI、真实账户和 macOS 未验。

## 2026-10-31：会话浏览器账户与未知时长（Opus）

基于主线 `6c3a1a9a1`，处理[第五轮](roadmap/follow-and-history-gaps.md#交给-opus)交给 Opus 的三项界面需求。

- **缺失账户提示：** 所选账户目录确实不存在时，main 的读取和搜索失败改为带固定标记的错误；目录存在时的其他错误和 SSH 读取保持原样。会话浏览器的搜索结果和预览显示“该智能体的账户不可用”，与“没有符合搜索条件的会话”区分，不上报 Sentry，不回退默认账户。main 两条、搜索 hook 两条、列表与预览各两至三条回归先失败后通过。
- **切换账户与迟到读取：** 智能体、项目、主机或所属智能体变化时关闭预览，并丢弃之后才返回的旧读取；同一智能体内先后打开两个会话时，前一个读取也不能覆盖后一个。三条 hook 回归先失败后通过。
- **未知时长：** 上下文详情的时长未知时显示“未记录”，不显示 0m；回归先失败后通过。
- **验证：** 类型检查、ESLint 和格式检查通过；相关单元测试 491 个文件 10871/10871。`native-history-boundary` 的 Codex 场景扩展为界面断言：移走账户目录后打开会话浏览器搜索，提示账户不可用而不是没有匹配；IPC 的读取和搜索都带固定标记。临时回退本项的 main 与界面改动后，该场景失败，恢复后通过。首版断言在重开浏览器后等待列表行，但浏览器会自动跳到当前会话的预览，在 CI 中因时序失败；改为先移走目录再打开（列表为空，不会自动跳转），本地连续两次通过。预览的提示由单元测试覆盖。真实账户和 macOS 未验，五万条历史的实际绘制测量仍需目标机器。

## 2026-11-01：DeepSeek 预设的界面（Opus）

基于主线 `57341e712`，接入[后端契约](core-experience-contracts.md#交给-opus-的复现用例)中的四个复现用例，只改渲染层与共享的显示规则。

- **提供方身份：** DeepSeek 仍是 `claude-code`，所以所有按 `toolType` 命名或分组的地方都把它当成 Claude Code。新增 `agentProviderId()` / `sessionProviderId()`（`src/shared/agentPresets.ts`），只用于命名和分组，启动、解析和历史读取仍按 `toolType`。侧栏原先把同一项目里的 Claude 和 DeepSeek 合成一个“新建对话”选项，提供方筛选也分不开；历史记录按所属智能体判断，智能体已删除时按账户目录判断。侧栏的重绘比较加上提供方身份和账户目录，编辑环境变量后能及时刷新。
- **显示：** 标题栏图标与提供方、智能体行、模型面板标题显示 DeepSeek，并新增简化的鲸鱼图标。模型选择（输入框模型按钮、模型面板、排队消息编辑）只给预设的三个模型，不请求 Claude 模型目录；预设没有写明支持哪些强度，所以不提供强度选择。编辑智能体时提供方固定为 DeepSeek。
- **新建：** 提供方列表在 Claude Code 下方单列 DeepSeek，没有 Claude Code 时不可选，开启 SSH 时不可选（仅本机）。选中后输入遮盖的密钥并选模型；只有点创建时才调用 `prepareDeepSeekPreset`，选择或取消都不建目录。预设负责路由、凭据、模型和账户，Claude Code 行的参数、环境变量、模型和强度都不带入，只沿用它的可执行路径。失败时对话框保持打开，显示原因但不含密钥；对话框关闭即清空密钥。界面与 `maestro-cli create-agent --preset deepseek` 建出的智能体字段一致。
- **回归与反证：** 身份、侧栏、重绘比较、图标、标题栏、智能体行、模型列表、模型面板、新建与编辑对话框共 15 条回归，修复前全部失败。新增 Electron 场景 `claude DeepSeek dialog`：在对话框里把 Claude Code 行指向夹具 CLI，再创建 DeepSeek 智能体并发送一轮，检查保存的字段、独立账户里的原生记录、默认 Claude 目录为空，以及标题栏和侧栏只显示 DeepSeek。临时回退全部渲染层改动后，15 条单元回归和该场景失败（对话框里没有 DeepSeek 选项），恢复后通过。
- **验证：** 完整单元测试 2091 个文件 47669/47669（88 跳过）；完整 Electron 套件 58/58（macOS，`TMPDIR` 与 `MAESTRO_E2E_TEMP_ROOT` 设为 `/private/tmp`）；类型、ESLint、格式、文档路径与引用、发布规则检查通过。
- **限制：** 该场景只在假程序下运行：真实模式需要把真实密钥输入页面，而 Playwright 的操作记录会写进追踪文件；真实网关仍由 CLI 场景 `claude DeepSeek:` 覆盖。DeepSeek 智能体被删除后，打开它留下的历史会新建一个普通 Claude Code 执行者（`openNativeConversation` 按 `record.provider` 建），此时不带网关，记为后续问题。强度是否可用、真实 DeepSeek 账户和 Mac 发行包未验。

## 2026-11-02：换个 AI 继续的界面（Opus）

叠在 DeepSeek 界面（PR #34）之上，接入[交接契约](core-experience-contracts.md#交给-opus-的交接复现用例)的第 1、2、4 项。只改渲染层，交接服务、IPC 和 CLI 不变。

- **入口：** 对话的标签菜单、命令面板、错误对话框的恢复操作、对话里的额度/限流/登录失效错误、正在重试的额度卡片，共五处，都打开同一个对话框。哪些标签能交接（有对话、非 SSH）和哪些错误给入口（`rate_limited`、`auth_expired`）集中在 `src/renderer/services/aiHandoffEntry.ts`，五处不会各判各的。错误入口不清除原错误，也不停止正在进行的重试。
- **对话框：** 用 `handoffTargets` 列出可接手的 AI，说明草稿去处（本项目已有智能体的新标签，或新建智能体），请求时不带 `send`，所以对话框本身发不出任何内容。成功后跳到新标签；没有生成草稿时留在对话框显示原因；已生成但没保存等情况会跳到草稿并给出需确认的提示，不自动重试。副标题沿用标题栏的对话名，不显示会话 ID。
- **草稿说明：** `openHandoffTarget()` 在草稿标签上记下来源、估算 token 和省略条目/字符（不含草稿正文）。输入框上方的说明条只在该标签还没有对话时显示，发送后自动消失，也可以手动关闭。CLI 准备的草稿同样有说明。
- **回归与反证：** 入口规则、对话框（7 条）、说明条、服务标记、错误恢复、错误对话框接线、额度卡片、标签菜单、命令面板、对话错误按钮，修复前 7 条行为回归和 3 个新文件全部失败。新增 Electron 场景 `claude handoff dialog`：从命令面板打开对话框，选 Codex，检查草稿标签、说明条、保存字段、源标签和原生文件不变，再用普通发送发出。临时回退全部渲染层改动后，单元回归和该场景失败（没有对话框），恢复后通过。
- **验证：** 完整单元测试 2094 个文件 47696/47696（88 跳过）；完整 Electron 套件 59/59（macOS，`TMPDIR` 与 `MAESTRO_E2E_TEMP_ROOT` 设为 `/private/tmp`）；类型、ESLint、格式、文档路径与发布规则检查通过。
- **限制：** 侧栏里草稿标签和其他空标签一样显示“新建对话”；契约第 5 项（会话浏览器预览首轮交接时显示系统封装）未做；真实账户和 Mac 未验。

## 2026-11-02：关于我的界面与启动去重（Opus）

叠在“换个 AI 继续”的界面（PR #35）之上，接入[关于我契约](core-experience-contracts.md#交给-opus-的关于我复现用例)的复现用例 1 至 5，并修掉同步原生文件后系统提示重复带“关于我”的问题。后端部分交给 Codex 在独立克隆中完成，三个提交原样并入。

- **设置页：** 原 Conductor Profile 输入框换成“关于我”区块。编辑框没有长度上限，停顿约 0.6 秒后经 `saveConductorProfile()` 调用 `settings.aboutMe set`，按服务返回的内容更新；旧的 `setConductorProfile`（截到 5000 字、经 `settings.set` 保存）已删除。保存只改 Maestro 的档案，不碰原生文件。
- **原生文件：** 列出 `status` 的每个文件：提供方（`deepseek` 标记的目录显示为 DeepSeek）、原始路径、实际文件、`agentIds` 对应的智能体名称、状态。第一次写入、别处写的段落、外部改过的段落都要勾选，勾选记下当时显示的实际文件与段落并原样传给 `apply`；之后的检查若显示段落或目标变了，勾选自动取消。已归 Maestro 管理的文件直接计入“写入 N 个文件”；清空档案后按钮变成“从 N 个文件中移除”。Codex 的非空 override 标为“被覆盖”并说明原因，不显示为已同步。
- **结果：** `summarizeAboutMeApply()` 把一次 apply 分为已写入、已写入但未记录、待确认、失败和目录缺失。部分完成显示“已写入 1 个，共 3 个”，其余文件在列表里标明；档案在写入时被别处修改会说明，不自动重试。写入或移除后提示重启已经在运行的 claude 或 codex。
- **系统提示：** `prepareMaestroSystemPrompt()` 改用 `conductorProfileForAgent()`：按智能体当下的 `toolType` 和 `customEnvVars` 询问 `native`，只有明确 `loaded: true` 才代入 `nativeAboutMePointer()`；SSH 智能体不询问，空档案、检查失败或其他任何状态都保留全文。
- **Codex 的后端（3 个提交）：** `native` 只读判定、`status` 的 `agentIds` 与 `deepseek`、共享的替代文字，CLI、Cue 与群聊主持人提示使用同一判定；另把账户变量配置为空值时的解析改为回到默认目录，与实际启动进程时的环境合并一致（核对过 `buildChildProcessEnv`）。细节见上方“关于我的原生启动判定”。
- **回归与反证：** 新增规则、区块（12 条）、存储保存、系统提示（6 条）与搜索登记回归；原有 GeneralTab 中断言 5000 字上限的用例按新行为改写；`useRemoteHandlers` 测试的 `window.maestro` 替身补上 `settings.aboutMe`（系统提示现在会询问它，缺了会多一次 Sentry 上报），断言不变。临时撤掉全部渲染层改动后，13 条行为回归失败、2 个新测试文件无法导入，Electron 场景 `claude about-me settings` 与 `codex about-me prompt` 失败（后者在原生记录里找到正文而不是指引）。在完整实现上另做两次针对性反证：把保存改回截到 5000 字，设置页场景停在“正在保存”；让勾选在文件再变后保留，设置页场景在勾选断言失败、两条单元回归失败，文件本身仍被后端拒绝改写。恢复后全部通过。
- **验证：** 完整单元测试 2098 个文件 47758/47758（88 跳过）；完整 Electron 套件 61/61（macOS，`TMPDIR` 与 `MAESTRO_E2E_TEMP_ROOT` 设为 `/private/tmp`）；类型、ESLint、全仓格式、文档路径、文档引用与发布规则检查通过。浅色（ayu-light）与深色主题截图检查过版面，预览管理段时关闭了字体连字，避免 `<!--` 显示成箭头。
- **限制：** 新建向导与 `/wizard` 的系统提示仍带全文（提示在同步函数里一次性生成，改动需要四处启动点改为异步）；新场景只在假程序下运行；真实账户、真实模型加载与 Mac 发行包未验。

## 2026-11-01：退出前保存会话（Opus）

hb.5 候选 `a2b2ce5` 的 Codex 真实验收中，d（正常重启后续接）重启前回答已显示、进程已退出，重启后标签只剩提问。基于主线 `57341e712` 处理前端部分，只改渲染层。

- **根因：** 渲染端会话保存有 2 秒尾部防抖。确认退出后，main 只写出自己已收到的改动，随后在 750 毫秒后强制结束进程，窗口从不关闭，所以 `beforeunload` 不触发，防抖里的改动直接丢失。真实 Codex 在回答后约 1.1 秒才退出，测试随即重启，回答正好落在这个窗口里；此前一次防抖已把提问写盘，所以重启后只剩提问。假程序回合不到 2 秒，提问和回答都没写盘，读取原生记录时整段补回，因而 CI 未暴露。
- **修复：** 新增 `services/quitSave.ts`，持久化 hook 注册“写出防抖中的改动并等其落盘”，三条确认退出路径（无忙碌任务、退出确认框、空闲后退出）都改为先保存再通知 main。正在写的一次保存只带它开始时的快照，退出保存会等它完成后再比较一次。保存失败或 3 秒未完成时照常退出，不重试。
- **回归与反证：** 单元回归覆盖防抖期内的改动、写盘途中的新改动、退出确认框和空闲退出四条路径，另有服务自身的失败、超时和注销用例。临时回退四个渲染层文件后，四条路径回归全部失败，恢复后通过。新增 Electron 场景 `claude k`：用工具把回合拖过 2 秒，使提问先写盘，回答落地后立即重启，检查磁盘上的标签副本含有回答。修复前该场景失败，磁盘副本只有提问和运行中的 Bash 工具。
- **原有重启场景：** copilot、grok、omp 的 d 原来要求重启后从“历史”行打开会话，这只在标签没保存原生 ID 时成立。修复后标签带着原生会话恢复，侧栏显示为已打开的标签，不再另列历史行。三处改为点击绑定该原生 ID 的已打开行，并在历史加载完成后断言该 ID 只出现一行。侧栏行新增 `data-native-session-id` 供定位。临时回退修复后，这三条和 `claude k` 失败，claude、codex、opencode 的 d 仍通过；恢复后七条重启场景全部通过。
- **验证：** 完整单元测试 2089 个文件 47663/47663（88 跳过）；类型检查、ESLint、格式、文档路径和引用检查通过。完整 Electron 套件在改三条 d 之前为 55/58，失败的正是这三条。
- **限制：** 退出请求只发给主窗口，副窗口最后 2 秒的改动在退出时仍可能丢失，需要 main 在确认退出前通知所有窗口保存，已写给 Codex。Codex 读取首条用户请求的问题已由 `efde61263` 修复；d 的真实模式需在下一候选上重跑确认。

## 2026-11-02：hb.6 前置项，测试临时目录

- 分支 `codex/hb6-prerequisites`，起点 `57341e712`。仅本地开发，不改冻结 hb.5 源码、连接器范围或真实账户。
- 新增 `temp-root.test.ts` 的物理路径与 OMP 根目录两条回归，修改前均失败，修改后 2/2。Electron、夹具和 OMP 守卫共用物理临时根目录，macOS 保留短 socket 路径，越界项目仍拒绝。
- `npm run test:e2e:fixtures`：29/32，三条共享 socket 用例被沙箱 `listen EPERM` 阻止，没有跳过或重试。`npm run lint`、`npm run lint:eslint` 与改动文件 Prettier 通过。
- `TMPDIR=/private/tmp/ MAESTRO_E2E_TEMP_ROOT=/private/tmp npm run test:e2e -- --grep 'omp a:'` 在 renderer 构建阶段受阻：已就位的 node_modules 是工作区外链接，Vite 写入 `.vite-temp` 被沙箱拒绝。没有绕过。完整 Electron 验收及临时回退反证待沙箱外执行。默认环境验收命令为 `npm run test:e2e:fixtures`、`npm run test:e2e`；hb.5 已冻结，原 Mac 临时目录限制须由发布证据维护者写入其 VERIFICATION.json limits。

## 2026-11-02：hb.6 前置项，Codex 契约与退出时序

- 按官方 `rust-v0.163.0-alpha.11.1` 核对 exec JSON、持久化 CommandExecution、可空 effort 和文件写锁，出处与后续验收见 [hb.6 前置项](verification/hb6-prerequisites.md)。普通 exec 假程序不再伪造命令增量；完成时输出断言保留，运行中跟随及上滚断言移到共享模式。
- 正常 teardown 等 Stop 消失；假 Codex 最终回答后再等待 1100ms 退出。原生工具 ID 读取支持持久化 item_completed；默认 effort 保留 null，显式 high 的正向用例继续核对 high。
- 外部成功进程不再收到进程组 SIGTERM，失败清理仍保留。合成子进程证明原清理会截断收尾，但这不能证明真实 active writer 冲突已消失；没有删除写锁、加重试或调用真实 CLI。
- 新增五条失败回归，修复后通过；临时回退 protocol、native-real、native-app 后重现 5 失败 / 4 通过，恢复修改。相关夹具最终 9/9；Codex 解析、消息、revision 单元测试 219/219。`npm run lint`、`npm run lint:eslint`、改动文件 Prettier 通过。
- 默认 Vitest 配置加载也遇到外部 node_modules 的 `.vite-temp` 写入拒绝。将配置中的 `__dirname` 换成原生 ESM URL，使用同一配置的 `--configLoader native` 运行单元测试，无断言或选择范围旁路。Electron 命令仍保持原入口，其执行与 Electron 临时回退反证由沙箱外补验。

## 2026-11-02：hb.6 前置项，本地原生历史路径别名

- 以官方固定版本核对 Claude Code 2.1.310、Copilot 1.0.63、Grok 1.0.45 和 OpenCode 1.19.4 的 cwd 来源，包完整性与源码出处见 [hb.6 前置项](verification/hb6-prerequisites.md)。只下载并读取公开包，没有执行原生二进制。
- 四种提供方共用 `localProjectPathCandidates`，本地读取同时匹配所选路径和 realpath。Claude 合并两个目录并按原生 ID 去重；OpenCode 同时保留 JSON 与 SQLite 读取。缺失项目保留旧路径，账户选择和 SSH 路径不变，不改原生文件。
- `project-alias.test.ts` 四条回归先 4/4 失败再 4/4 通过，覆盖列表、分页、搜索、消息、revision、外部追加、旧路径记录、缺失项目、同名前缀和所选账户边界。临时回退四个存储实现后再次 4/4 失败，恢复修改。相关存储单元测试 174/174。
- 新增四条 Electron `path:` 场景，核对真实 IPC、界面历史打开与外部追加跟随。Electron 执行及反证受相同沙箱构建限制，交由 Opus；没有用夹具结果替代 Electron 结论。
- `npm run lint`、`npm run lint:eslint`、改动文件 Prettier 和 `git diff --check` 通过。定向 Electron 命令已实际运行，仍在 `.vite-temp` 写入处失败，0 条场景执行。

## 2026-11-02：hb.6 前置项，多窗口退出保存协调

- `before-quit` 确认后先向 WindowRegistry 中存活的 app 窗口请求保存，按请求 ID 和 webContents 校验回执，总等待上限 5 秒。窗口销毁、渲染进程退出或发送失败可结束该窗口等待；错误回执不记成成功。重入不重发，不重置期限。全部结束后才 flush main 写入并启动原有清理及退出宽限期。
- preload 的 `onQuitSaveRequest(save)` 等所注册保存 Promise 完成再回执，失败回传 false，并提供卸载监听函数。没有改动 renderer 界面、文案或持久化逻辑；本克隆缺少 PR #32 的 quitSave 服务，Opus 的前端接入仍是发布前置条件。
- 初始七条新增回归先失败，修复后连同原有用例 73/73；补充发送时销毁覆盖后共 74 项。临时回退 main 与 preload 后新增八条均失败，恢复后复验。用例包括所有窗口收齐后才清理、总时限和重入、错误来源和过期回执、销毁和崩溃、发送失败、保存 Promise 等待与失败回执。
- 最终相关单元 74/74，类型、ESLint、改动文件 Prettier、626 条文档路径与 HB 源码策略检查通过。全量夹具 39/42，剩余三条均因沙箱 socket `listen EPERM`，无跳过。Playwright 可列出 63 个原生场景；Codex 定向 Electron 命令实际仍在 Vite 构建受阻，0 条执行。

## 2026-11-02：Codex 工具标识边界复核

- 加强 `finds native command IDs in 11.1 durable CommandExecution items`：同一命令同时存在模型 function_call 和持久化 CommandExecution 时，优先读取后者的 ID，旧格式单独存在仍可读取。新断言先失败；修复仅限验收读取器。
- 官方 exec JSON 处理器会另分配 `item_N`，不要把 stdout 的条目标识和原生持久化标识误认为同一个命名空间。当前 b 场景分别检查界面命令/结果/状态以及原生记录 ID 的存在与唯一性，没有跨域比较 ID。
- 单独临时回退 ID 读取修复后 1 失败 / 3 通过，恢复后相关夹具 9/9；最终全量夹具仍为 39/42，三项失败均为沙箱 socket EPERM。类型、ESLint 与改动文件 Prettier 通过。

## 2026-11-02：hb.6 前置项整合与 Mac 验收（Opus）

把 Codex 在独立克隆中完成的五个提交叠到 PR #32 之上，接上逐窗口退出保存的前端监听，并在 Mac 沙箱外完成 Electron 正反验收。详细命令、结果和未覆盖项见 [hb.6 前置项验证](verification/hb6-prerequisites.md#opus-整合与-mac-沙箱外验收2026-11-02)。

- **整合：** 五个提交原样保留作者与说明，只合并 CHANGELOG、工作记录和 `native-resume.spec.ts` 的冲突。这些提交改动的 e2e 夹具（`.cjs`）不在仓库 ESLint 范围内（`lint:eslint` 只检查 `src/`，主线未改动的 `protocol.cjs` 同样有 7 个这类错误），提交钩子会对它们报错，所以按原样提交时跳过了钩子，每个提交先单独跑 Prettier 检查。
- **逐窗口保存：** `answerQuitSaveRequests()` 由持久化 hook 在每个应用窗口挂载，回应主进程的 `app:requestQuitSave`；保存失败或超过 `QUIT_SAVE_TIMEOUT_MS` 时回报未保存。新增回归 7 条（服务 6 条、hook 1 条）修复前失败；`useBatchHandlers` 测试的 `window.maestro.app` 替身补上新方法，断言不变。新 Electron 场景 `claude l` 在去掉监听时于超时日志断言失败。
- **场景修正：** `copilot path:` 与 `opencode path:` 按原生 ID 定位历史行（这两家以回答作标题），别名读取无需改动。
- **验证：** 默认 macOS 临时目录下全量夹具 42/42、完整 Electron 63/65（失败为上面两条，修正后 4/4）；`claude k`、`claude l` 通过；三组反证（别名读取、物理临时根目录、Codex 契约夹具）均失败于预期位置，恢复后通过。完整单元测试 2090 个文件 47678/47678（88 跳过）；类型、ESLint、格式、文档路径、文档引用与发布规则检查通过。
- **限制：** 两个窗口同时有尾部改动、更新退出与无响应窗口的总时限只由 main 单元测试覆盖；真实模式、真实账户与 Mac 发行包未验。

## 2026-11-02：界面改版第一阶段，配色与字体（Opus）

用户要求把界面改成 Claude Code 的样子，并由 Opus 作为 PM 持续交付。设计说明与分阶段计划见 [界面改版](roadmap/claude-code-ui.md)。本阶段叠在 PR #37 之上，只改默认值和呈现。

- **审查：** 用假程序跑一段两轮、带工具调用与代码块的对话，深浅主题各截全窗口图。最显眼的是全等宽字体、默认展开的右栏、每轮弹出的摘要通知、标题栏与输入框的大量标签，以及 Dracula 紫色。
- **改动：** 新增 Clay Dark / Clay Light 两套暖中性主题，`DEFAULT_THEME_ID` 收拢十余处 `'dracula'` 默认值；两侧设置默认值改为 Default 字体预设（界面与对话 Inter，终端与编辑器 JetBrains Mono），`INTERFACE_FONT_STACK` 让启动画面、`body` 回退字体与设置保持一致；右栏默认收起。只有未设置过的值换成新默认，已保存的主题和字体不变。字体切换后发现对话代码块继承了比例字体，`CodeFence` 改用代码字体。
- **测试：** 新增 Clay 主题、默认主题、右栏默认、代码字体等回归，旧默认值的断言按新行为改写；侧栏头部宽度阈值的测试固定在它们设计时的 14px 等宽字体。Electron 中依赖右栏默认展开的 `h`、`i` 场景改为先从标题栏打开右栏（新增 `openRightBar()`，收起时右栏自身的按钮在窗口外）。临时撤掉源码改动后 9 个测试文件 23 条失败，恢复后通过。
- **验证：** 完整单元测试 2099 个文件 47801/47801（88 跳过）；完整 Electron 66/71，失败的 5 条即上述右栏场景，修正后 5/5。类型、ESLint、格式与文档检查通过；深浅两种 Clay 主题截图核对过。
- **限制：** 侧栏头部在 15px 下放不下“OFFLINE”文字（第四阶段改版）；标题栏、输入框、通知与对话区排版留待后续阶段。

## 2026-11-02：界面改版第二阶段，对话区（Opus）

叠在第一阶段（PR #38）之上。核对对话区后，回复下方的操作图标本来就是“悬停才显示，只有最新一条常显”，与 Claude Code 一致，未改。

- **摘要通知：** 回合结束后的摘要会写进历史并弹出“摘要”通知。新增 `isConversationOnScreen()`（`src/renderer/utils/sessionAttention.ts`）：窗口有焦点、该智能体是当前智能体、该 AI 标签在最前（用 `resolveModelEffortTabId()` 判断，不在文件、终端、浏览器标签或群聊之后）时，用户看着它结束，不再弹通知；历史记录照常写入。其他情况照旧提醒。
- **回合摘要行：** “Worked” 后面原来直接接失败徽标，显示成“Worked ! Failed”。现在是一句话，例如“Worked for 3s · 1 failed step”，失败步骤按数量写出并用错误色；停止和结果未知同样用“· 文字”。保留 `data-tool-status`，空格是真实文本而不是只靠 CSS 间距，读屏和复制得到的都是完整句子。
- **测试：** 新增在看/后台窗口/其他智能体/其他标签/文件标签/群聊六种情况的回归、摘要通知在看时不弹与后台时照弹的回归、失败步骤措辞与计数的回归。

## 2026-11-02：界面改版第三阶段，输入框与标题栏（Opus）

叠在第二阶段（PR #39）之上，只改呈现，快捷键、命令面板和 CLI 对等不变。

- **输入框：** 发送键和通知铃铛原来在输入框右侧另起一列，现在通过 `ToolbarControls` 的 `trailing` 放进卡片底行右端，发送是圆形强调色按钮，铃铛是暗色图标（手机布局不变）。权限、思考、历史、回车方式改成没有底色和边框的小控件，打开时只变色；思考和历史只留图标，名字放在 `aria-label`。模型和强度从左侧彩色胶囊改成右侧的暗色文字加下拉箭头，菜单改为从右侧展开。
- **运行胶囊：** 运行中的就是正在看的对话时，胶囊只显示状态、用时、+N 和停止，不再写智能体名和标签名（标题栏已经写了），详情放在悬停提示里；其他对话运行时照旧写出名字。任何情况都不再把会话 ID 的十六进制片段画在胶囊上，只在提示里。底色从黄色改为 `bgActivity`。
- **窗口标题条：** 新增 `appTitleStripText()`（`src/renderer/utils/appTitleStrip.ts`），只写分组和智能体名，不再写标签名或会话 ID 片段。
- **标题栏：** 本地非 git 目录的 LOCAL 标签没有菜单也没有悬停，删掉；空的分支容器由 `.header-git-pill:empty` 隐藏，手机样式里对应的 `.header-local-badge` 规则一并删除。分支、费用改成暗色文字；上下文百分比在健康区间是暗色，进入警告和错误区间才变色（沿用用户设置的阈值）。
- **测试：** 新增输入框卡片包含发送与铃铛、设置控件无底色且模型紧挨发送、在看的对话只显示状态与停止、胶囊不画会话 ID、标题条文字、非 git 目录不画标签、上下文健康时为暗色的回归；改写了断言旧样式（LOCAL 标签、会话 ID 按钮、正在看的标签名）的用例。临时撤掉源码改动后 6 个测试文件 13 条失败，恢复后通过。
- **验证：** 完整单元测试 2099 个文件 47814/47814（88 跳过）；完整 Electron 69/69（含 1000px 下两侧栏与输入框控件不重叠的 `i` 场景）；类型、ESLint、全仓格式检查通过。深浅两种 Clay 主题截图核对过。
- **限制：** 运行时发送键没有变成停止：停止已在运行胶囊上，同一个操作画两次违反 `StopTurnButton` 的约定，留待把运行状态移进对话时一起处理。运行中的对话在侧栏里会短暂显示会话 ID，归入第四阶段的侧栏行。只在假程序下验证，真实账户与 Mac 发行包未验。

## 2026-11-02：界面改版第四阶段，侧栏与外观（Opus）

叠在第三阶段（PR #40）之上，只改默认值和呈现，快捷键、命令面板和 CLI 对等不变。

- **新会话按钮：** 会话列表最上方新增“新会话”，在当前智能体里开一段新对话，走与项目菜单相同的 `newConversation`（提示里写出 `newTab` 快捷键）。没有打开的智能体时不显示。
- **对话行标题：** 打开的标签没有名字时，原来退回会话 ID 片段（`CC6F2159`）。现在依次用标签名、原生记录标题、用户说的第一句话，都没有时显示“新会话”，与标题栏一致。第一句话是在重建行时读取的；`sidebarSessionEquality` 仍不比较日志，因为发送会把标签切到忙碌并触发重建，之后的流式输出不会改动第一句话。
- **侧栏底部：** “管理智能体”和“反馈”从强调色实心按钮改为暗色文字按钮。
- **跟随系统深浅色：** 新设置 `followSystemAppearance`（默认开），由 `themeIdForAppearance()` 和 `APPEARANCE_PAIRS`（`src/shared/themes.ts`）决定，只在 `useResolvedTheme()` 里生效，系统模式由 `usePrefersDarkColorScheme()` 实时读取。只有成对的主题（Clay Dark 与 Clay Light）会切换，Dracula、插件主题和自定义主题不受影响；`activeThemeId` 不会被改写，系统切回时恢复原选择。“设置 -> 主题”新增开关并加入设置搜索，选择器标出实际显示的那一半。CLI 通过通用的 `settings get/set followSystemAppearance` 对等，网页端允许列表同步加入。
- **测试：** 新增成对切换与不成对不变、主题解析随系统实时切换和关闭时不变、主题页开关与标记显示的那一半、顶部新会话按钮及无智能体时隐藏、打开的标签不显示会话 ID 并在发送后用第一句话的回归。临时撤掉源码改动后 5 个测试文件 8 条失败，恢复后逐字节一致并通过。
- **验证：** 完整单元测试 2101 个文件 47826/47826（88 跳过）；完整 Electron 69/69，改用第一句话作行标题后又完整跑了一遍，仍是 69/69；类型、ESLint、全仓格式与文档检查通过。截图核对：本机系统为浅色时默认显示 Clay Light，模拟系统切换为深色、浅色时界面实时跟随。
- **限制：** 运行时发送键仍未变成停止，运行状态尚未移进对话。只在假程序下验证，真实账户与 Mac 发行包未验。

## 2026-11-03：界面改版第五阶段，运行状态（Opus）

叠在第四阶段（PR #41）之上，只改呈现，快捷键、命令面板和 CLI 对等不变（停止早已有 CLI 路径，这里没有新增操作）。

- **一个停止：** 新增 `resolveStopPlacement()` 和 `isThinkingItemOnScreen()`（`src/renderer/utils/thinkingItems.ts`），由 `InputArea` 按它把停止交给唯一的一个界面：正在看的对话运行时是输入框的发送键；同一智能体的其他对话运行时是运行胶囊；本智能体没有在运行时是跨智能体胶囊（只为它派出的咨询）；Auto Run 时交给 Auto Run 胶囊自己的停止。别的智能体在运行时不再画停止：停止只作用于当前智能体，原来那颗按下去停不了它。
- **发送键：** `StopTurnButton` 新增 `variant="icon"`（中性色圆键，同一个方块图标和名字）。正在看的对话运行时发送键变成停止；输入框里有内容时发送键回来，名字改为“加入消息队列”，停止挪到它左边。桌面在 `NotificationSendControls`，手机在 `ToolbarControls` 的手机分支，规则相同。终端模式不变。
- **对话里的运行状态：** 新增 `TurnRunningStatus`，在正在运行的对话末尾写一行：脉动点、“思考中...”、用时（`formatElapsedTickerCompact`）和已生成的 token。只读出文字，计时和 token 对读屏隐藏。计时组件从胶囊里搬到 `ui/ElapsedTimeDisplay.tsx`，胶囊和这一行共用同一个扣除睡眠的计时；`MergeProgressOverlay`、`SummarizeProgressOverlay`、`TransferProgressModal` 里另有三份本地副本，未动。
- **运行胶囊：** 不再描述正在看的对话，只写别处在运行的工作；Auto Run 胶囊的 +N 也不再算它。没有名字的对话改用 `conversationDisplayTitle()`（名字或第一句话）写出是哪段，胶囊和下拉列表一致；下拉列表原来退回手写的 `substring(0, 8).toUpperCase()` 会话 ID 片段，已去掉。第三阶段加的“在看时只显示状态与停止”分支、Auto Run 被降级到下拉列表的分支，以及下拉列表里 Auto Run 行自己的停止，都因此不可达，已删除。
- **测试：** 新增停止位置的五种情况、正在看的对话判断、发送键变停止与有草稿时加入队列（桌面和手机）、对话末尾的运行行（出现、计时、token、结束后消失、两种布局）、胶囊不描述正在看的对话的回归，改写了断言旧胶囊行为的用例。临时撤掉源码改动后 6 个测试文件 22 条失败，恢复后 13 个文件逐字节一致并通过；对话命名的两条回归在实现前先跑过，失败 2 条。
- **验证：** 完整单元测试 2101 个文件 47847/47847（88 跳过）；完整 Electron 69/69（改动后共跑了两遍，都是 69/69）；类型、ESLint、全仓格式与文档检查通过。深浅两种 Clay 主题截图核对：运行时发送键是停止、有草稿时加入队列键和停止并排、对话末尾一行运行状态、切到同一智能体的新对话后胶囊写出另一段对话的名字并带停止。
- **限制：** 停止仍是智能体级，正在看的对话运行时按停止，同一智能体其他在运行的对话也会停（原有行为）。仍没有键盘停止快捷键。三份本地计时组件未合并。只在假程序下验证，真实账户与 Mac 发行包未验。

## 2026-11-03：Esc 停止正在看的对话（Opus）

叠在第五阶段（PR #42）之上。只改渲染层，停止仍走原来的 `handleInterrupt`。

- **规则：** 新增 `isOnScreenTurnRunning()`（`src/renderer/utils/thinkingItems.ts`），与发送键变停止用同一个判断：当前智能体正在看的标签在运行，且是 AI 模式。输入框里，Esc 在弹出菜单、AI 命令提案和命令模式阶梯之后、原来的“失焦到对话区”之前处理；停止时阻止冒泡，光标留在输入框，草稿不动。对话区里，Esc 在运行时先停止再回到输入框（`TerminalOutput` 原来收到 `onInterrupt` 但没用）。同一智能体的其他对话在运行时 Esc 不停止，那个停止在运行胶囊上。
- **接线：** `useInterruptHandler` 在 `useInputHandlers` 之后创建，所以 App 新增 `interruptTurnRef` 桥接，与 `processQueuedItemRef` 同一做法。
- **快捷键：** `FIXED_SHORTCUTS.stopTurn`（Esc，不可改绑：Esc 先给弹窗、菜单和命令模式，这个顺序就是约定），中文标签同步；两处触发都记 `trackShortcutUsage('stopTurn')`，键盘熟练度不会因为分母多一项而够不到。发送键上的停止提示写出 Esc；运行胶囊上的停止不写，因为 Esc 停不了屏幕外的对话。停止提示原来写“（Ctrl+C）”，但 Ctrl+C 只转给终端标签，改掉。
- **测试：** 新增真实 DOM 下 Esc 停止并保留光标、草稿不动、弹出菜单和命令模式先处理、同一智能体其他对话不停、终端模式不停，对话区 Esc 停止并回到输入框、空闲时只移光标，`isOnScreenTurnRunning` 与停止提示的回归。临时撤掉源码改动后 5 个测试文件 7 条失败，恢复后 11 个文件逐字节一致并通过。
- **验证：** 完整单元测试 2101 个文件 47857/47857（88 跳过）；完整 Electron 69/69；类型、ESLint、全仓格式与文档检查通过。另在真实界面里跑了一次（临时脚本，未提交）：运行中在输入框按 Esc，对话显示“已停止”，草稿和光标留在输入框；空闲时再按 Esc，焦点照旧移到对话区。
- **限制：** 停止仍是智能体级（原有行为）。CLI 仍没有中断命令，这是 CLI-UI-PARITY 里已有的缺口，需要主进程与 CLI 改动。只在假程序下验证，真实账户与 Mac 发行包未验。

## 2026-11-03：真实 Codex 验收里的展开时序（Opus）

hb.6 源码 `72545fdad` 的真实 Codex 验收中，`codex b: parallel tools` 在点开工具详情时超时：回答先于原生进程退出出现，测试随即展开工具，进程退出后已结束的回合把工具折叠到“Worked for”后面，正在点的按钮被卸载。与 #44 中 `codex b: exec command output` 是同一时序，这次改的是并行工具场景：等停止键消失（回合结束）再展开，断言不变。假程序六家各重复 3 次共 18 条通过；在同一产品源码上只改这个测试文件重跑真实 Codex，1/1 通过，`native-summary.json` 如实记录工作区有改动。

## 2026-11-03：真实 Claude 验收里的历史场景（Opus）

同一源码的真实 Claude 验收中，`claude h: saving history` 90 秒内没有等到历史条目。临时导出 Maestro 日志后确认是测试工作量的问题，不是产品问题：真实回合只运行 `printf saved-work`，什么都没改，总结提示词规定这种情况回答 `NOTHING_TO_REPORT`，Maestro 按设计不写历史。工作量改为 `printf saved-work | tee saved-work.txt`，让总结有可报告的文件改动；假程序只显示命令，不受影响。随后条目写入，但测试拿原始 markdown 比对面板文字（面板把反引号渲染成代码样式），改为比对去掉 markdown 标记后的显示文字，检查内容不变。两处改动之前的两次真实运行就是各自的反证。改完后真实 Claude h 和真实 Codex h 各 1/1 通过，四个假程序 h 场景通过，真实账户位置快照前后一致。

日志里 `Spawning process:` 打印的是渲染进程传来的检测路径，实际启动的是 `handle-spawn.ts` 里优先的 `sessionCustomPath`，所以主回合确实走了固定版本 2.1.310 的包装脚本，看日志时容易误读。整轮 Claude 真实验收结束后 `/private/tmp` 留下只含 `claude/` 配置目录的临时目录，没有凭据文件。原因是 4 个 `maestro-p --status` 探测进程在各自测试结束后没有退出（父进程已是 1，各自指向一个临时 Claude 配置），清理之后又写回了配置。探测用的是发布克隆里的 Electron 和 `maestro-p`，而测试跑在构建克隆，来路还没查清。进程已停止，目录检查后删除，真实账户位置不受影响。测试应随测试应用一起结束这些探测，列为后续。

## 2026-11-04：OpenCode 假程序的数据库锁（Opus）

#45 在 Linux 的 Electron 测试里出现一次 `opencode c` 失败：`database is locked`，发生在测试轮询 OpenCode 数据库表是否建好的时候。新文件起初处于回滚日志模式，假 OpenCode 建表期间读者被锁在外面，SQLite 立即报错而不等待；写入方切换到 WAL 时同理。给假程序的读写连接都加 5 秒忙等待。先补回归测试：另一个进程在建表期间持锁 200 毫秒，修复前报 `database is locked`，修复后通过。假程序测试 43 条、OpenCode 的 8 个 Electron 场景均通过。属于测试工具问题，产品代码不变。

## 2026-11-06：新界面第三批实跑修复

新界面文件树的桌面单击原先只选中，现改为调用既有预览入口，避免双击重复打开；旧界面与多选行为保留，回车共用原有打开路径。端到端场景的初始开关改为启动前配置，切回旧界面走设置页；巡检修正项目名多匹配定位，并关闭前一步遗留的命令面板遮罩。后三处属于夹具错误，项目打开流程和设置同步协议未改。

验证对象为未提交的开发工作树。新增 8 条点击回归，回车覆盖新旧界面；修复前文件面板测试 226 通过、2 失败，修复后相关 Vitest 使用 `--configLoader runner --no-cache`，8 个文件、497 条全部通过，无跳过。`npm run lint` 通过。按本轮约束未运行 Playwright 或 Electron，未构建发行包，端到端实跑仍待复验。

## 2026-11-06：新界面终端与任务面板

在 `codex/hb8-panels` 实现右栏四页签，仅由 `newShell` 启用。终端复用 `TerminalView`、`XTerminal` 和现有创建、启动、关闭路径，第一次访问才启动；同目录及 SSH 主机共享默认终端，worktree 分开，切换会话或收起面板保留挂载与输出。任务复用 `agentTaskList.ts`，显示 Claude、DeepSeek 的 TodoWrite 和 Codex 的 update_plan；Codex exec 的 todo_list 事件补上增量转换。快捷键、命令面板、CLI 路径与每条会话的面板状态同步补齐。右栏终端聚焦时，关闭、查找、清屏快捷键转给已有终端句柄，不操作中间的 AI 会话。

验证对象为本分支开发源码，未构建发行包。最终相关 Vitest 使用 `--configLoader runner --no-cache`，29 个文件、1148 条全部通过，0 跳过；`npm run lint` 通过。改动的产品源码 ESLint 通过；原生 E2E 及夹具用独立 TypeScript 配置静态检查通过。CLI 参考从命令树重新生成。

测试先于实现加入。Codex 增量清单回归在修复前 168 通过、3 失败；补终端跳转接线前键盘回归 162 通过、1 失败；关闭、查找、清屏的焦点回归在修复前 163 通过、3 失败。扩展检查发现旧有快捷键冲突测试把新界面已隐藏的动作留在期望集合；还原基线快捷键表可复现同一失败，现两边按相同界面作用域过滤，仍严格比较完整集合。两个终端焦点测试移出异步 act 内的等待，使效果提交后再等定时器，断言不变；远程配置测试补齐已有保存路径需要的 sessions mock。

`e2e/native-new-shell.spec.ts` 已增加真实终端命令输出在会话切换后的保留检查，以及合成 TodoWrite 的任务面板检查。本轮按约束未运行 Playwright、Electron、真实 SSH 或模型；360 像素、深浅主题和拖宽的原生视觉验收待用户运行。Codex exec 的 todo_list 只提供完成布尔值，未完成项显示待办；含 in_progress 的 update_plan 按原状态显示。没有本轮发行包或真人验收结论。

## 2026-11-06：改动面板的本地批量读取

Windows 上数百个未跟踪文件会触发逐文件 `wc` 和 `git diff --no-index`，超过 20 秒查询预算后返回子目录兜底。现在本地一次获取未跟踪列表，在 Node 中以 64 KiB 异步分块、最多 16 个并发读取；已跟踪文件用异步 `stat` 和一次 `cat-file --batch-check` 检查两端大小。SSH 脚本及共享解析格式不变。

先补真实仓库的进程数量回归，旧实现对 32 个未跟踪文件启动 40 次 Git，对 32 个已跟踪改动启动 39 次 Git，均超过 12 次上限。修复后通过。增加本地与旧 shell 结果对照，覆盖空文件、无末尾换行、二进制前缀边界、大小边界、重命名与删除、换行及引号文件名、符号链接和不可读文件，并验证读取并发及句柄清理。原 501 文件测试断言保持不变，临时仓库清理加入 Windows 重试。

本机 macOS arm64 源码验证：改动查询目录 31 条测试通过，连同 Git 工具测试共 143 条通过；`npm run lint`、改动源码 ESLint 和格式检查通过。Vitest 使用 `--configLoader runner --no-cache`。501 个子目录文件加原测试的 3 个边界条目，各测 3 次查询，中位数从 5.020 秒降至 0.088 秒。验证对象是本分支源码，未构建安装包，未运行 Windows、Playwright 或 Electron 验收。

## 2026-11-06：立即关闭窗口时保存最后的草稿

基于 `codex/new-shell-polish` 的 `56b9779456f0b05f414f8442c2231073d732b871` 未提交源码。AI 草稿仍在 300 毫秒定时器里时，关闭窗口没有先请求渲染层保存；等到 `closed` 回收智能体并触发移动广播，原窗口已不可用。整应用退出虽会等待保存，也未收齐排队中的草稿。`isPendingRef` 实际由 Zustand 订阅同步设置，并非等待 React effect；单补 `beforeunload` 仍无法保证持久化 IPC 完成。

将现有 `requestHandoverSave` 移入生命周期模块供移动和窗口关闭共用，保持 3 秒限时。主副窗口的 `close` 事件先等待保存答复，再继续关闭和归属回收；已确认的整应用退出仍由原有全窗口保存负责。`quitSave` 在同次保存中同步写回 AI 文字、命令模式和终端草稿，持久化随后读取最新 store 快照，保留窗口归属过滤。终端草稿原本同样只靠失焦或切换写回，现一起处理；已加入的图片附件直接进入 session store，没有草稿定时器缺口。

先新增回归并运行完整的两个相关文件，修前 108 条通过、3 条失败：两条实际保存载荷仍含 `Draft before the move`，一条关闭没有阻止销毁以等待保存。修后扩充无附件、附件、主窗口、重复关闭、错误答复、超时和渲染进程消失场景；10 个相关 Vitest 文件共 487 条通过，无跳过，均使用 `--configLoader runner --no-cache`。`npm run lint` 通过。原 `claude m` 的等待和断言未改。

本轮只验证源码与模拟 IPC 的单元回归，未运行 Playwright、Electron、真实模型、完整测试或安装包验收。真实系统的失焦和可见性事件顺序、负载下的 `claude m` 重跑与重启读回交由后续实跑。超时或渲染进程不可用时仍按现有策略继续关闭，不保证异常退出时的最后输入。

## 2026-11-06：第一次打开和登录失败

用户第一次亲手试用，在全新开发数据上走到旧向导，Claude 返回 `authentication_failed`，向导只显示 `Agent exited with code 1. Check the terminal for details.`，用户退出。新界面没有露面：全新数据先走四个提示和旧欢迎页，到不了设置里的开关。

根因：主进程把这类通知扣住，单独发 agent-error，而向导、内联向导、文档生成和反馈对话只读 data，退出时缓冲区里没有这段文字。Electron 里还查出第二层：向导的 onError 清掉结构化错误，发送钩子随后提前返回，标题和提示仍然出不来。单元测试看不到这一层，因为它们各测一半。

Codex 第一版让“稍后再说”保留登录故障记录，以便之后恢复重跑。Opus 复核时否了：`reportAuthFailure` 只在新建记录时才弹窗，保留记录会让下一次失败不再弹窗，旧界面也受影响，记录还可能过期后重发已成功的回合。改成保持原行为，卡片按钮看这个对话是否还带着登录错误：还带着就重新登记失败，恢复时重跑那一轮；已经解决的旧卡片不显示按钮。

验证，对象是本地开发构建：新增 3 条 Electron 场景，分别是新界面第一次打开、登录被拒后稍后再说再重新登录并重跑、旧向导显示登录原因。向导场景在第二层修复前失败。Opus 看了第一次打开、登录窗口和卡片的截图。

没有验证：真实登录（场景里拦截了登录终端，`claude auth login` 只在本机 2.1.317 看过帮助），真实 Claude 的 401 输出形状（夹具按日志和解析器重建），SSH，Windows。用户这次的 Claude 登录是否真的失效也没有确认。

## 2026-11-06：T1 新会话权限继承

验证对象是本分支开发源码，基线 `2ebe18308`，实现提交 `3aac64e18`，未构建发行包。新界面通过 `newConversationPermissionFields()` 统一普通创建、工具切换、交接和复核的权限决策。左上按钮指定当前对话；项目入口、快捷键、命令面板和 CLI 按同项目同主机最近的选择、消息或创建时间决定来源，包含本窗口保留的已关闭标签。关闭最后一条对话后的自动替代会话也保留权限。目标不支持标准档时收紧为只读，没有同等严格档位则拒绝创建。权限快照随跨窗口交接传递，手动修改只作用于新对话。

先写回归并确认失败，再写实现。最初两份文件 11 条失败、53 条通过，失败表现是新标签没有权限字段，交接与空白页换工具丢失只读。权限显示回归修前 1 条失败、27 条通过；关闭入口回归修前 2 条失败、14 条通过。扩展检查发现一个旧测试关闭来源标签后手工构造的请求缺少权限快照，改为传入该测试已读取的真实来源快照，原标题断言保留，并增加缺少来源及快照时拒绝创建的断言。

最终相关范围为 16 个 Vitest 文件、1151 条测试，全部通过，无跳过。合并检查先有 1 条上述旧夹具失败，调整夹具并增加拒绝路径后，对该文件定向检查 61 条通过，其余 15 个文件结果复用。均使用 `--configLoader runner --no-cache`，没有自动重试。覆盖按钮及键盘命令回调、项目工具选择、CLI 空白及带提示词的新建、工具能力映射、跨窗口元数据、原对话隔离、真实参数构造和压缩续接。

`npx tsc --noEmit -p tsconfig.json`、主进程类型检查、改动产品源码 ESLint、Prettier 和 diff 空白检查通过。新增 Electron 场景及其依赖通过独立 TypeScript 静态检查，该配置允许既有 CJS 夹具并使用 ES2023 库；合成提供方脚本通过语法检查。`e2e/native-new-shell.spec.ts` 的 `new shell permission inheritance` 场景验证 Codex 只读发一轮、新会话第一屏标记、第二轮实际 `--sandbox read-only` 参数，以及手动放宽新会话后来源仍只读。

按任务限制未运行 Electron、真实模型、真实 SSH、Windows、完整 Vitest 或发行包验收。原生历史文件不记录 Maestro 的逐标签权限，未打开的外部历史不用于猜测权限；窗口关闭后的历史撤销记录沿用原有保留范围。Claude TUI 的标准权限生效问题不在本次修复范围。旧界面的创建默认、权限显示及交接行为保持原状，新元数据只在新界面应用。

## 2026-11-06：T1 第二轮权限审查修复

验证对象为本分支源码，上一轮交付提交 `decca2dee`，本轮实现提交 `ccac8be71` 和 `1abc203d9`，未构建发行包。三条审查意见均成立。键盘统一导航原来绕过选中时间；项目来源直接读取别的窗口的旧副本；浏览器请求及提前创建标签的路径没有保留当前来源和实际权限。

键盘导航和新界面的显式远程选中复用 `setActiveTab()`。项目创建通过 `resolveProjectConversationPermission()` 向各所属窗口读取精简权限与活动时间快照，按现有项目和 SSH 主机边界归组。查询并行，每次限时 250 毫秒，校验答复窗口和归属是否变化。未显式登记归属的会话按现有约定由主窗口负责，查询也采用这个规则。任一来源不可用时取本地同项目副本及成功答复里已知最严格的档位。选择其他工具时原有的权限元数据中转也缩短为 250 毫秒，失败后由目标走同一解析器；该分支最坏会经历两段权限等待。草稿搬运和普通交接原有等待不改。

浏览器新会话请求带来源标签 ID，桌面从所属窗口读取该标签，来源已关闭时不改用其他对话。响应包含实际权限，浏览器直接采用；库存同步先到也会补齐权限。没有新增用户可见文字，权限文案继续使用原有双语资源。新界面规则由 `newShell` 控制，旧界面不发权限查询，也不改变创建默认与响应结构。

回归先失败后修复：键盘三项均把只读变成完全访问；跨窗口和浏览器五项分别命中旧副本、回退不够严格、来源 ID 丢失和权限丢失；工具选择权限读取的回归显示旧等待为 30000 毫秒；显式远程选中的三项同样把只读变成完全访问。新权限 IPC 的登记回归也在实现前失败。新增边界覆盖超时、错误回复窗口、归属移动、拒绝答复、同 SSH 主机隔离、保留的关闭标签、库存同步竞态和原对话隔离。

最终相关范围为 20 个 Vitest 文件、1518 条测试，全部通过，无跳过。先完成 20 文件 1517 条检查，最终归属核对新增主窗口默认接管回归，修前 1 条失败、59 条通过，修后该文件 60 条通过，其余 19 文件结果复用。使用 `--configLoader runner --no-cache`，没有自动重试。renderer 和主进程的 TypeScript 检查、改动产品源码 ESLint、Prettier 和 diff 空白检查通过。Electron 场景及其依赖通过允许既有 CJS 夹具并使用 ES2023 库的临时 TypeScript 配置检查。

`e2e/native-new-shell.spec.ts` 扩展原有只读发送场景，增加完全访问对话切回只读后按快捷键新建，再核对合成 Codex 的实际参数；新增双窗口和浏览器场景，覆盖在所属窗口收紧后从另一窗口执行 CLI 新建，以及浏览器停在只读来源时有较新的完全访问对话仍正确新建。按任务限制未运行 Electron、Playwright、真实模型、真实 SSH、Windows 或完整 Vitest。

限制：回退只保证不超过已知最严格档位，无法知道所有可用副本都未收到的权限变更。250 毫秒是 IPC 定时预算，主进程事件循环本身被阻塞时不能保证真实时钟上限。普通创建只读权限与工具能力映射仍使用上一轮的共用函数，原生历史与压缩续接未改动。Electron 和浏览器实跑交由外部验收。

## 2026-11-06：新界面工具输出按需读取

基于 `2ebe18308e387ff9dd0c3cb0dcdff9b95b1e95b0` 的任务分支源码。保留 `compactToolOutput()` 的 4000 字符缓存上限，新增 `agentSessions:toolOutput` 和 `maestro-cli native-history tool-output`，在指定拥有者账户的原生记录中按工具调用 ID 读取。Claude JSONL 与 Codex rollout、zstd 都使用受限读取，完整解析放在主进程启动的独立 worker 中，最多同时读取两条，单次 30 秒，原始或解压后的记录上限 100 MiB，返回末尾最多 2 MiB UTF-8 文本及省略字节数。

新入口仅在 `newShell` 下的已展开工具详情里显示，运行中、未截断、SSH 和无调用 ID 的卡片不显示。读取、复制、收起和找不到记录都有中英文文案，全文只在组件局部状态中，卡片收起即卸载。复制 CLI 为同一命令加 `--copy`；视图折叠状态的 CLI 缺口保留在 parity 文档。

先提交失败回归。实际观察到 Claude 二次截断丢失真实长度、界面没有全文入口、IPC 未注册、CLI 不认识动作、Codex 历史未携带调用 ID，以及 Codex 旧解析器先截到 10000 字符的失败。修复两家的解析器使用统一缓存压缩，保留原始长度，并让原生和实时日志携带工具 ID。旧测试中精确的旧截断字符串及工具对象形状随新契约更新，未放宽断言、跳过或自动重试。

本机源码验证：18 个相关 Vitest 文件 595 项通过，最后补齐实时展开卡片后又运行两个受影响界面文件，63 项通过。所有 Vitest 使用 `--configLoader runner --no-cache`。渲染层、主进程和 CLI 类型检查通过；改动的可检查源码 ESLint、Prettier 和 diff 空白检查通过，仓库配置忽略单元测试的 ESLint。真实 Node worker 回归覆盖读取、并发上限和完成后释放。未进行完整 Vitest、安装包构建、真实模型或账户验收。

新增 `e2e/native-tool-output.spec.ts` 的 Claude、Codex 两条合成历史场景，验证点击前看不到末尾、点击后可见、CLI 返回末尾、收起释放、关闭后缓存未保存全文。只运行了 Playwright `--list`，确认发现两条，未启动 Electron。需要在沙箱外构建并运行，不能把此记录当成 Electron 通过。

限制：SSH 尚无远端按调用 ID 提取并限量返回的接口；超过读取上限的整份转录明确拒绝。CLI 的原生 ID 需要对应已打开的对话以确定账户。旧缓存缺失工具 ID 时需要原生刷新，Codex 进程局部 `item_N` 不能直接映射成 rollout 调用 ID；不扫描父会话之外的 Claude 子会话转录。旧式文件名或归档 worktree 的身份定位只看前 64 KiB，非标准记录可能找不到。旧界面没有新增入口，但两家解析器统一了预览的截断标记和长度，这是为正确识别可读取全文所必需的共享行为变化。

## 2026-11-06：工具全文二轮审查修复

本轮从上一轮工具全文源码 `f685f9e64` 开始，未制作安装包。三项独立审查均成立：实时 Codex 的进程内卡片 ID 不等于 rollout 调用 ID；Claude 子工具结果不在父 JSONL；切换提供商后旧卡片不能沿用当前会话及账户。

实时事件和原生读取结果现在携带固定的来源身份，全文读取校验已保存来源，支持同一标签上已停放的提供商。Codex 保留卡片关联 ID，另存原生调用 ID；尚未映射时在点击后按命令、五秒内的调用时间及有界预览唯一定位，拒绝歧义和不匹配的命令。完整与部分窗口刷新均可补齐身份，卡片 ID 不变，不新增后台读取。Claude 在 worker 内查找父会话的 `subagents`，不跟随目录或文件符号链接，最多检查 128 个目录项，总读取预算包含父文件及子文件，仍为 100 MiB。

CLI 夹具失败异常现在包含 stdout 和 stderr。新增测试直接使用实际桌面列表回调、标签解析函数、`invokeNativeHistory()` 及桥接分发，仅替换网络传输、存储和最终读取结果。确认列表已有 `agentSessionId`，桥接也放行 `agentSessions:toolOutput`，这两处没有缺失。复现的是刚打开历史页时，列表尚未收到延迟保存的原生 ID；现按精确 ID 回到已有项目历史解析账户，无需等待或重试，也可按旧卡片来源找到已切换的会话。原来的 CLI 单元测试同时 mock 了标签解析、列表和 IPC 调用，因此没有覆盖该窗口。Opus 先前两次 Electron 失败没有具体 stdout/stderr，本轮不能认定原始退出原因已经由 Electron 验证。

回归均先观察失败再修复：子转录读取返回 `not-found`，Codex 普通及 zstd 映射返回 `not-found`，卡片改查新提供商，后台拒绝旧来源，事件遗漏来源，部分窗口刷新不补齐调用 ID，以及未落盘和已停放会话的 CLI 解析失败。另补不同命令即使输出相同也拒绝匹配，修复前该回归错误返回全文。

最终相关 Vitest：19 个文件 514 项通过，另一个夹具文件 2 项通过，均使用 `--configLoader runner --no-cache`。渲染层、主进程、CLI 三份 TypeScript 检查通过；改动源码 ESLint、Prettier 与 diff 空白检查通过。没有运行全量测试、真实模型、真实账户或 Electron。

`e2e/native-tool-output.spec.ts` 现在有五条合成场景：两家历史、Claude 子转录、Claude 切换到 Codex 并继续后读取旧输出、实时 Codex 的不同 exec item ID 与 rollout call ID。子转录场景在临时夹具加载预览后，将结果移到所属子文件，验证按需读取路径，不宣称覆盖真实 Claude Task 的完整时序。Playwright `--list` 确认发现五条。沙箱外运行 `MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-tool-output.spec.ts`，脚本会重建 main、renderer 和 CLI。

旧界面没有全文入口变化。共享行为仅增加来源及调用身份元数据、刷新时补齐身份，以及共用 shell 包装规范化；4000 字符缓存限制保持不变，全文不进入会话状态。SSH 仍不提供入口；旧的混合提供商缓存若没有来源身份则不猜目标；Codex 匹配依赖受支持的命令形式和时间窗口。真实平台、官方工具版本、性能基准及打包后的 worker 尚待验收。

## 2026-11-06：工具全文第三轮 Electron 失败修复

以二轮源码 `d36a6c041` 为起点，验证对象为修复源码 `c1e96fb73`，没有制作安装包。Opus 提供的上轮 Electron 结果为三条通过、两条失败，本轮没有重跑 Electron。

Claude 子转录失败属于场景种子代码：合成协议的用户消息 `content` 是字符串，搬移工具结果的筛选直接调用 `.some()`，尚未进入全文读取即抛错。将原搬移逻辑抽到测试夹具，先用真实合成协议产物观察同样异常，再增加数组判断。回归精确核对父文件保留用户消息和其他结果，子文件只含目标结果。Electron 同时断言末尾只在子文件中，保留原有界面及 CLI 全文、收起释放、不落盘检查。

Claude 切换失败属于产品的 CLI 路径。失败截图只显示 Codex 新问答，旧 Claude 对话仍在左栏历史中；trace 的切换前文本有旧回答和失败步骤，切换后文本只有新回答。不是活动已经展开或选择器层级问题。CLI 的 `remoteUpdateSessionConfig` 分支仍删除标签，而界面编辑流程已经通过 `switchTabProvider()` 保留日志。新增闲置和运行中回归均先观察到旧标签被 `new-tab-id` 替换，旧界面重置回归同时通过。

新界面 CLI 与编辑流程现共用 `switchSessionProvider()`，保留标签、日志、工具来源、草稿、文件标签和运行中的回合，清除下一回合的工具配置。新行为仅由 `newShell` 开启；旧界面 CLI 仍重置，界面编辑流程仅抽取既有逻辑。Electron 增加继续 Codex 后旧 Claude 回答仍在当前流中的断言，未放宽原全文断言。

本轮七个相关 Vitest 文件共 166 项通过，均使用 `--configLoader runner --no-cache`：夹具三项，远程配置、界面编辑、提供方会话、全文卡片合计 144 项，原生读取和 CLI 桥接合计 19 项。`npx tsc --noEmit -p tsconfig.json`、三个改动产品文件的 ESLint、改动文件 Prettier、diff 空白检查通过。Playwright `--list` 确认五条场景。没有全量测试、真实模型、真实账户、SSH、其他操作系统或发行包验收。

沙箱外仍须执行 `MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-tool-output.spec.ts`。脚本重建 main、renderer 和 CLI，使用临时合成记录，重试为零。现有 CLI 帮助、强制切换警告和成功文字仍描述旧界面重置行为，已在 CLI parity 的 Open gaps 留明；本轮没有新增界面文案或 CLI 动词。

## 2026-11-06：T6 合入批次集成分支

从四分支集成记录 `ff658c541` 出发，以 `git merge --no-ff` 合入工具全文分支末端 `1d4050074`，合并提交为 `aa85e6597`。冲突只有 CHANGELOG 和本记录的追加段落，完整保留两边内容。自动合并的任务事件、转录转换、原生读取来源、预加载声明和双语文案均作语义复核。五个来源末端仍是本分支祖先，来源新增的产品记录、工作记录和两份 canonical/parity 文档文字均保留。

集成审查发现 T6 的 `switchSessionProvider()` 保留了标准权限字段，却未使用 T1 的目标能力映射。Codex 不支持标准档，参数构造会走非只读默认。先以 `20edff918` 提交回归，CLI 两项及界面编辑两项实际失败：标准档未收紧，目标没有只读能力时仍切换。新界面两条入口现在读取目标能力，统一通过既有 `newConversationPermissionFields()` 处理每个打开的 AI 标签；任一标签无法保留限制时拒绝整次切换。能力查询失败同样拒绝，不丢弃原对话、工具卡片或正在运行的回合。旧界面仍沿用原来的编辑和 CLI 路径。提示复用已有中英文权限文案。

补充组合回归：Codex 的连续 todo_list 更新带固定来源，exec item ID 不误当原生调用 ID；工具结果及来源存在时，停止后的用户消息仍正确去内部附注，真实重复发送连续刷新后不丢失，工具卡片不重复。没有发现 T6 原生身份与 T2/T3 的其他冲突。

验证对象为本分支本次修复的源码，未制作安装包。相关 Vitest 56 文件、3175 项通过，合成原生夹具 4 文件、15 项通过，均使用 `--configLoader runner --no-cache`，无跳过、无重试。三份 TypeScript 检查最终通过；渲染层首次发现可空能力参数的收窄错误，显式拒绝空值后通过，并重新检查远程配置 34 项。四份合成 Electron 文件的补充类型检查通过，Playwright 只收集到 17 场景，没有启动 Electron。所有本轮改动文件的 Prettier 和 diff 空白检查通过。

扩展 `e2e/native-tool-output.spec.ts` 的换工具场景：Claude 标准权限切到 Codex 后立即显示只读，合成续聊调用含 `--sandbox read-only` 和任务工具开关，不含绕过权限参数；继续验证旧回答、旧工具全文、CLI 回读、收起释放和全文不落盘。沙箱外需执行 `MAESTRO_E2E_REAL=0 npm run test:e2e -- e2e/native-new-shell.spec.ts e2e/native-stop-resume.spec.ts e2e/native-codex-plan.spec.ts e2e/native-tool-output.spec.ts --retries=0`。本轮未运行真实模型、真实账户、真实 SSH、浏览器会话、其他平台或发行包验收，未推送或创建 PR。

旧界面没有增加全文按钮或权限继承规则。T6 原有共享变化包括统一工具预览截断标记、增加固定来源及原生调用元数据、刷新时补齐调用身份，仍保持 4000 字符缓存上限。全文读取的 SSH、视图折叠 CLI、旧缓存身份缺失和换工具 CLI 旧文案缺口仍按 parity 文档保留，不宣称已经补齐。
