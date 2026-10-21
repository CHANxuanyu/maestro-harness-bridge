import type { settingsDisplay as en } from '../en/settingsDisplay';
import type { AreaTranslation } from '../types';

export const settingsDisplay: AreaTranslation<typeof en> = {
	'settings.display.reset.heading': '恢复默认字体',
	'settings.display.reset.description':
		'一次性设置下方所有字体和字号。“默认”阅读用比例字体、工作用等宽字体；“Hacker”全部使用等宽字体。',
	'settings.display.reset.active': '当前使用“{preset}”预设。',
	'settings.display.reset.customized': '你已自定义这些设置，因此两个预设都未启用。',
	'settings.display.reset.confirmButton': '重置为“{preset}”？',
	'settings.display.reset.confirmHint': '再次点击将覆盖全部六种字体和六个字号。缩放级别会保留。',
	'settings.display.preset.default': '默认',
	'settings.display.preset.hacker': 'Hacker',

	'settings.display.snapshot.heading': '保存与恢复自定义设置',
	'settings.display.snapshot.description':
		'把你喜欢的字体和字号保存为自己的设置，然后可以尝试上方的预设或继续在下方调整，并一键恢复。只有一个存档位，每次保存都会覆盖。缩放级别不包含在内。',
	'settings.display.snapshot.label': '已保存的字体',
	'settings.display.snapshot.none': '尚未保存。',
	'settings.display.snapshot.active': '已保存的字体正在使用中。保存于{when}。',
	'settings.display.snapshot.inactive': '保存于{when}。下方的字体与之不同。',
	'settings.display.snapshot.confirmSave': '替换已保存的字体？',
	'settings.display.snapshot.save': '保存自定义设置',
	'settings.display.snapshot.restore': '恢复自定义设置',
	'settings.display.snapshot.saveFirst': '请先保存你的字体。',
	'settings.display.snapshot.alreadyActive': '已保存的字体已在使用中。',
	'settings.display.snapshot.confirmHint': '再次点击将替换之前保存的设置。此操作无法撤销。',

	'settings.display.customFonts.heading': '自定义字体',
	'settings.display.customFonts.description':
		'本机已安装、但不在下方列表中的字体名称。在这里添加一次，所有字体选择器中都会提供。',
	'settings.display.customFonts.placeholder': '添加自定义字体名称...',
	'settings.display.customFonts.aria': '添加自定义字体名称',
	'settings.display.customFonts.remove': '移除 {font}',
	'settings.display.fonts.heading': '字体',
	'settings.display.fonts.description':
		'“界面”是比例字体，“终端”是等宽字体。其他界面可以跟随其中之一，也可以单独设置字体。在任一选择器上按上/下方向键即可预览。',
	'settings.display.surface.interface': '界面',
	'settings.display.surface.interface.description': '整个应用，也是其他界面可跟随的比例字体。',
	'settings.display.surface.chat': 'AI 对话',
	'settings.display.surface.chat.description': '主面板和平铺窗格中的 AI 对话记录。',
	'settings.display.surface.terminal': '终端',
	'settings.display.surface.terminal.description':
		'命令终端，也是其他界面可跟随的等宽字体。使用 Nerd Font 可以显示 Shell 提示符图标。',
	'settings.display.surface.filePreview': '文件预览',
	'settings.display.surface.filePreview.description': '正在阅读的文件。',
	'settings.display.surface.documentGraph': '文档关系图',
	'settings.display.surface.documentGraph.description': '文档关系图中的节点标题和预览。',
	'settings.display.surface.fileEditor': '文件编辑器',
	'settings.display.surface.fileEditor.description': '正在编辑的文件。等宽字体可让行号与文本对齐。',

	'settings.display.zoom.heading': '缩放',
	'settings.display.zoom.description':
		'按相同比例缩放上方所有界面，你设置的相对大小保持不变。{zoomIn} / {zoomOut} 调整，{zoomReset} 重置。',

	'settings.display.logBuffer.heading': '最大日志缓冲',
	'settings.display.logBuffer.description':
		'历史记录和系统日志查看器保留的最大条目数。新条目到达时会自动丢弃较旧的条目。',
	'settings.display.outputLines.heading': '每次回复的最大输出行数',
	'settings.display.outputLines.all': '全部',
	'settings.display.outputLines.description':
		'较长的输出会折叠到可滚动的窗口中。设为“全部”则始终显示完整输出。',

	'settings.display.alignment.heading': '用户消息对齐',
	'settings.display.alignment.left': '左侧',
	'settings.display.alignment.right': '右侧',
	'settings.display.alignment.description': '将你的消息放在对话的左侧或右侧，AI 回复显示在另一侧。',

	'settings.display.groupChat.heading': '群聊',
	'settings.display.groupChat.title': '自动滚动到最新消息',
	'settings.display.groupChat.description':
		'收到新消息时自动将群聊滚动到底部。关闭后，阅读较早的消息时会保持当前滚动位置。',
	'settings.display.groupChat.aria': '群聊自动滚动到最新消息',

	'settings.display.a11y.heading': '无障碍',
	'settings.display.a11y.description': '针对色觉障碍和长文阅读调整界面的视觉选项。',
	'settings.display.a11y.colorBlind': '色盲模式',
	'settings.display.a11y.colorBlindDescription':
		'在智能体状态点、差异增删、Git 状态、活动图、使用统计图表和文件扩展名标记中，用 Wong 色盲友好配色替换红/绿/黄的含义。',
	'settings.display.a11y.colorBlindAria': '色盲模式',
	'settings.display.a11y.bionify': 'Bionify 强调',
	'settings.display.a11y.bionifyInfoAria': '说明',
	'settings.display.a11y.bionifyInfoTitle': 'Bionify 算法说明',
	'settings.display.a11y.bionifyAria': 'Bionify 阅读模式',
	'settings.display.a11y.intensity': '强度',
	'settings.display.a11y.soft': '柔和',
	'settings.display.a11y.strong': '强烈',
	'settings.display.a11y.intensityDescription':
		'控制强调的力度。“强烈”会加重强调字重，并更明显地淡化其余字符。',
	'settings.display.a11y.algorithm': 'Bionify 算法',
	'settings.display.a11y.algorithmAria': 'Bionify 算法',
	'settings.display.a11y.algorithmFormat':
		'格式：符号、四条固定词长规则，然后是一个回退比例。示例：{example}',
	'settings.display.a11y.algorithmInvalid': '请输入 {format}，例如 {example}。',

	'settings.display.bionify.title': 'Bionify 算法参考',
	'settings.display.bionify.sign':
		'第一个字符为 {minus} 或 {plus}。{minus} 会跳过常见英文单词，如 {a}、{and} 和 {the}。{plus} 会强调每个单词。',
	'settings.display.bionify.lengths': '接下来的四个数字分别控制长度为 1-4 的单词中强调的字符数。',
	'settings.display.bionify.fraction':
		'最后一个值是每个单词中要强调的字符比例（例如 {example} 会强调长度超过 4 个字母的单词的前 40% 字符）。',
	'settings.display.bionify.default':
		'当前默认值：{example}，会跳过常见单词，并强调较长单词的前 40%。',

	'settings.display.iconTheme.heading': '文件面板图标主题',
	'settings.display.iconTheme.flat': '扁平',
	'settings.display.iconTheme.rich': '丰富',
	'settings.display.iconTheme.description':
		'“丰富”在文件面板中使用 Material 图标主题风格的文件和文件夹 SVG 图标。“扁平”使用 Maestro 更简洁的单色图标。',
	'settings.display.treeLines.heading': '文件面板树状连线',
	'settings.display.treeLines.title': '显示分支连接线',
	'settings.display.treeLines.description':
		'用折线将每一行连接到所属文件夹，并让文件夹的引导线在最后一项处结束。默认关闭，此时绘制普通的全高缩进引导线。',
	'settings.display.treeLines.aria': '显示文件树分支连接线',

	'settings.display.providerPill.heading': '服务商模式标记',
	'settings.display.providerPill.title': '显示服务商模式',
	'settings.display.providerPill.description':
		'在对话回复下方和历史记录上，以标记形式显示生成该回合的 Claude 界面（“claude -p”或“TUI Wrapper”）。',
	'settings.display.providerPill.aria': '显示服务商模式标记',

	'settings.display.chrome.heading': '窗口外观',
	'settings.display.chrome.nativeTitleBar': '使用原生标题栏',
	'settings.display.chrome.nativeTitleBarDescription':
		'使用操作系统的原生标题栏，而不是 Maestro 的自定义标题栏。需要重启。',
	'settings.display.chrome.autoHideMenu': '自动隐藏菜单栏',
	'settings.display.chrome.autoHideMenuDescription':
		'隐藏应用菜单栏，按 Alt 键切换显示。适用于 Windows 和 Linux。需要重启。',

	'settings.display.header.heading': '主标题栏',
	'settings.display.header.agentName': '显示智能体名称',
	'settings.display.header.agentNameDescription': '在主标题栏中显示智能体名称。',
	'settings.display.header.sessionId': '显示会话 ID 标记',
	'settings.display.header.sessionIdDescription':
		'在主标题栏中显示服务商会话 ID 标记（短哈希，例如“B778BF42”）。点击标记可复制完整 ID。',
	'settings.display.header.cost': '显示会话费用标记',
	'settings.display.header.costDescription':
		'在主标题栏中显示每个会话的累计费用（例如“$21.33”），并在群聊标题栏中显示总费用。',

	'settings.display.left.heading': '左侧栏',
	'settings.display.left.starred': '显示星标会话区',
	'settings.display.left.starredDescription':
		'在左侧栏顶部显示星标会话区，列出所有智能体中带星标的 AI 标签页。',
	'settings.display.left.starredAria': '在左侧栏中显示星标会话区',
	'settings.display.left.memberCount': '显示分组成员数',
	'settings.display.left.memberCountDescription':
		'在左侧栏每个分组名称后的括号中显示智能体数量（例如“未分组智能体 (24)”）。',
	'settings.display.left.memberCountAria': '在左侧栏中显示分组成员数',
	'settings.display.left.initials': '折叠时显示智能体缩写',
	'settings.display.left.initialsDescription':
		'左侧栏折叠时，用智能体名称中的两个字母标记每个智能体（例如 Maestro RC 显示为 {example}），并以状态颜色着色。字母的选取保证不会有两个智能体使用相同标记。关闭则显示普通状态点。',
	'settings.display.left.initialsAria': '在折叠的左侧栏中显示智能体缩写',
	'settings.display.left.pillsPerRow': '折叠分组每行标记数',
	'settings.display.left.pillsPerRowDescription':
		'分组折叠时，其中的智能体会显示为一排活动标记。显示达到此数量后会换行，让大型分组保持可读，而不会挤成看不见的细条。',
	'settings.display.left.locationPills': '显示位置标记',
	'settings.display.left.locationPillsDescription':
		'在左侧栏每个智能体旁显示 REMOTE / LOCAL / GIT 标记。关闭可简化智能体行。',
	'settings.display.left.locationPillsAria': '在左侧栏中显示位置标记',
	'settings.display.left.git': '显示 Git 变更指示',
	'settings.display.left.gitDescription': '在 Git 仓库智能体旁显示分支图标和未提交文件数。',
	'settings.display.left.gitAria': '在左侧栏中显示 Git 变更指示',
	'settings.display.left.cue': '显示 Cue 指示',
	'settings.display.left.cueDescription': '在有活跃 Maestro Cue 订阅的智能体旁显示闪电图标。',
	'settings.display.left.cueAria': '在左侧栏中显示 Cue 指示',
	'settings.display.left.startup': '显示终端启动命令指示',
	'settings.display.left.startupDescription':
		'在至少有一个终端标签页保存了启动命令的智能体旁显示 {glyph} 图标。',
	'settings.display.left.startupAria': '在左侧栏中显示终端启动命令指示',
	'settings.display.left.groupLabel': '在书签智能体上显示分组标记',
	'settings.display.left.groupLabelDescription':
		'在书签智能体旁显示分组标记（例如 {example}）。关闭则完全隐藏分组标记。',
	'settings.display.left.groupLabelAria': '在左侧栏的书签智能体上显示分组标记',
	'settings.display.left.fullGroupLabel': '在书签智能体上显示完整分组名',
	'settings.display.left.fullGroupLabelDescription':
		'在书签智能体旁显示完整的分组名称（例如 {full}），而不是缩写标记（例如 {short}）。过长的名称会被截断，悬停时显示完整内容。',
	'settings.display.left.fullGroupLabelAria': '在左侧栏的书签智能体上显示完整分组名',
	'settings.display.left.worktreePill': '在子智能体列表中显示 {pill} 标记',
	'settings.display.left.worktreePillDescription': '在左侧面板的工作树子智能体旁显示工作树标记。',
	'settings.display.left.worktreePillAria': '在左侧面板智能体列表中显示工作树标记',
	'settings.display.left.branchName': '在子智能体列表中显示工作树分支名',
	'settings.display.left.branchNameDescription': '在左侧面板的智能体名称下方显示工作树分支名。',
	'settings.display.left.branchNameAria': '在左侧面板智能体列表中显示分支名',

	'settings.display.modal.heading': '弹窗布局',
	'settings.display.modal.title': '已保存的弹窗尺寸',
	'settings.display.modal.description': '清除自定义的对话框尺寸。',

	'settings.display.fileEdit.heading': '文件编辑与预览',
	'settings.display.fileEdit.lineNumbers': '在编辑器中显示行号',
	'settings.display.fileEdit.lineNumbersDescription':
		'在文件编辑器左侧显示行号栏。右键点击某一行可复制指向该行的 maestro:// 深层链接。',
	'settings.display.fileEdit.wrap': '在编辑器中自动换行',
	'settings.display.fileEdit.wrapDescription':
		'开启时，长行会在空白处换行；关闭时，编辑器会水平滚动。可在编辑器工具栏中实时切换。',
	'settings.display.fileEdit.toolbar': '工具栏按钮',
	'settings.display.fileEdit.toolbarDescription':
		'隐藏你从不使用的按钮。隐藏的操作仍可通过命令面板和键盘快捷键使用。',
	'settings.display.fileEdit.showButton': '显示“{label}”按钮',
	'settings.display.toolbar.save': '保存',
	'settings.display.toolbar.wordWrap': '自动换行',
	'settings.display.toolbar.remoteImages': '显示远程图片',
	'settings.display.toolbar.htmlRender': '渲染 HTML',
	'settings.display.toolbar.openInBrowser': '在 Maestro 浏览器中打开',
	'settings.display.toolbar.previewTier': '预览层级标记',
	'settings.display.toolbar.editToggle': '编辑 / 预览切换',
	'settings.display.toolbar.editImage': '编辑图片',
	'settings.display.toolbar.copyContent': '复制内容',
	'settings.display.toolbar.publishGist': '发布为 Gist',
	'settings.display.toolbar.documentGraph': '文档关系图',
	'settings.display.toolbar.openInDefault': '用默认应用打开',
	'settings.display.toolbar.revealInFolder': '在 {manager} 中显示',
	'settings.display.toolbar.copyPath': '复制文件路径',
	'settings.display.toolbar.delete': '删除文件',

	'settings.display.tabs.heading': '标签页选项',
	'settings.display.tabs.starred': '按未读筛选时显示星标标签页',
	'settings.display.tabs.starredDescription':
		'启用未读筛选时，即使星标标签页没有未读消息也会保持显示。',
	'settings.display.tabs.filePreviews': '按未读筛选时显示文件预览标签页',
	'settings.display.tabs.filePreviewsDescription':
		'启用未读筛选时，文件预览标签页保持显示而不被隐藏。',
	'settings.display.tabs.terminals': '按未读筛选时显示终端标签页',
	'settings.display.tabs.terminalsDescription': '启用未读筛选时，终端标签页保持显示而不被隐藏。',
	'settings.display.tabs.browsers': '按未读筛选时显示浏览器标签页',
	'settings.display.tabs.browsersDescription': '启用未读筛选时，浏览器标签页保持显示而不被隐藏。',
	'settings.display.tabs.lastTab': '将 {meta}+0 视为最后一个标签页',
	'settings.display.tabs.lastTabDescription':
		'Maestro 风格：{meta}+1-9 跳转到第 1-9 个标签页，{meta}+0 跳转到最后一个标签页。关闭则使用浏览器风格：{meta}+1-8 跳转到第 1-8 个标签页，{meta}+9 跳转到最后一个标签页。',
	'settings.display.tabs.domain': '在浏览器标签页上显示域名',
	'settings.display.tabs.domainDescription':
		'在浏览器标签页的页面标题旁显示一个小的域名标记（例如 www.google.com）。关闭则隐藏。',
	'settings.display.tabs.countBadge': '在搜索图标上显示标签页数量',
	'settings.display.tabs.countBadgeDescription':
		'在标签栏的搜索（放大镜）图标上以小标记显示打开的标签页数量。关闭后，点击该图标打开的弹出框中“搜索页签”旁仍会显示数量。',
	'settings.display.tabs.wheel': '使用鼠标滚轮滚动标签页',
	'settings.display.tabs.wheelDescription':
		'标签栏溢出时，将鼠标悬停其上并滚动滚轮即可左右平移标签页。关闭后不再将垂直滚轮转换为标签页滚动；触控板滑动等原生水平手势不受影响。',

	'settings.display.graph.heading': '文档关系图',
	'settings.display.graph.externalLinks': '默认显示外部链接',
	'settings.display.graph.externalLinksDescription':
		'将外部网站链接显示为节点。可在关系图视图中切换。',
	'settings.display.graph.confirmClose': '关闭前确认',
	'settings.display.graph.confirmCloseDescription':
		'按 Esc 丢弃你设置的布局、深度和节点位置前先询问。从记忆查看器打开的关系图不会询问，因为关闭后会返回那里。',
	'settings.display.graph.maxNodes': '最多显示的节点数',
	'settings.display.graph.maxNodesDescription':
		'为保证性能而限制关系图的初始大小。使用“Load more”显示更多节点。',

	'settings.display.context.heading': '上下文窗口警告',
	'settings.display.context.title': '显示上下文用量警告',
	'settings.display.context.description': '当上下文窗口用量达到设定阈值时显示警告横幅',
	'settings.display.context.yellow': '黄色警告阈值',
	'settings.display.context.red': '红色警告阈值',

	'settings.display.indexing.heading': '文件索引',
	'settings.display.indexing.localTitle': '本地忽略规则',
	'settings.display.indexing.localDescription':
		'配置在文件浏览器中索引本地文件时要排除的文件夹的通配符规则。排除大型目录（如 .git）可以减少内存占用并加快文件树加载。',
};
