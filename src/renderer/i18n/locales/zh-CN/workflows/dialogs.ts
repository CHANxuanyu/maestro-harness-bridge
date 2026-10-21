import type { dialogs as en } from '../../en/workflows/dialogs';
import type { AreaTranslation } from '../../types';

export const dialogs: AreaTranslation<typeof en> = {
	'workflows.shared.closeModal': '关闭对话框',

	'workflows.renameAgent.title': '重命名智能体',
	'workflows.renameAgent.placeholder': '输入智能体名称...',

	'workflows.renameTab.title': '重命名标签页',
	'workflows.renameTab.placeholder': '输入标签页名称...',
	'workflows.renameTab.placeholderWithId': '重命名 {id}...',
	'workflows.renameTab.auto': '自动',
	'workflows.renameTab.autoTitle': '自动命名（{keys}）',

	'workflows.group.renameTitle': '重命名分组',
	'workflows.group.createTitle': '新建分组',
	'workflows.group.nameLabel': '分组名称',
	'workflows.group.namePlaceholder': '输入分组名称...',
	'workflows.group.insideFolder': '所在文件夹',
	'workflows.group.topLevel': '顶层',

	'workflows.deleteAgent.title': '确认删除',
	'workflows.deleteAgent.agentOnly': '仅删除智能体',
	'workflows.deleteAgent.agentAndDirectory': '智能体及工作目录',
	'workflows.deleteAgent.danger': '危险：',
	'workflows.deleteAgent.warning': '你即将删除智能体“{name}”。此操作无法撤销。',
	'workflows.deleteAgent.directoryNote': '选择{option}还会将工作目录移到废纸篓：',
	'workflows.deleteAgent.typeNamePrompt': '在下方输入智能体名称以启用工作目录删除：',
	'workflows.deleteAgent.typeNameLabel': '确认智能体名称',

	'workflows.deleteGroupChat.title': '删除群聊',
	'workflows.deleteGroupChat.question': '确定要删除“{name}”吗？',
	'workflows.deleteGroupChat.detail': '这将永久删除该群聊及其全部消息。参与者的会话不受影响。',
	'workflows.renameGroupChat.title': '重命名群聊',
	'workflows.renameGroupChat.label': '群聊名称',
	'workflows.renameGroupChat.placeholder': '输入新名称...',

	'workflows.newAgentChoice.title': '新建智能体',
	'workflows.newAgentChoice.manual': '手动设置',
	'workflows.newAgentChoice.manualDescription': '直接选择智能体、工作目录和配置选项。',
	'workflows.newAgentChoice.guided': '引导设置',
	'workflows.newAgentChoice.guidedDescription':
		'通过交互式向导分析你的项目，并生成量身定制的剧本。',
	'workflows.newAgentChoice.noteLabel': '提示：',
	'workflows.newAgentChoice.note':
		'引导向导完成前会占用应用的输入。想要更轻量的方式，可以先手动创建智能体，然后运行 {command} 或点击 Auto Run 面板中的 {icon} 按钮。标签页内向导可以与其他工作并行进行。',
};
