import type { settings as en } from '../en/settings';
import type { AreaTranslation } from '../types';
import { settingsDisplay } from './settingsDisplay';

export const settings: AreaTranslation<typeof en> = {
	...settingsDisplay,
	'settings.title': '设置',
	'settings.tabsAria': '设置分类',
	'settings.closeAria': '关闭设置',
	'settings.tab.about': '关于',
	'settings.tab.aicommands': 'AI 命令',
	'settings.tab.display': '显示',
	'settings.tab.environment': '环境变量',
	'settings.tab.general': '通用',
	'settings.tab.prompts': 'Maestro 提示词',
	'settings.tab.notifications': '通知',
	'settings.tab.encore': '插件',
	'settings.tab.shortcuts': '快捷键',
	'settings.tab.ssh': 'SSH 主机',
	'settings.tab.theme': '主题',

	'settings.search.placeholder': '搜索设置...',
	'settings.search.aria': '搜索设置',
	'settings.search.clear': '清除搜索',
	'settings.search.noResults': '没有找到与“{query}”相关的设置',

	'settings.language.heading': '语言',
	'settings.language.description':
		'Maestro 菜单、按钮和提示信息使用的语言。对话内容、智能体输出以及发送给智能体的提示词不会被翻译。',
	'settings.language.systemResolved': '当前跟随系统语言：{language}。',
	'settings.language.system': '跟随系统',

	'settings.general.customPathOptional': '自定义路径（可选）',
	'settings.general.unlimited': '不限',
	'settings.general.endOfList': '列表末尾',
	'settings.general.afterCurrentTab': '当前标签页之后',
	'settings.general.readOnly': '只读',
	'settings.general.readWrite': '读写',
	'settings.general.duration.min': '{count} 分钟',
	'settings.general.duration.hr': '{count} 小时',
	'settings.general.duration.sec': '{count} 秒',

	'settings.general.hotkey.heading': '唤起 Maestro 的全局快捷键',
	'settings.general.hotkey.description':
		'系统级快捷键，可在任意应用中将 Maestro 切换到前台。支持 macOS、Windows 和 Linux。留空即停用。（提示：建议使用包含两个修饰键的组合，例如 {example}，以免与其他快捷键冲突。）',
	'settings.general.hotkey.empty': '点击设置快捷键',

	'settings.general.profile.heading': '指挥家档案（关于我）',
	'settings.general.profile.description':
		'简单介绍一下你自己，让 Maestro 中创建的智能体了解如何与你协作和沟通。作为指挥家，你负责编排这支 AI 智能体交响乐团。（可选，最多 5000 字符）',
	'settings.general.profile.aria': '指挥家档案',
	'settings.general.profile.placeholder':
		'例如：我是一名高级开发者，正在开发一个 React/TypeScript 项目。我喜欢简洁的解释和整洁的代码风格……',

	'settings.general.cli.description':
		'检查 {command} 是否在 PATH 中可用，以及其版本是否与 Maestro v{version} 一致。',
	'settings.general.cli.pathLabel': 'PATH：',
	'settings.general.cli.detected': '已检测到',
	'settings.general.cli.detectedShell': '已检测到（Shell PATH）',
	'settings.general.cli.notDetected': '未检测到',
	'settings.general.cli.installedVersion': '已安装版本：',
	'settings.general.cli.notInstalled': '未安装',
	'settings.general.cli.expectedVersion': '期望版本：',
	'settings.general.cli.commandPath': '命令路径：',
	'settings.general.cli.mismatch': '检测到 CLI 版本不一致或缺失。请安装或更新以同步版本。',
	'settings.general.cli.checkingStatus': '正在检查 Maestro CLI 状态...',
	'settings.general.cli.checking': '检查中...',
	'settings.general.cli.checkNow': '立即检查',
	'settings.general.cli.installing': '安装中...',
	'settings.general.cli.installUpdate': '安装 / 更新 CLI',
	'settings.general.cli.reinstall': '重新安装 CLI',
	'settings.general.cli.installTarget': '安装位置：{path}',
	'settings.general.cli.checkFailed': '检查 Maestro CLI 状态失败',
	'settings.general.cli.installFailed': '安装/更新 Maestro CLI 失败',
	'settings.general.cli.installedRestart': 'CLI 已安装。请打开新的终端以使 PATH 更改生效。',
	'settings.general.cli.installedOk': 'CLI 已安装，且与当前 Maestro 版本一致。',
	'settings.general.cli.installedAttention': 'CLI 已安装，但版本/路径检查仍需处理。',

	'settings.general.shell.heading': '默认终端 Shell',
	'settings.general.shell.description':
		'选择终端会话使用的 Shell。可以选择任意 Shell，并在需要时配置自定义路径。',
	'settings.general.shell.loading': '正在加载 Shell...',
	'settings.general.shell.available': '可用',
	'settings.general.shell.customPathRequired': '需要自定义路径',
	'settings.general.shell.notFound': '未找到',
	'settings.general.shell.currentDefault': '当前默认',
	'settings.general.shell.detectOthers': '检测其他可用的 Shell...',
	'settings.general.shell.config': 'Shell 配置',
	'settings.general.shell.customPathHelp': '覆盖自动检测到的 Shell 路径。留空则使用检测到的路径。',
	'settings.general.shell.argsLabel': '附加参数（可选）',
	'settings.general.shell.argsHelp': '传递给每个 Shell 会话的附加命令行参数（例如 --login、-c）。',

	'settings.general.logLevel.heading': '系统日志级别',
	'settings.general.logLevel.debug': '调试',
	'settings.general.logLevel.info': '信息',
	'settings.general.logLevel.warn': '警告',
	'settings.general.logLevel.error': '错误',
	'settings.general.logLevel.description':
		'级别越高，显示的日志越少。“调试”显示全部日志，“错误”仅显示错误。',

	'settings.general.gh.heading': 'GitHub CLI (gh) 路径',
	'settings.general.gh.description':
		'如果 {binary} 不在 PATH 中，请指定其完整路径。自动运行的工作树功能会用到它。',

	'settings.general.web.heading': 'Web 界面',
	'settings.general.web.title': '启动时开启 Web 界面',
	'settings.general.web.description': '自动在浏览器中提供 Maestro 的完整界面。启用后也会立即开启。',

	'settings.general.input.heading': '消息发送方式',
	'settings.general.input.description': '设置发送消息的方式：Enter 或 {meta}+Enter。',
	'settings.general.input.aiMode': 'AI 交互模式',
	'settings.general.input.enterSends': '按 Enter 发送，Shift+Enter 换行。',
	'settings.general.input.metaEnterSends': '按 {meta}+Enter 发送，Enter 换行。',
	'settings.general.input.tabOverride':
		'新标签页的默认设置。在 AI 标签页中切换该开关（或在命令面板中运行“切换 Enter 发送”）只会覆盖该标签页的设置。',
	'settings.general.input.expandedMode': '展开模式下的 AI 交互',
	'settings.general.input.expandedEnterSends':
		'在展开的提示词编辑器中，按 Enter 发送，Shift+Enter 换行。',
	'settings.general.input.expandedMetaEnterSends':
		'在展开的提示词编辑器中，按 {meta}+Enter 发送，Enter 换行。',
	'settings.general.input.forcedParallel': '强制并行执行',
	'settings.general.input.alwaysNotNeeded': '“始终”模式下无需使用，每次发送都会强制执行',
	'settings.general.input.alwaysWarning':
		'{lead}，即使智能体正忙也无需按修饰键。并行写入相同文件可能导致其中一方覆盖另一方。',
	'settings.general.input.alwaysWarningLead': '每条消息都会强制发送',
	'settings.general.input.modifierWarning':
		'启用后，可使用 {shortcut} 在智能体忙碌时仍然发送消息。并行写入相同文件可能导致其中一方覆盖另一方。',
	'settings.general.input.sendTrigger': '发送触发方式',
	'settings.general.input.modifier': '修饰键',
	'settings.general.input.always': '始终',
	'settings.general.input.alwaysHelp': '每次发送都会越过忙碌的智能体强制发送，无需修饰键。',
	'settings.general.input.modifierHelp':
		'使用 {shortcut} 越过忙碌的智能体强制发送。普通发送仍会照常排队。',

	'settings.general.mentions.heading': '跨智能体提及',
	'settings.general.mentions.description':
		'当你 @ 提及另一个智能体时，它会在自己的工作区中作答。“只读”表示{consult}：它只阅读并回复。“读写”表示{delegation}：它还可以修改文件。{handoff}（“然后把你的发现发给 @智能体”）有单独的开关，见下方。',
	'settings.general.mentions.consult': '咨询',
	'settings.general.mentions.delegation': '委派',
	'settings.general.mentions.handoff': '移交',
	'settings.general.mentions.consultOrDelegate': '咨询或委派',
	'settings.general.mentions.delegateState':
		'委派：被提及的智能体在回答时可以修改其自身工作区中的文件。',
	'settings.general.mentions.consultState':
		'咨询：被提及的智能体只会阅读资料来回答，从不修改文件（默认且最安全的选择）。',
	'settings.general.mentions.delegateWarning':
		'现在每次提及都是委派：智能体可以自行修改文件。仅当你信任被提及的智能体在无人值守时编辑其工作区时才启用。',
	'settings.general.mentions.handoffs': '移交',
	'settings.general.mentions.handoffWriteState':
		'读写：收到移交结果（“然后把你的发现发给 @智能体”）的智能体可以保存结果并修改其自身工作区中的文件（默认）。',
	'settings.general.mentions.handoffReadState':
		'只读：收到移交结果的智能体只会阅读并回复，从不修改文件。',
	'settings.general.mentions.handoffWarning':
		'移交会转发另一个智能体的输出，其中可能包含来自网络的文本。接收方智能体会在无人值守的情况下据此行动。',

	'settings.general.autorun.inactivityHeading': '自动运行无响应超时',
	'settings.general.autorun.inactivityDescription':
		'如果智能体在这段时间内没有任何输出，自动运行会强制终止该任务。对于大型重构、繁重的测试或驱动浏览器的网络调研任务，可适当调高。选择“不限”可关闭无响应监控；除非下方的“最长任务时长”也设为“不限”，否则该上限仍然生效。',
	'settings.general.autorun.maxHeading': '自动运行最长任务时长',
	'settings.general.autorun.maxDescription':
		'单个任务运行时长的绝对上限，与是否有输出无关。与无响应超时不同，它还能捕获持续输出却始终无法完成的智能体，否则整个多文档运行会被卡住。选择“不限”可取消该上限。',

	'settings.general.resume.heading': '额度恢复后自动继续',
	'settings.general.resume.title': '在令牌/API 额度可用时恢复已暂停的会话',
	'settings.general.resume.description':
		'Maestro 会按固定间隔探测各个服务商，并在限额窗口重新开放后自动恢复排队中的工作。探测开销很小，因此放弃等待的时间窗口有意设得较长。',
	'settings.general.resume.interval': '检查间隔（小时）',
	'settings.general.resume.giveUp': '放弃等待前的天数',

	'settings.general.history.heading': '历史记录默认开关',
	'settings.general.history.title': '新标签页默认开启“历史记录”',
	'settings.general.history.description':
		'启用后，新的 AI 标签页默认打开“历史记录”开关，每次完成后都会保存一份摘要',
	'settings.general.history.debounceHeading': '摘要防抖',
	'settings.general.history.debounceDescription':
		'在生成历史记录摘要前，等待智能体空闲这么长时间。短时间内连续完成的回合会在对话平稳后合并为一份摘要，而没有实际工作（仅一问一答、未使用工具）的回合会被直接跳过。选择“关”则在每次完成后立即生成摘要。',
	'settings.general.history.cueHeading': '合并 Cue 历史记录',
	'settings.general.history.cueTitle': '将重复的 Cue 运行合并为一条历史记录',
	'settings.general.history.cueDescription':
		'高频触发器会显示为一行，包含运行次数、最近一次运行时间和失败次数。展开该行可查看每次运行。关闭此选项则单独列出每次 Cue 运行。',

	'settings.general.thinking.heading': '默认思考模式',
	'settings.general.thinking.title': '在新标签页中显示 AI 的思考/推理内容',
	'settings.general.thinking.offState': '隐藏思考过程，仅显示最终回复',
	'settings.general.thinking.onState': '实时显示思考过程，完成后清除',
	'settings.general.thinking.stickyState': '实时显示思考过程，并保留显示',
	'settings.general.thinking.sticky': '保留',
	'settings.general.thinking.toolCalls': '在回复中显示工具调用',
	'settings.general.thinking.toolCallsDescription':
		'在 AI 回复中显示工具调用活动（工具标记及其输入/输出）。与上方的思考模式相互独立，因此你可以只看推理过程而不受工具信息干扰。无论如何设置，智能体都会正常调用工具。',
	'settings.general.thinking.toolCallsConversationsNote':
		'会话列表视图会把工具调用收进每个回答上方的折叠行，因此这个开关只在“管理智能体”视图中生效。',

	'settings.general.tabs.heading': '标签页行为',
	'settings.general.tabs.autoName': '根据第一条消息自动命名标签页',
	'settings.general.tabs.autoNameDescription':
		'当你在新标签页中发送第一条消息时，AI 会分析它并生成一个描述性的标签页名称。命名请求并行运行，不会留下历史记录。',
	'settings.general.tabs.newTab': '新标签页位置',
	'settings.general.tabs.newTabDescription': '新 AI 标签页在标签栏中出现的位置。',
	'settings.general.tabs.newBrowserTab': '新浏览器标签页位置',
	'settings.general.tabs.newBrowserTabDescription': '新浏览器标签页在标签栏中出现的位置。',
	'settings.general.tabs.newTerminal': '新终端位置',
	'settings.general.tabs.newTerminalDescription': '新终端标签页在标签栏中出现的位置。',
	'settings.general.tabs.openedFile': '打开文件的位置',
	'settings.general.tabs.openedFileDescription': '打开的文件预览标签页在标签栏中出现的位置。',

	'settings.general.utility.heading': '辅助智能体',
	'settings.general.utility.description':
		'将辅助任务（标签页命名、上下文整理）交给更便宜或更快的智能体处理，而不是会话所用的智能体。保持“默认”则继续使用各标签页自己的智能体。',
	'settings.general.utility.agent': '智能体',
	'settings.general.utility.defaultOption': '默认（与会话相同）',
	'settings.general.utility.notInstalled': '（未安装）',
	'settings.general.utility.unverified': '（未验证）',
	'settings.general.utility.missing':
		'该智能体已不可用。在你选择其他智能体或恢复为“默认”之前，辅助任务都会失败。',
	'settings.general.utility.unverifiedNote': '无法检查已安装的智能体。此选择仍在使用中。',
	'settings.general.utility.model': '模型覆盖',
	'settings.general.utility.modelPlaceholder':
		'例如 haiku、gpt-4o-mini（留空则使用智能体默认模型）',

	'settings.general.spell.heading': '拼写检查',
	'settings.general.spell.title': '启用拼写检查',
	'settings.general.spell.description':
		'在输入区域（提示词输入框、群聊、文件编辑器）中显示拼写检查建议。默认关闭。',

	'settings.general.power.heading': '电源',
	'settings.general.power.preventSleep': '工作时阻止休眠',
	'settings.general.power.preventSleepDescription':
		'当 AI 智能体忙碌、自动运行进行中或 Cue 流水线已排期时，让电脑保持唤醒',
	'settings.general.power.display': '保持屏幕常亮',
	'settings.general.power.displayDescription':
		'同时阻止屏幕保护程序、锁屏和空闲注销，让长时间运行的任务始终显示在屏幕上，并保持登录状态',
	'settings.general.power.displayDisabledTitle': '请先开启“工作时阻止休眠”',
	'settings.general.power.macWarning':
		'警告：macOS 会将亮着的屏幕视为有人在使用电脑，因此在智能体工作期间，常规维护任务会被搁置，包括 Spotlight 索引、照片分析、XProtect 扫描、时间机器清理和后台更新。作为交换，会话会保持活跃：不会启动屏幕保护程序、不会锁屏，也不会空闲注销。',
	'settings.general.power.linuxNote': '注意：在部分 Linux 桌面环境中支持可能有限。',

	'settings.general.rendering.heading': '渲染选项',
	'settings.general.rendering.gpu': '禁用 GPU 加速',
	'settings.general.rendering.gpuDescription': '使用软件渲染代替 GPU。重启后生效。',
	'settings.general.rendering.confetti': '禁用彩带动画',
	'settings.general.rendering.confettiDescription': '在获得成就和达成里程碑时不显示庆祝彩带效果',

	'settings.general.updates.heading': '更新',
	'settings.general.updates.check': '自动检查更新',
	'settings.general.updates.checkDescription':
		'在启动时以及应用运行期间每天检查一次 Maestro 新版本。同时会发送一次匿名签到（随机安装 ID、应用版本、操作系统和主题），以便统计活跃安装数。关闭此项会同时停用这两项功能。',
	'settings.general.updates.beta': '包括 Beta 版和候选发布版更新',
	'settings.general.updates.betaDescription':
		'选择接收预发布版本（例如 v0.11.1-rc、v0.12.0-beta）。这些版本可能包含实验性功能和缺陷。',

	'settings.general.privacy.heading': '隐私',
	'settings.general.privacy.title': '发送匿名崩溃报告',
	'settings.general.privacy.description':
		'自动发送崩溃报告，帮助改进 Maestro。不会收集个人数据。更改在重启后生效。',

	'settings.general.browser.heading': '默认浏览器',
	'settings.general.browser.title': '使用系统浏览器打开链接',
	'settings.general.browser.description':
		'控制点击链接时使用的默认浏览器。按住 {meta} 点击网址可打开上下文菜单并选择具体浏览器。',
	'settings.general.browser.htmlTitle': '双击时在 Maestro 浏览器中打开 HTML 文件',
	'settings.general.browser.htmlDescription':
		'启用后，在文件浏览器中双击 HTML 文件会在 Maestro 浏览器中打开，而不是文件预览。两种情况下都可以右键打开完整菜单。',
	'settings.general.browser.homeUrl': '浏览器主页网址',
	'settings.general.browser.homeUrlHelp':
		'打开新浏览器标签页（{shortcut}）时加载的网址。默认为空，新标签页会直接等待你输入地址，而不是先加载一个页面。',
	'settings.general.browser.keepAlive': '后台浏览器标签页',
	'settings.general.browser.keepAliveDescription':
		'默认情况下，不活跃的浏览器标签页会被卸载，返回时页面会重新加载并丢失内存中的状态。保持最近或全部标签页活跃可以保留其状态，但会占用更多内存（每个活跃标签页都会占用一个完整的浏览器进程）。',
	'settings.general.browser.keepOff': '不活跃时卸载',
	'settings.general.browser.keepRecent': '保持最近的活跃',
	'settings.general.browser.keepAll': '全部保持活跃',
	'settings.general.browser.keepLimit': '保持活跃的最近标签页数量',

	'settings.general.storage.heading': '存储位置',
	'settings.general.storage.folder': '设置文件夹',
	'settings.general.storage.description':
		'选择 Maestro 存储设置、会话和分组的位置（包括全局环境变量、智能体和配置）。使用同步文件夹（iCloud 云盘、Dropbox、OneDrive）即可在多台设备间共享。',
	'settings.general.storage.note': '注意：同一时间只在一台设备上运行 Maestro，以免产生同步冲突。',
	'settings.general.storage.defaultLocation': '默认位置',
	'settings.general.storage.currentCustom': '当前位置（自定义）',
	'settings.general.storage.migrating': '迁移中...',
	'settings.general.storage.changeFolder': '更改文件夹...',
	'settings.general.storage.chooseFolder': '选择文件夹...',
	'settings.general.storage.resetTitle': '恢复为默认位置',
	'settings.general.storage.useDefault': '使用默认位置',
	'settings.general.storage.migratedOne': '已迁移 {count} 个设置文件',
	'settings.general.storage.migratedMany': '已迁移 {count} 个设置文件',
	'settings.general.storage.restart': '重启 Maestro 后更改才会生效',
	'settings.general.storage.loadFailed': '加载存储设置失败',
	'settings.general.storage.changeFailed': '更改存储位置失败',
	'settings.general.storage.resetFailed': '重置存储位置失败',
	'settings.ignore.errorEmpty': '规则不能为空',
	'settings.ignore.errorExists': '规则已存在',
	'settings.ignore.honorGitignore': '遵循 .gitignore',
	'settings.ignore.honorGitignoreDescription':
		'启用后，也会从索引中排除 .gitignore 文件匹配的内容。',
	'settings.ignore.active': '已启用的规则：',
	'settings.ignore.remove': '移除规则',
	'settings.ignore.empty': '尚未配置忽略规则，将索引所有文件夹。',
	'settings.ignore.placeholder': '输入 glob 规则（例如 node_modules、*.log）',
	'settings.ignore.reset': '恢复默认规则（{defaults}）',
	'settings.filePanel.title': '文件面板设置',
	'settings.filePanel.description':
		'限制索引范围，避免超大目录占用过多内存。扫描达到条目上限时停止，并在文件面板显示警告及“加载更多 / 加载全部”按钮。',
	'settings.filePanel.maxDepth': '最大递归深度',
	'settings.filePanel.maxDepthHelp':
		'默认值为 {value}。扫描越深，发现的内容越多，但耗时和内存占用也越大。',
	'settings.filePanel.maxEntries': '文件条目上限',
	'settings.filePanel.maxEntriesHelp':
		'这是软上限，默认值为 {value}，有效范围为 {min} - {max}。扫描达到上限时，文件面板显示“加载更多 / 加载全部”按钮。',
	'settings.filePanel.sshReduce': '降低 SSH 远程扫描的条目上限',
	'settings.filePanel.sshReduceDescription':
		'远程扫描仅使用上限的一部分。通过 SSH 遍历每个目录都需要一次往返，因此较低的上限能更快返回大型远程目录的结果。',
	'settings.filePanel.sshFraction': 'SSH 上限比例',
	'settings.filePanel.sshFractionHelp':
		'SSH 上限：{entries} × {percent} = {resolved}。滑块步长为 5%。',
	'settings.filePanel.reset': '恢复默认值（深度 {depth}，{entries} 个条目）',
};
