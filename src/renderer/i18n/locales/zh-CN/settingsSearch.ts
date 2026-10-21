import type { SettingsSearchOverlay } from '../../settingsSearch';

/**
 * Simplified Chinese text for the Settings search registry, keyed by the
 * entry's `id` (which is also its `data-setting-id`). The English registry stays
 * the source of truth for ids, tabs, and jump targets; this only supplies what
 * the user reads and types. English terms keep matching in either language.
 */
export const settingsSearchZhCN: SettingsSearchOverlay = {
	'general-language': {
		label: '界面语言',
		description: '选择 Maestro 界面的显示语言：跟随系统、English 或简体中文',
		keywords: ['语言', '中文', '英文', '界面', '本地化', '翻译'],
	},
	'general-conductor-profile': {
		label: '指挥家档案（关于我）',
		description: '向智能体介绍你自己，让它们知道如何与你协作',
		keywords: ['档案', '个人资料', '关于我', '自我介绍'],
	},
	'general-global-show-hotkey': {
		label: '唤起 Maestro 的全局快捷键',
		description: '在任意应用中唤起 Maestro 窗口的系统级快捷键',
		keywords: ['快捷键', '全局', '热键', '唤起', '前台'],
	},
	'general-default-shell': {
		label: '默认终端 Shell',
		description: '选择终端会话使用的 Shell，配置自定义路径和参数',
		keywords: ['终端', 'Shell', '命令行', '路径', '参数'],
	},
	'general-log-level': {
		label: '系统日志级别',
		description: '级别越高日志越少。“调试”显示全部日志，“错误”仅显示错误',
		keywords: ['日志', '级别', '调试', '错误', '警告'],
	},
	'general-gh-path': {
		label: 'GitHub CLI (gh) 路径',
		description: '为自动运行的工作树功能指定 gh 可执行文件的完整路径',
		keywords: ['路径', '工作树', '可执行文件'],
	},
	'general-maestro-cli': {
		label: 'Maestro CLI',
		description: '检查 PATH 与版本，并为当前用户安装或更新 maestro-cli',
		keywords: ['命令行', '安装', '更新', '版本'],
	},
	'general-web-interface-auto-start': {
		label: 'Web 界面',
		description: 'Maestro 启动时自动开启完整的浏览器界面',
		keywords: ['网页', '浏览器', '远程', '手机', '启动'],
	},
	'general-input-behavior': {
		label: '消息发送方式',
		description:
			'设置发送消息的按键（Enter 或 Cmd+Enter）、AI 交互模式、展开的提示词编辑器和强制并行执行',
		keywords: ['发送', '回车', '换行', '输入', '按键'],
	},
	'general-forced-parallel': {
		label: '强制并行执行',
		description: '在同一智能体的其他标签页仍在工作时发送消息（或强制发送排队消息）',
		keywords: ['并行', '强制发送', '队列', '忙碌'],
	},
	'general-cross-agent-mentions': {
		label: '跨智能体提及',
		description: '设置 @ 提及是咨询（只读，默认）还是委派（智能体可以写入文件）',
		keywords: ['提及', '咨询', '委派', '移交', '只读', '读写'],
	},
	'general-autorun-inactivity-timeout': {
		label: '自动运行无响应超时',
		description: '智能体在这么多分钟内没有输出时，自动运行会强制终止任务',
		keywords: ['自动运行', '超时', '无响应', '终止'],
	},
	'general-autorun-max-task-duration': {
		label: '自动运行最长任务时长',
		description: '单个自动运行任务的绝对时长上限，无论是否有输出',
		keywords: ['自动运行', '时长', '上限', '超时'],
	},
	'general-history': {
		label: '历史记录默认开关',
		description: '新标签页默认开启“历史记录”，每次完成后保存一份摘要',
		keywords: ['历史', '摘要', '保存'],
	},
	'general-group-cue-entries': {
		label: '合并 Cue 历史记录',
		description: '将重复的 Cue 运行合并为一条历史记录，显示运行次数、最近运行时间和失败次数',
		keywords: ['历史', '合并', '分组', '运行'],
	},
	'general-synopsis-debounce': {
		label: '摘要防抖',
		description: '生成历史摘要前等待的空闲时间，将连续完成的回合合并为一份',
		keywords: ['摘要', '防抖', '延迟', '历史'],
	},
	'general-thinking-mode': {
		label: '默认思考模式',
		description: '新标签页中显示 AI 思考/推理内容的方式：关、开或保留',
		keywords: ['思考', '推理', '模式'],
	},
	'general-tool-calls': {
		label: '工具调用',
		description: '在 AI 回复中显示或隐藏工具调用活动（工具标记及其输入/输出）',
		keywords: ['工具', '调用', '显示'],
	},
	'general-tab-behavior': {
		label: '标签页行为',
		description: '自动命名标签页，以及新标签页在标签栏中的位置',
		keywords: ['标签页', '命名', '位置'],
	},
	'general-utility-agent': {
		label: '辅助智能体',
		description: '将辅助任务（标签页命名、上下文整理）交给更便宜或更快的智能体，可选覆盖模型',
		keywords: ['辅助', '模型', '命名', '整理'],
	},
	'general-spell-check': {
		label: '启用拼写检查',
		description: '在输入区域（提示词输入框、群聊、文件编辑器）中显示拼写检查建议。默认关闭。',
		keywords: ['拼写', '检查', '词典'],
	},
	'general-power': {
		label: '工作时阻止休眠',
		description: '当智能体忙碌、自动运行进行中或 Cue 流水线已排期时，让电脑保持唤醒',
		keywords: ['电源', '休眠', '睡眠', '唤醒'],
	},
	'general-display-sleep': {
		label: '保持屏幕常亮',
		description: '在智能体工作时阻止屏幕保护、锁屏和空闲注销。会暂停 macOS 的后台维护。',
		keywords: ['屏幕', '常亮', '锁屏', '屏保'],
	},
	'general-rendering': {
		label: '渲染选项',
		description: 'GPU 加速和彩带动画',
		keywords: ['渲染', '显卡', '动画', '彩带'],
	},
	'general-auto-resume': {
		label: '额度恢复后继续已暂停的会话',
		description: '当服务商的限额窗口重新开放时，自动恢复因令牌、API 或额度限制而暂停的智能体',
		keywords: ['恢复', '额度', '限额', '暂停'],
	},
	'general-auto-resume-interval': {
		label: '自动恢复检查间隔',
		description: '探测额度是否可用的频率，以及放弃等待前持续尝试的时长',
		keywords: ['间隔', '检查', '恢复', '放弃'],
	},
	'general-updates': {
		label: '启动时检查更新',
		description: '应用启动时自动检查 Maestro 新版本',
		keywords: ['更新', '升级', '版本'],
	},
	'general-beta-updates': {
		label: '预发布通道',
		description: '包括 Beta 版和候选发布版更新',
		keywords: ['测试版', '预发布', '更新'],
	},
	'general-crash-reporting': {
		label: '发送匿名崩溃报告',
		description: '自动发送崩溃报告，帮助改进 Maestro',
		keywords: ['隐私', '崩溃', '报告'],
	},
	'general-browser': {
		label: '默认浏览器',
		description:
			'选择链接在 Maestro 内置浏览器标签页还是系统浏览器中打开，并设置新浏览器标签页的默认网址。',
		keywords: ['浏览器', '链接', '主页', '网址'],
	},
	'general-html-double-click': {
		label: '双击时在 Maestro 浏览器中打开 HTML 文件',
		description: '启用后，在文件浏览器中双击 HTML 文件会在 Maestro 浏览器标签页中打开。',
		keywords: ['网页', '双击', '浏览器'],
	},
	'general-browser-keepalive': {
		label: '后台浏览器标签页',
		description: '设置不活跃的浏览器标签页是卸载（返回时重新加载）还是保持活跃以保留状态。',
		keywords: ['浏览器', '后台', '内存', '保活'],
	},
	'general-storage': {
		label: '存储位置',
		description:
			'选择 Maestro 存储设置、会话、分组、智能体和配置的位置。可使用同步文件夹在多台设备间共享。',
		keywords: ['存储', '同步', '文件夹', '云盘'],
	},
	'display-typography-reset': {
		label: '恢复默认字体',
		description: '一次性将所有字体和字号恢复为默认或 Hacker 预设',
		keywords: ['字体', '字号', '重置', '预设'],
	},
	'display-typography-snapshot': {
		label: '保存与恢复自定义设置',
		description: '保留你自己的字体和字号，尝试预设后可以恢复',
		keywords: ['字体', '保存', '恢复'],
	},
	'display-custom-fonts': {
		label: '管理自定义字体',
		description: '添加本机已安装的字体名称，所有字体选择器中都会提供',
		keywords: ['字体', '自定义', '添加'],
	},
	'display-fonts': {
		label: '字体',
		description: '为界面、终端、AI 对话、文件预览和文件编辑器选择字体与字号',
		keywords: ['字体', '字号', '大小'],
	},
	'display-font-zoom': {
		label: '缩放',
		description: '同时缩放所有界面字号，并保持它们之间的相对大小',
		keywords: ['缩放', '放大', '缩小', '字号'],
	},
	'display-max-log-buffer': {
		label: '最大日志缓冲',
		description: '历史记录和系统日志查看器保留的最大条目数',
		keywords: ['日志', '缓冲', '条目'],
	},
	'display-max-output-lines': {
		label: '每次回复的最大输出行数',
		description: '较长的输出会折叠到可滚动的窗口中',
		keywords: ['输出', '行数', '折叠'],
	},
	'display-message-alignment': {
		label: '用户消息对齐',
		description: '将你的消息放在对话的左侧或右侧，AI 回复显示在另一侧',
		keywords: ['对齐', '消息', '左', '右'],
	},
	'display-group-chat-auto-scroll': {
		label: '群聊自动滚动',
		description: '收到新消息时自动将群聊滚动到最新消息。',
		keywords: ['群聊', '滚动'],
	},
	'display-colorblind-mode': {
		label: '色盲模式',
		description: '在状态点、差异、Git 状态、活动图表和使用统计中使用对色盲友好的配色。',
		keywords: ['色盲', '颜色', '无障碍'],
	},
	'display-bionify-reading-mode': {
		label: 'Bionify 强调（阅读模式）',
		description: '为文件预览和自动运行等长文阅读界面应用 Bionify 风格的强调效果。',
		keywords: ['阅读', '强调', '加粗'],
	},
	'display-icon-theme': {
		label: '文件面板图标主题',
		description: '文件面板使用扁平或丰富（Material 图标主题风格）图标',
		keywords: ['图标', '主题', '文件'],
	},
	'display-file-tree-connectors': {
		label: '文件面板树状连线',
		description: '用连接线把每一行挂在所属文件夹的引导线上',
		keywords: ['连线', '树状', '文件'],
	},
	'display-provider-mode-pill': {
		label: '服务商模式标记',
		description: '在对话回复和历史记录下方显示生成该回合所用的 Claude 界面',
		keywords: ['标记', '服务商', '模式'],
	},
	'display-window-chrome': {
		label: '窗口外观',
		description: '使用原生或自定义标题栏，以及自动隐藏菜单栏（按 Alt 临时显示）',
		keywords: ['标题栏', '菜单栏', '窗口'],
	},
	'display-main-header-panel': {
		label: '主标题栏',
		description: '设置主标题栏中显示的智能体名称、会话 ID 和会话费用标记',
		keywords: ['标题栏', '费用', '会话'],
	},
	'display-left-panel-starred-sessions': {
		label: '显示星标会话区',
		description: '在左侧栏顶部显示星标会话区，列出所有智能体中带星标的 AI 标签页和已命名会话',
		keywords: ['星标', '收藏', '左侧栏'],
	},
	'display-left-panel-collapsed-initials': {
		label: '折叠时显示智能体缩写',
		description: '左侧栏折叠时，用智能体名称中的两个字母代替普通状态点',
		keywords: ['缩写', '折叠', '左侧栏'],
	},
	'display-left-side-panel': {
		label: '左侧栏',
		description:
			'配置左侧栏：分组成员数、折叠时每行标记数、位置标记、Git 变更指示、Cue 指示和工作树标记等',
		keywords: ['左侧栏', '分组', '指示器'],
	},
	'display-modal-layout': {
		label: '弹窗布局',
		description: '重置已保存的弹窗尺寸',
		keywords: ['弹窗', '尺寸', '重置'],
	},
	'display-file-edit-preview': {
		label: '文件编辑与预览',
		description: '行号、默认自动换行，以及文件预览/编辑器工具栏中各按钮的显示',
		keywords: ['编辑', '预览', '行号', '换行'],
	},
	'display-tab-filtering': {
		label: '标签页选项',
		description:
			'按未读筛选时显示的标签页类型、最后一个标签页快捷键、浏览器域名标记、标签页数量和滚轮滚动',
		keywords: ['标签页', '未读', '筛选'],
	},
	'display-document-graph': {
		label: '文档关系图',
		description: '文档关系图的外部链接和最大节点数',
		keywords: ['文档', '关系图', '节点'],
	},
	'display-context-warnings': {
		label: '上下文窗口警告',
		description: '当上下文窗口用量达到设定阈值时显示警告横幅',
		keywords: ['上下文', '警告', '阈值'],
	},
	'display-file-indexing': {
		label: '文件索引与文件面板设置',
		description: '文件面板的本地忽略规则、gitignore 处理、最大递归深度、最大文件数和 SSH 上限',
		keywords: ['索引', '忽略', '文件'],
	},
	'notifications-center': {
		label: '通知中心',
		description:
			'可选的收件箱大小、完整详情、键盘导航、快捷键设置，以及排队回复和自动运行任务历史。',
		keywords: ['通知', '中心', '收件箱'],
	},
	'notifications-os': {
		label: '系统通知',
		description: '任务完成或需要关注时显示桌面通知',
		keywords: ['通知', '桌面', '系统'],
	},
	'notifications-custom': {
		label: '自定义通知',
		description: 'AI 任务完成时执行自定义命令（文字转语音、say、espeak、写入日志）。包含测试按钮。',
		keywords: ['通知', '命令', '语音'],
	},
	'notifications-idle': {
		label: '空闲通知',
		description: '所有智能体和自动运行完成、Maestro 变为空闲时执行自定义命令。包含测试按钮。',
		keywords: ['空闲', '通知', '命令'],
	},
	'notifications-toast': {
		label: '提示通知显示时长',
		description: '提示通知自动消失前停留的时间；0 表示一直显示直到手动关闭',
		keywords: ['提示', '时长', '通知'],
	},
	'notifications-toast-position': {
		label: '提示通知位置',
		description: '提示通知出现在窗口的哪个角落：左上、右上、左下或右下',
		keywords: ['提示', '位置', '角落'],
	},
	'notifications-toast-width': {
		label: '提示通知宽度',
		description: '提示通知的宽度：小、中、大或动态（与侧边栏一致）',
		keywords: ['提示', '宽度'],
	},
	'aicommands-custom': {
		label: '自定义 AI 命令',
		description:
			'使用可配置的提示词和模板变量创建自定义斜杠命令。在 AI 终端模式中与内置命令一起可用。',
		keywords: ['命令', '斜杠', '自定义', '模板'],
	},
	'aicommands-speckit': {
		label: 'Spec-Kit 命令',
		description: '内置的规格工具包命令。可切换以在斜杠命令自动补全中隐藏它们。',
		keywords: ['命令', '规格'],
	},
	'aicommands-openspec': {
		label: 'OpenSpec 命令',
		description: '内置的 OpenSpec 命令。可切换以在斜杠命令自动补全中隐藏它们。',
		keywords: ['命令', '规格'],
	},
	'aicommands-bmad': {
		label: 'BMAD 命令',
		description: '内置的 BMAD 命令。可切换以在斜杠命令自动补全中隐藏它们。',
		keywords: ['命令'],
	},
	'shortcuts-tab': {
		label: '键盘快捷键',
		description: '配置通用操作和 AI 标签页操作的键盘快捷键',
		keywords: ['快捷键', '键盘', '按键'],
	},
	'theme-surface-gloss': {
		label: '表面光泽',
		description: '为应用界面添加光源效果，让面板呈现层次感而不是一整块平面',
		keywords: ['光泽', '主题', '层次'],
	},
	'theme-picker': {
		label: '主题选择',
		description: '从深色、浅色和氛围主题中选择，或创建自定义主题',
		keywords: ['主题', '深色', '浅色', '配色'],
	},
	'ssh-remotes': {
		label: 'SSH 远程主机',
		description: '配置用于远程运行智能体的 SSH 主机；分配给智能体前先测试连接',
		keywords: ['远程', '主机', '服务器', '连接'],
	},
	'ssh-ignore-patterns': {
		label: 'SSH 远程忽略规则',
		description: '索引远程文件时要排除的文件夹的通配符规则',
		keywords: ['忽略', '远程', '规则'],
	},
	'environment-global-vars': {
		label: '全局环境变量',
		description: '应用于所有终端会话和 AI 智能体的变量',
		keywords: ['环境变量', '变量', '全局'],
	},
	'prompts-editor': {
		label: 'Maestro 提示词',
		description: '按类别编辑核心系统提示词：向导、内联向导、自动运行、群聊、上下文等',
		keywords: ['提示词', '系统', '编辑'],
	},
	'about-maestro': {
		label: '关于 Maestro',
		description: 'Maestro 版本、标语和起源',
		keywords: ['关于', '版本'],
	},
	'encore-usage-stats': {
		label: '使用情况与统计',
		description: '跟踪查询、自动运行会话和编码活动，并通过可配置的时间范围查看使用统计面板',
		keywords: ['统计', '使用', '面板'],
	},
	'encore-symphony': {
		label: 'Maestro Symphony',
		description: '通过精选仓库和 Playbook 注册表为开源项目做贡献',
		keywords: ['开源', '贡献'],
	},
	'encore-cue': {
		label: 'Maestro Cue',
		description:
			'事件驱动的自动化（Beta），可在定时器、文件变化、智能体完成、GitHub PR/Issue 和待办任务时触发提示词',
		keywords: ['自动化', '触发', '事件'],
	},
	'cue-history-retention': {
		label: 'Cue 历史保留期限',
		description: '保留多少天的 Maestro Cue 运行历史。该控件位于 Cue 弹窗的活动日志标题处。',
		keywords: ['保留', '历史', '天数'],
	},
	'encore-coworking': {
		label: '协同工作',
		description: 'Beta：让智能体按需读取终端回滚内容，并为终端标签页添加 term:N 标记。',
		keywords: ['协同', '终端'],
	},
	'coworking-background-browsers': {
		label: '协同工作后台浏览',
		description: '在你专注于其他智能体时，让智能体读取并操作自己的浏览器标签页。',
		keywords: ['浏览器', '后台', '协同'],
	},
	'encore-director-notes': {
		label: '导演笔记',
		description: '统一的历史视图，以及跨所有会话的 AI 生成摘要（Beta）',
		keywords: ['导演', '笔记', '摘要'],
	},
	'encore-director-notes-provider': {
		label: '摘要服务商（导演笔记）',
		description: '使用第一个可用的服务商，或将摘要固定到某个智能体并自定义',
		keywords: ['导演', '服务商', '摘要'],
	},
	'encore-director-notes-default-mode': {
		label: '导演笔记默认阅读模式',
		description: 'AI 概览以丰富模式（组件面板）还是纯文本模式（Markdown）打开',
		keywords: ['导演', '阅读', '模式'],
	},
	'encore-director-notes-ideal-end-state': {
		label: '理想最终状态（导演笔记）',
		description: '描述进行中的项目以及完成的标准；笔记会据此排列优先级并添加进度部分',
		keywords: ['导演', '目标', '进度'],
	},
	'encore-pianola': {
		label: 'Pianola',
		description:
			'自主管理智能体（Beta）。监控你的智能体，根据你的规则自动回答低风险提示，并上报不确定或高风险的问题。',
		keywords: ['自动', '管理', '规则'],
	},
	'encore-concerto': {
		label: 'Concerto',
		description:
			'智能体以可查看、可点击的方式作答，结果会在 Concerto 舞台上作为真实的交互视图打开。',
		keywords: ['交互', '舞台', '视图'],
	},
	'encore-groups-plus': {
		label: 'Groups+',
		description:
			'带标准图标和标签颜色的嵌套分组文件夹。开启后可整理侧边栏，而不更改已存储的分组数据。',
		keywords: ['分组', '文件夹', '嵌套'],
	},
	'encore-web-login': {
		label: 'Web 登录',
		description: '要求在 Web 界面输入用户名和密码，管理账户，并将每个回合归属到发送它的人',
		keywords: ['登录', '账户', '密码'],
	},
	'encore-plugins': {
		label: '插件',
		description: '社区插件子系统（Alpha）：发现、启用、停用、安装和卸载插件',
		keywords: ['插件', '扩展', '安装'],
	},
};
