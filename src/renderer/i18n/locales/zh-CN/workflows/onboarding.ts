import type { onboarding as en } from '../../en/workflows/onboarding';
import type { AreaTranslation } from '../../types';

export const onboarding: AreaTranslation<typeof en> = {
	'workflows.welcome.title': '欢迎使用 Maestro',
	'workflows.welcome.intro': 'Maestro 是一款编排工具，旨在：',
	'workflows.welcome.goalParallelTitle': '并行管理多个 AI 智能体',
	'workflows.welcome.goalParallelBody':
		'同时运行多个编程助手，每个都在各自的会话中，随时轻松切换。',
	'workflows.welcome.goalAutoRunTitle': '通过 Auto Run 实现无人值守自动化',
	'workflows.welcome.goalAutoRunBody':
		'把任务清单写进 Markdown 文档排好队，你离开时智能体会自动逐项执行。',
	'workflows.welcome.howItWorksLabel': '工作方式：',
	'workflows.welcome.howItWorksBody':
		'Maestro 直接透传到你的 AI 提供方。你的 MCP 工具、技能和权限与直接运行该提供方时完全一致。',
	'workflows.welcome.accessModes':
		'智能体默认处于“完全访问”模式，工具调用会被自动接受。如需安全护栏，可在工具栏切换到“标准”或“只读”模式。',
	'workflows.welcome.getStarted': '开始使用：手动创建你的第一个智能体，或借助 AI 向导创建。',
	'workflows.welcome.readMore': '在 docs.runmaestro.ai/getting-started 了解更多',

	'workflows.emptyState.menu': '菜单',
	'workflows.emptyState.wizard': '新建智能体向导',
	'workflows.emptyState.wizardHint': '借助 AI 快速上手',
	'workflows.emptyState.tour': '功能导览',
	'workflows.emptyState.tourHint': '熟悉界面',
	'workflows.emptyState.shortcuts': '键盘快捷键',
	'workflows.emptyState.checkUpdates': '检查更新',
	'workflows.emptyState.checkUpdatesHint': '获取最新版本',
	'workflows.emptyState.website': 'Maestro 官网',
	'workflows.emptyState.websiteHint': '访问 runmaestro.ai',
	'workflows.emptyState.docs': '文档',
	'workflows.emptyState.docsHint': '在 docs.runmaestro.ai 查看使用文档',
	'workflows.emptyState.about': '关于 Maestro',
	'workflows.emptyState.aboutHint': '版本、致谢、统计',
	'workflows.emptyState.createFirstAgent': '创建你的第一个智能体',

	'workflows.typography.titleReturning': 'Maestro 有了新的字体排版',
	'workflows.typography.titleNew': '选择字体排版',
	'workflows.typography.fineTune': '在设置中微调',
	'workflows.typography.use': '使用 {name}',
	'workflows.typography.selected': '已选择',
	'workflows.typography.monospace': '等宽',
	'workflows.typography.proportional': '比例',
	'workflows.typography.introReturning':
		'我们对外观做了一点调整。你一直在使用 Hacker，即所有界面都使用等宽字体。新的“默认”方案只在真正需要的地方保留等宽字体（终端、文件预览和编辑器），界面和 AI 对话则使用比例字体。如果你更喜欢现在的样子，它依然可选。',
	'workflows.typography.introNew':
		'选择 Maestro 的阅读方式。“默认”只在真正需要的地方保留等宽字体（终端、文件预览和编辑器），界面和 AI 对话使用比例字体。Hacker 则全部使用等宽字体。',
	'workflows.typography.footnote':
		'这只是起点，随时可以更改。“设置 → 显示”中可以为每个界面单独选择字体，还能调整字号、填写自定义字体名称，并用上/下方向键实时切换字体。',
	'workflows.typography.preset.default': '默认',
	'workflows.typography.preset.defaultTagline': '阅读用比例字体，工作用等宽字体。',
	'workflows.typography.preset.hacker': 'Hacker',
	'workflows.typography.preset.hackerTagline': '处处等宽。最初的 Maestro。',
	'workflows.typography.surface.interface': '界面',
	'workflows.typography.surface.aiChat': 'AI 对话',
	'workflows.typography.surface.terminal': '终端',
	'workflows.typography.surface.filePreview': '文件预览',
	'workflows.typography.surface.documentGraph': '文档关系图',
	'workflows.typography.surface.fileEditor': '文件编辑器',

	'workflows.themeChoice.titleReturning': '打造你的 Maestro',
	'workflows.themeChoice.titleNew': '选择主题',
	'workflows.themeChoice.customize': '在设置中自定义',
	'workflows.themeChoice.choose': '选择 {name}',
	'workflows.themeChoice.keep': '保留 {name}',
	'workflows.themeChoice.switchTo': '切换到 {name}',
	'workflows.themeChoice.thisTheme': '此主题',
	'workflows.themeChoice.introReturning':
		'顺便说一下：自安装 Maestro 以来你一直在使用默认主题。我们还提供了更多深色和浅色主题。点击任意一个即可试用，整个应用会随之变化，在你确认保留之前不会保存任何更改。',
	'workflows.themeChoice.introNew':
		'Maestro 内置了一组深色和浅色主题。点击任意一个即可试用，整个应用会随之变化，在你确认保留之前不会保存任何更改。',
	'workflows.themeChoice.footnote':
		'你可以随时更改。“设置 → 主题”中包含这里的所有主题，还有一个可以逐个设置颜色的“自定义”主题。',
	'workflows.themeChoice.dark': '深色',
	'workflows.themeChoice.darkHint': '长时间使用也不累眼。',
	'workflows.themeChoice.light': '浅色',
	'workflows.themeChoice.lightHint': '适合明亮环境和共享屏幕。',
	'workflows.themeChoice.vibe': '个性',
	'workflows.themeChoice.vibeHint': '更鲜明的配色，随心情切换。',

	'workflows.updatesChoice.title': '抢先体验最新功能',
	'workflows.updatesChoice.recommended': '推荐',
	'workflows.updatesChoice.intro':
		'如果你想第一时间用上最新功能，强烈建议加入候选版本更新。也请保持崩溃报告开启：它能帮助我们在问题出现时自动、快速地修复。',
	'workflows.updatesChoice.autoCheck': '自动检查更新',
	'workflows.updatesChoice.autoCheckDescription': '启动时以及运行期间每天检查一次 Maestro 新版本。',
	'workflows.updatesChoice.beta': '包含测试版和候选版本更新',
	'workflows.updatesChoice.betaDescription':
		'在稳定版发布之前抢先获得新功能。预发布版本可能包含缺陷。',
	'workflows.updatesChoice.crashReports': '发送匿名崩溃报告',
	'workflows.updatesChoice.crashReportsDescription':
		'帮助我们及时发现并修复问题。不收集任何个人数据。重启后生效。',
	'workflows.updatesChoice.cliTitle': 'Maestro CLI',
	'workflows.updatesChoice.cliDescription':
		'Maestro CLI 也可供人使用，但它主要是为你的智能体设计的，让它们能够自动完成 Maestro 能做的一切。强烈建议安装。',
	'workflows.updatesChoice.cliInstalled': '已安装',
	'workflows.updatesChoice.cliInstalling': '正在安装...',
	'workflows.updatesChoice.cliChecking': '正在检查...',
	'workflows.updatesChoice.cliUpdate': '更新 Maestro CLI',
	'workflows.updatesChoice.cliInstall': '安装 Maestro CLI',
	'workflows.updatesChoice.footnote': '以上是你当前的设置，之后可以在“设置 → 通用”中随时更改。',

	// Agent capabilities disclosure
	'workflows.agentPowers.title': '智能体也能操作 Maestro',
	'workflows.agentPowers.confirm': '知道了',
	'workflows.agentPowers.intro':
		'你刚刚有机会手动选择字体排版和主题。其实，你能在 Maestro 中完成的操作，里面的智能体也能完成。它们可以使用界面背后的相同控制功能，你只需直接提出要求。',
	'workflows.agentPowers.description':
		'Maestro 是一款功能强大的工具。如果你习惯用键盘操作，这里会让你得心应手：快捷键覆盖各项功能，双手不离键盘也能同时调度数十个智能体。你也不必采用这种方式才能受益。每个在 Maestro 中运行的智能体都会获得操作 Maestro 的相关知识，包括 Auto Run 和 Cue 流程等高级功能。所以，只需用自然语言说出需求，让智能体为你找到实现方法。',
	'workflows.agentPowers.tryExample': '点击上方任一示例，即可将请求填入输入框。',
	'workflows.agentPowers.settings.label': '修改任意设置',
	'workflows.agentPowers.settings.prompt':
		'将 AI 对话字体设为 Inter，切换到浅色主题，并开启系统通知。',
	'workflows.agentPowers.agents.label': '创建智能体',
	'workflows.agentPowers.agents.prompt':
		'创建一个名为 Scratch 的新智能体，工作目录设为我的主目录。',
	'workflows.agentPowers.autoRun.label': '编写 Auto Run 文档',
	'workflows.agentPowers.autoRun.prompt':
		'为我编写一份 Auto Run 文档，检查此仓库中的 TODO，并将它们列为任务。',
	'workflows.agentPowers.schedule.label': '安排定时任务',
	'workflows.agentPowers.schedule.prompt': '每个工作日上午 9 点，汇总此仓库在夜间发生的变更。',
	'workflows.agentPowers.pipeline.label': '构建 Cue 流程',
	'workflows.agentPowers.pipeline.prompt': '每当此仓库新建拉取请求时，让智能体审查并报告结果。',
	'workflows.agentPowers.dashboard.label': '创建仪表盘',
	'workflows.agentPowers.dashboard.prompt':
		'为此仓库创建一个 HTML 仪表盘，展示每周提交数、主要贡献者和未完成的 TODO。',
};
