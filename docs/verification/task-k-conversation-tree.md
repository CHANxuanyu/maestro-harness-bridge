# Task K 会话树验证记录

验证对象：基线 `1d9ed9c9f` 上的 `codex/handoff-nesting` 源码，2026-11-12。没有构建发行包，没有启动 Electron、真实模型或读取个人原生账户。

## 改动范围

- `src/shared/conversationChildren.ts`、`src/renderer/utils/projectSessionTree.ts`：交接与复核、子任务共用父节点匹配。归档来源时，未归档的交接提升到自己的项目顶层；复核与子任务的归档阻止规则不变。删除了把显示关系与归档阻止混在一起的 `isMovedWork` 辅助函数。
- `src/renderer/services/conversationChildren.ts`、`Session.conversationTreeExpanded`、左栏两层组件及 sidebar equality：展开选择保存到所属会话数据；未选择时可因运行或选中子对话自动展开，完成不自动收起，显式收起继续保留。来源标签关闭后按原生 ID 读回。
- `src/cli/commands/tab.ts`、`src/cli/index.ts`、窗口 IPC/preload、remote integration、desktop inventory：UI 与 CLI 共用所属窗口的读取和保存入口，JSON 返回 `expanded`；`--native` 查询只读。新旧界面分别保持自己的行为。
- `src/renderer/services/agentDelegation.ts`：仍由 `captureConversationSourceNativeId()` 补写来源，经过窗口注册表通知子对话所属窗口，核对响应窗口并等其保存；包括保留的运行标签，不覆盖已有原生 ID。晚到原生 ID 同时迁移展开选择。
- 中英文目录、CLI 对等表、原规格段落和 changelog 同步更新。相关单元测试与三份合成 Electron 场景见下方命令。

## 先失败的回归

1. `conversationChildren.test.ts` 与 `conversationChildrenTree.test.ts`：修改前 4 项断言失败，16 项通过，覆盖交接嵌套、关闭来源后的原生 ID 挂回，以及打开/关闭来源的归档场景。
2. `agentDelegation.test.ts` 与 `ProjectSessionTree.test.tsx`：修改前 2 项断言失败，55 项通过，分别复现保留子标签未补写晚到原生 ID、运行结束后树自动收起。
3. `tab.test.ts` 与 `windows.test.ts`：修改前 2 项断言失败，123 项通过，分别复现无法按关闭来源的原生 ID 查询、缺少所属窗口 disclosure 路由。

没有跳过测试、放宽断言或增加重试。旧的“下一次运行重新展开”断言改成保留用户显式收起，符合本任务要求。

## 命令与结果

- `npx tsc -p tsconfig.json --noEmit`：退出 0。
- `npm run lint`：退出 0，包含 renderer/shared、main、CLI 三份正式配置。
- `npm run lint:eslint`：退出 0。
- `git diff --cached --name-only --diff-filter=ACM -z | xargs -0 npx prettier --check`：检查全部已暂存改动文件，退出 0。
- 下方 Vitest 命令：14 个文件、591 项通过，无失败、无跳过。

```sh
npx vitest run --configLoader runner \
	src/__tests__/shared/conversationChildren.test.ts \
	src/__tests__/renderer/utils/conversationChildrenTree.test.ts \
	src/__tests__/renderer/utils/projectSessionTree.test.ts \
	src/__tests__/renderer/services/agentDelegation.test.ts \
	src/__tests__/renderer/services/conversationChildren.test.ts \
	src/__tests__/renderer/services/conversationArchive.test.ts \
	src/__tests__/renderer/components/ProjectSessionTree.test.tsx \
	src/__tests__/cli/commands/tab.test.ts \
	src/__tests__/main/ipc/handlers/windows.test.ts \
	src/__tests__/main/preload/windows.test.ts \
	src/__tests__/cli/commands/native-history-bridge.test.ts \
	src/__tests__/main/cross-agent-router.test.ts \
	src/__tests__/renderer/hooks/useRemoteIntegration.test.ts \
	src/__tests__/renderer/hooks/utils/useDebouncedPersistence.test.ts
```

首次直接 `npx vitest run ...` 因只读的外部 `node_modules` 符号链接不能写 `.vite-temp` 而未启动。之后使用 Vite 支持的 `--configLoader runner`，实际运行到上述断言失败再修复。开发中 `npm run lint` 曾发现缺少 `useT()` 绑定，已修复后重跑通过；组件测试控制器最初复制了未改动的行，破坏原有引用相等断言，修复控制器以保留行引用后原断言通过。

```sh
MAESTRO_E2E_REAL=0 npx playwright test e2e/native-new-shell.spec.ts e2e/native-subtasks.spec.ts e2e/native-cross-window-subtasks.spec.ts --project=native --list
```

退出 0，收集 3 文件、17 场景；没有启动 Electron。三份变动场景通过临时配置的 `npx tsc -p /tmp/task-k-e2e-tsconfig.json --noEmit` 检查。该配置继承正式 lint 配置，包含这三份场景、原生 CJS 夹具和 renderer 全局声明，并按 Node 测试运行时使用 `ES2023` 库；首次沿用应用的 ES2020 库时，既有夹具的 `findLast` 和 `Error.cause` 声明不匹配，改正临时检查环境后退出 0。没有改动夹具，因此未运行条件要求的 `npm run test:e2e:fixtures`。

## Opus 需在沙箱外运行

```sh
npm run build
MAESTRO_E2E_REAL=0 npx playwright test e2e/native-new-shell.spec.ts e2e/native-subtasks.spec.ts e2e/native-cross-window-subtasks.spec.ts --project=native --workers=1 --retries=0
```

重点核对：hb.7 交接行嵌套、来源归档后提升、取消归档后挂回；任务完成后保留展开、CLI 展开/收起读回、重启保留；跨窗口在来源原生 ID 尚未到达时先创建子对话，再向来源窗口送达合成 provider 事件，确认子对话所属窗口已经保存该 ID，关闭来源及重启后仍挂回。真实模式在构造 `NativeApp` 前 `test.skip`。

沙箱禁止启动 Electron，因此未宣称这些场景通过。未验证真实模型、真实 SSH、安装包或人工全天使用；既有缺失来源且无法恢复身份的历史记录不会被猜测重建。
