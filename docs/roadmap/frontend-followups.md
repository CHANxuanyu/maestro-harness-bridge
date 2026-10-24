# 前端第二阶段计划

状态：待用户审阅。2026-10-24 起草，由原生 Claude Code Opus 实施。

后端第二阶段已经随 PR #4 合并（合并提交 `6a0ddcc`），交接契约见[后端第二阶段计划](backend-followups.md#完成记录)。本计划接手其中需要前端消费的部分，以及[对话信息流改造记录](conversation-feed.md)、hb.4 验证记录和 Issue #1 遗留的前端事项。每项依据都已在 `6a0ddcc` 的代码中确认。

## 工作清单与验收目标

### 1. 运行中命令的实时输出

- **依据：** 后端现在会推送运行中命令的累计输出：同一调用 ID 的 `running` 事件携带 `toolState.output`，渲染层按 `tool-${id}` 合并进同一条记录。但界面不会更新：`LogItem.tsx` 的 memo 比较只看 `toolState.status`，`sameSubagentLogs()` 也只比较 id、文本和状态；运行中只有输出在变，所以命令结束前都不会重渲染。另外 `ToolCallDetails.tsx` 的结果块固定 20rem 高度、内部滚动，输出超过一屏后用户停在开头，看不到最新输出。
- **做法：** 在渲染链的比较函数里加上 `toolState.output`，包括 `LogItem` 自身、`sameSubagentLogs()`，以及折叠行传入子行时用到的比较。工具仍在运行时，结果块用规范工具 `useStickToBottom()` 跟随最新输出，用户上滚后松开。不改折叠规则，不新增卡片样式。
- **验收：** 用合成事件序列驱动同一调用多次运行中更新：展开的结果块逐次更新并贴底；用户上滚后不被拉回，滚回底部恢复跟随；完成后的状态和最终输出正确，没有重复卡片。运行中的回合仍保持展开（既有规则）。

### 2. 历史消息的模型与思考等级

- **依据：** `SessionMessage` 现在带原生 `model` / `effort`：Codex 的正文、推理、工具消息都带；Claude 只带 `model`；用户消息不带。`transcriptMessagesToLogEntries()` 还没有映射，消息信息里历史回复仍显示“未记录”。另有一个混用问题：实时回合的 `turnModel` 来自 `customModel`，可能是别名（如 Claude 的 `opus`）或缺省；原生值则是完整模型 ID。两者相邻时，`computeTurnSettingChanges()` 会把“别名对完整 ID”误报成换了模型。
- **做法：** 在 `transcriptMessagesToLogEntries()` 把原生值映射到 assistant 侧条目的 `turnModel` / `turnEffort`。给条目记录来源（发送时打的戳，或原生记录），`computeTurnSettingChanges()` 只比较来源相同的两个值。合并时沿用 `withRendererFields()` 的规则，实时戳优先。缺省保持缺省，不用当前设置补。
- **验收：** 重新打开的 Codex / Claude 历史，在消息信息里显示原生模型（Codex 另显示思考等级）。同一来源内中途换模型，只在第一条新回答处提示一次；实时别名与历史完整 ID 相邻时不误报；没有记录的仍显示“未记录”。

### 3. 对话布局的未读计数

- **依据：** `useTerminalOutputScroll.ts` 用显示行数的差值计未读（`filteredLogsLength`）。回合结束后过程折成一行，行数变少，已读基线反而大于当前行数，计数被清零或偏小。hb.4 把这记为已知取舍。
- **做法：** 只改对话布局：按行 ID 记住读到的位置，只把之后新出现的用户消息和回答（`isFeedReplyRow()`）计入未读；工具、进度、推理不计，折叠和展开都不改变计数。智能体布局保持现状。
- **验收：** 上滚阅读时，新回答和新消息使计数增加；回合结束折叠后计数不减少；回到底部清零；切换页签再回来计数正确；第 5 项自动刷新追加的内容同样计入。

### 4. 对话布局下的“显示工具调用”开关

- **依据：** `TerminalOutput.tsx` 用 `toolsVisible || readingColumn` 决定工具行，对话布局下这个开关实际不起作用，但设置页（`ThinkingModeSection`）照常显示，用户切了没反应。
- **做法：** 不给它新增行为。对话布局下，设置页把该开关标为不适用，并说明工具调用已收进每轮的折叠行；中英文案都加。智能体布局不变。
- **验收：** 对话布局下开关显示为不适用且有说明；智能体布局下行为不变；设置搜索仍能找到这一项。

### 5. Claude Code 自动刷新的阅读体验

- **依据：** PR #4 让 Claude 会话也像 Codex 一样后台跟随，只更新 `logs`，不改阅读位置和未读字段。Codex 跟随时的前端行为（外部更新不抢位置、在底部时跟随）此前已经验证过。
- **做法：** 沿用 Codex 已验证的规则，补 Claude 的回归。只有发现 Claude 特有的差异才修改，例如工具结果后到时应该更新已有卡片，而不是新增一行。
- **验收：** 在底部时新内容自动可见；上滚时位置不动、未读按第 3 项增加；草稿、队列和其他页签不变。

### 6. 历史摘录的显示

- **依据：** Codex 页签以及 Claude TUI / Dynamic 的历史条目，现在是该轮最终回答的首段（最多 500 个字符），不是模型写的摘要，也没有持久化的来源字段。
- **做法：** 不加区分标记。内容就是回答原文，不会误导；要区分得先扩展历史存储契约，收益很小。只检查历史列表和详情弹窗在显示截断摘录时排版正常，比如截在代码块中间不会让后面的内容破版。
- **验收：** 摘录条目在历史列表和详情里正常显示；含 Markdown 的截断摘录不破版。

### 7. 窄窗口下的主面板头栏

- **依据：** hb.3 / hb.4 的已知限制：窗口较窄时主面板头栏被整体裁切。桌面窗口的设计最小宽度是 1000px（`DESIGN_MIN_WINDOW_WIDTH`），屏幕更小时还会再低；左右侧栏展开后，主面板实际宽度远小于窗口宽度。
- **做法：** 先在最小窗口宽度、左右侧栏都展开的情况下复现，确认哪些控件溢出。参照 [Left Bar 头栏的宽度让位规则](../agent-guides/UI-PATTERNS.md#left-bar-header-width-gates)，给主面板头栏定出让位顺序：标题省略显示，可点的控件不被裁掉。不做整页重设计，手机布局不动。
- **验收：** 窗口宽 1000px 且两侧栏展开、以及更宽的几档下，头栏控件都可见可点，长标题省略显示；手机布局截图不变。

### 8. 侧栏打开会话后的输入焦点（Issue #1）

- **依据：** Issue #1 记录了代码审查时的怀疑：在项目会话列表里点击或按 Enter 打开会话后，事件冒泡可能把焦点抢回侧栏。至今没有实机确认。
- **做法：** 先写测试复现点击和 Enter 两种情况。复现了才修，只改冒泡或交还焦点的那一处，复用 `useFocusAfterRender()` 等既有工具；没复现就在记录里写明，不改代码。
- **验收：** 打开会话后焦点在输入框，可以直接打字。

### 9. Issue #1 整理与实机验收清单

- **做法：** 按 hb.3、hb.4 和本阶段的证据，更新 Issue #1 的勾选状态，剩余项链接到本计划。列出需要用户在 macOS 上执行的实机回归：长回合、停止后恢复、共享模式双向刷新、滚动锚点、运行中命令输出、Claude 跨应用刷新、窄窗口头栏。
- **验收：** Issue #1 的状态与实际证据一致；实机清单写进完成记录，每一步可以照着做。

## 实施范围

- 分支 `feed/frontend-followups`，从 `6a0ddcc` 建立；一个 PR、每项单独提交，目标 `codex/i18n-zh-cn`。
- 主要入口：`src/renderer/components/TerminalOutput/`（`LogItem`、`ToolCallDetails`、`TerminalOutput`、`hooks/useTerminalOutputScroll.ts`、`utils/turnSettingChanges.ts`）、`src/renderer/utils/transcriptMessages.ts`、`src/renderer/components/Settings/tabs/GeneralTab/components/ThinkingModeSection.tsx`、主面板头栏，以及 `src/renderer/i18n/` 的中英文案。
- 不改主进程、解析器、存储和共享连接器。需要后端配合时记录依赖，交回 Codex。
- 不改回合折叠的分组规则；第 3 项只改未读计数。

## 特殊要求

沿用[后端计划的特殊要求](backend-reliability.md#特殊要求)中适用于前端的部分：拒绝过度防御、最小修改、错误如实传递、测试验证行为、限制改动与证据量。另外：

1. 先查 `CLAUDE.md` 列出的规范工具，复用已有的（`useStickToBottom()`、`isFeedReplyRow()`、焦点 hook 等），不另写一份。
2. 每个已确认的缺陷先补能失败的回归，再修复。
3. 第 1、7 项涉及视觉，要在可以运行的界面里对比修改前后的截图；云端运行不了时标记未验，并在完成记录里写 macOS 上的手动核对步骤。截图只留在本地，不入库。
4. 新写的文案、文档、注释和提交说明不使用长破折号或短破折号。
5. 推送前运行 `npm run lint`、`npm run lint:eslint`、`npm run format:check:all` 和相关 Vitest；合并前要求 PR 的六项检查全部通过。

## 完成记录

实施后填写：每项的问题、改动、实际测试结果和未验项，保持简短。
