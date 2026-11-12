# 新界面真实模型验收

这些场景供 Opus 在沙箱外运行。本轮仅编写和检查脚本，不代表真实模型或 Electron 验收通过。所有场景启用 `newShell`，使用临时 Git 项目、应用数据和原生账户目录，结束时删除临时目录。不要在真实项目里运行测试提示词，不要将输出附件提交到仓库。

## 准备

先构建当前分支，记录源码身份：

```sh
git rev-parse HEAD
npm run build:main
npm run build:renderer
npm run build:web-desktop
npm run build:cli
```

在运行测试的终端设置下列变量。不要把令牌或密钥写进命令行、仓库文件或终端回显。

| 变量                                                                    | 含义                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `MAESTRO_E2E_REAL=1`                                                    | 总开关。还须逐项打开下面的场景开关                                                                                                  |
| `MAESTRO_E2E_CLAUDE_PATH`                                               | 已安装 Claude CLI 的绝对路径                                                                                                        |
| `MAESTRO_E2E_CODEX_PATH`                                                | 已安装 Codex CLI 的绝对路径                                                                                                         |
| `MAESTRO_E2E_CLAUDE_MODEL`、`MAESTRO_E2E_CODEX_MODEL`                   | 明确指定本次验收模型；不使用账户默认模型                                                                                            |
| `MAESTRO_E2E_CLAUDE_EXPECT_VERSION`、`MAESTRO_E2E_CODEX_EXPECT_VERSION` | 完整 `--version` 输出的精确匹配。缺省使用 `real-runtime.cjs` 的固定版本。不同版本须先人工核对，再设置期望值；这不等于共享连接器准入 |
| `CLAUDE_CONFIG_DIR`                                                     | 显式选择的 Claude 登录来源目录，须含有效的 `.credentials.json`。不回退读取 keychain                                                 |
| `CODEX_HOME`                                                            | 显式选择的 Codex 登录来源目录，须含有效的 `auth.json`                                                                               |
| `MAESTRO_E2E_DEEPSEEK_KEY`                                              | 仅用户提供后由 Opus 注入环境。只传给临时应用的预设创建命令，不读或复制其他配置中的密钥                                              |
| `MAESTRO_E2E_TEMP_ROOT`                                                 | 可选，独立临时根目录；默认复用 `createNativeTempDir()`                                                                              |

Claude 和 Codex 使用订阅登录快照。`prepareCredentials()` 只读来源，Codex 快照移除 refresh token，Claude 仅把 access token 放入子进程环境。过期快照在任何版本探测、Electron 启动或父模型调用之前失败；Claude 错误为 `Claude access token has expired. Refresh the login outside acceptance before running again; snapshots cannot refresh.`。在测试之外刷新登录后重新明确运行，不在测试中刷新或重试。不继承 API key 作为订阅登录的替代。清除所有继承的 `MAESTRO_CALLER_*`；身份必须由应用注入。

`CI` 非空或 `MAESTRO_E2E_SMOKE=1` 时，即使继承了场景开关也跳过。DeepSeek 单项验收不需要 Claude 或 Codex 登录，只需要固定版本的 Claude Code 可执行文件和用户提供的 DeepSeek key。

## 逐项运行与额度预算

以下命令均需前述总开关。每次只运行一项，失败后先读附件，不自动重跑。

| 场景               | 命令                                                                                                                                                                | 预计用户回合数与范围                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A13/A15/A19 接力   | `MAESTRO_E2E_RELAY=1 npx playwright test --project=electron e2e/real-relay.spec.ts`                                                                                 | 3 回合：Claude 编辑、Codex 编辑、只读复核。另设 `MAESTRO_E2E_DEEPSEEK=1` 且有 key 时用 DeepSeek，否则用 Claude，并明确记录 DeepSeek 未覆盖 |
| B10 Claude 主控    | `MAESTRO_E2E_CLAUDE_ORCHESTRATOR=1 npx playwright test --project=electron e2e/real-claude-orchestrator.spec.ts`                                                     | 3 回合：Claude 父任务、Codex 子任务、子任务插话。子任务运行时提交走普通队列，若已结束则继续同一原生会话                                    |
| B9 Codex 派 Codex  | `MAESTRO_E2E_CODEX_ORCHESTRATOR=1 npx playwright test --project=electron e2e/real-codex-orchestrator.spec.ts --grep 'dispatches codex'`                             | 2 回合                                                                                                                                     |
| B9 Codex 派 Claude | `MAESTRO_E2E_CODEX_ORCHESTRATOR=1 MAESTRO_E2E_CLAUDE_CHILD=1 npx playwright test --project=electron e2e/real-codex-orchestrator.spec.ts --grep 'dispatches claude'` | 2 回合；Claude 快照必须有效。旧 `MAESTRO_E2E_CHILD_PROVIDER` 不再选择用例，两种子任务现在分别命名                                          |
| B8 自动交接        | `MAESTRO_E2E_AUTO_HANDOFF=1 npx playwright test --project=electron e2e/real-auto-handoff.spec.ts`                                                                   | 1 个真实 Codex 回合，加 1 个合成 Claude 限流错误。无需 Claude 登录                                                                         |
| B2 任务面板        | `MAESTRO_E2E_TASKS_PANEL=1 npx playwright test --project=electron e2e/real-tasks-panel.spec.ts`                                                                     | 2 回合：Codex `update_plan`、Claude `TodoWrite`；重启读回不调用模型                                                                        |
| A12/A18 DeepSeek   | `MAESTRO_E2E_DEEPSEEK=1 npx playwright test --project=electron e2e/real-deepseek.spec.ts`                                                                           | `2 + N` 回合：文本、图片、每档非空 effort 各一次。当前定义回退有 5 档，共 7 回合；运行发现超过 8 档时在调用前失败，要求重审预算            |

回合数不是 HTTP 请求数或固定金额：工具续接和提供方内部请求可能增加用量。提示词限定微型项目、短回答和工具次数；Claude 每次原生启动设 `--max-turns 8`，转发器另限制每个配置可启动的用户回合数。应用错误重试、自动命名、历史摘要、Playwright 重试均关闭。Codex 提示词限制工具调用数，并由测试超时终止；没有虚构 Codex 不支持的硬性工具次数参数。父任务轮询只读 Maestro，不产生额外模型请求。

## 证据与判定

每项的 `e2e-results/` 附件 `real-acceptance.json` 包含版本、请求模型、原生文件中的实际模型（提供方写入时）、临时原生转录路径及行数、调用参数、调用 cwd、caller 身份、退出码、断言记录和完成标志。失败时保留已有证据，关闭应用并清理临时账户；不复制 auth 文件到附件。Playwright 的失败截图和 trace 也只留本地。版本预检失败时尚未启动应用，错误直接出现在测试输出。

- 接力：两次精确文件编辑、相同 cwd、复核前后文件哈希与 Git diff 一致、三份转录、三条可点击的左栏会话及来源嵌套。排除应用自用 `.maestro/` 文件的哈希，不排除普通未跟踪文件。当前分支若尚未合入 A17 的嵌套修复，本场景必须失败，不改成顶层断言。
- 主控：父进程必须带应用注入的 caller，只有一个 dispatch 子任务，子任务结果包含提示词里没有的随机 README 内容，父任务引用它，子任务文件和转录存在。B10 还核对插话答案和同一原生转录。
- 自动交接：一条合成额度错误、一次真实启动、一个原生用户请求、一个自动来源记录；经过协调器下一次 tick 后仍没有重复。通知明确显示临时 Codex 账户。
- 任务面板：直接从临时原生转录提取工具输入，比较显示顺序、标签、状态、完成数量；每家均重启后复验。文本里伪造清单不算通过。为验证 TodoWrite，隔离环境设置 `CLAUDE_CODE_ENABLE_TASKS=false`。
- DeepSeek：本地透明 HTTP 转发器仍请求预设的官方端点，只记录模型、图片数量、thinking、effort 和状态码，不记录请求头、密钥或图片字节。`accepted` 同时要求 HTTP 成功、原生退出成功和预期回答。图片和 effort 拒绝是诊断结果，会继续测下一独立回合；基线文本失败则整项失败。`effortChangedRequest` 比较实际出站参数，不把 argv 变化冒充服务端生效。当前 DeepSeek 输入栏隐藏 effort，本场景通过已有 `tab effort` 逐项探测 Claude harness 能力定义/发现提供的档位，并记录这个差异；不修改能力表。报告通过仅代表采集完成，不能把拒绝项写成能力已支持。

这些是当前源码的开发构建验收，不是安装包验收，也不替代全天真人使用。任务面板的 CLI 清单读回和来源嵌套等产品缺口不在本测试任务里改动。

## 不调用真实模型的检查

```sh
npm run test:e2e:fixtures
npx tsc -p e2e/tsconfig.real-acceptance.json --noEmit
MAESTRO_E2E_REAL=0 npx playwright test --project=electron 'e2e/real-(relay|claude-orchestrator|codex-orchestrator|auto-handoff|tasks-panel|deepseek).spec.ts' --reporter=list
MAESTRO_E2E_REAL=1 MAESTRO_E2E_SMOKE=1 npx playwright test --project=electron 'e2e/real-(relay|claude-orchestrator|codex-orchestrator|auto-handoff|tasks-panel|deepseek).spec.ts' --reporter=list
```

后两条各应显示 7 个 skipped，不启动 Electron。`npm run test:e2e` 和 `npm run test:e2e:real-smoke` 默认选择 `--project=native`，本批 `real-*` 不在该项目内；手工选择 electron 项目时仍受上述 skip 保护。不要把跳过记为真实通过。
