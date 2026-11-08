export default {
	'workflows.newShellCopy.composer.conversations': '对话',
	'workflows.newShellCopy.composer.conversation': '对话',
	'workflows.newShellCopy.composer.conversationCountOne': '条对话',
	'workflows.newShellCopy.composer.conversationsCount': '条对话',
	'workflows.newShellCopy.composer.noConversations': '没有可用的对话',
	'workflows.newShellCopy.composer.openConversation': '在左栏打开另一条对话，即可向它提问。',
	'workflows.newShellCopy.composer.onlyOne': '由 {names} 回答，当前对话不运行。',
	'workflows.newShellCopy.composer.onlyMany': '由 {names} 回答，当前对话不运行。',
	'workflows.newShellCopy.composer.onlyHint': '把提及放到消息后面，可让当前对话也参与回答。',
	'workflows.newShellCopy.composer.parallelOne': '正在咨询 {names}，当前对话收到回复后才会结束。',
	'workflows.newShellCopy.composer.parallelMany': '正在咨询 {names}，当前对话收到回复后才会结束。',
	'workflows.newShellCopy.composer.parallelHint':
		'目前按英文语句判断顺序。先咨询可写“check with @Review first”；答完再转交可写“then send what you find to @Review”。把 @Review 换成对话名称。',
	'workflows.newShellCopy.composer.firstOne': '{names} 先回答，当前对话收到回复后再开始。',
	'workflows.newShellCopy.composer.firstMany': '{names} 先回答，当前对话收到回复后再开始。',
	'workflows.newShellCopy.composer.firstHint':
		'去掉消息里的“first”或“based on what @Review says”，可让双方同时运行。',
	'workflows.newShellCopy.composer.handoff': '当前对话先回答，再将回答交给 {names}。',
	'workflows.newShellCopy.composer.handoffHint':
		'回复会显示在这里，不会自动开始下一轮。去掉消息里的“send it to”或“let @Review know”，可让双方同时运行。',
	'workflows.newShellCopy.composer.handoffLabel': '交接',
	'workflows.newShellCopy.composer.fullHint':
		'读取、写入和运行命令无需确认。此模式不显示工具发来的追问。',
	'workflows.newShellCopy.composer.standardHint':
		'使用工具默认权限，在这里处理批准请求和追问。未获批准的文件编辑和命令可能直接被拒绝，不显示提示。',
	'workflows.newShellCopy.composer.readonlyHint': '仅查看和规划，不写入文件或运行命令。',
	'workflows.newShellCopy.composer.planHint': '规划任务，不修改文件。',
	'workflows.newShellCopy.composer.toolReadonlyHint': '可以查看文件，不修改文件。',
	'workflows.newShellCopy.composer.plan': '计划模式',
	'workflows.newShellCopy.composer.readonly': '只读',
	'workflows.newShellCopy.composer.commandModeHint': '在终端运行命令，不发送消息。',
	'workflows.newShellCopy.composer.commandPlaceholder': '输入终端命令。! 生成命令，Esc 返回对话。',
	'workflows.newShellCopy.composer.draftTokens': '约 {tokens} 个词元',
} as const;
