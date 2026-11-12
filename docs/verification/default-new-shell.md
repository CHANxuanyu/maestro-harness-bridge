# Task N：hb.9 准备验证

分支 `codex/default-new-shell`，起点 `1d9ed9c9f`。本轮只验证源码，未构建发行包，未读写或复制真实账户、密钥或 Keychain。未推送、未创建远端 PR、未合并、未发布。待开 PR 正文见 [准备说明](default-new-shell-pr.md)。默认切换等待用户体验后明确决定，删除计划不授权删除。

## 设置落盘调查

- `src/main/stores/instances.ts` 用 electron-store 8.2.0 的 defaults 创建设置 store。当前安装的 `conf/dist/source/index.js` 构造器把 defaults 与 fileStore 合并；两者不同时执行 `this.store = store`。`set()` 也读出全量对象再写回。故磁盘上的 false 不证明用户主动选择过旧界面。
- renderer `setNewShell` 只写单键，`loadAllSettings` 水合不调用 setter。在线 CLI 经 `settings:set`，离线 CLI 经 `writeSettingValue` 读取整份 JSON、更新并写回。二者现在共用 `newShellChoicePatch`，主进程初始化时只迁移没有标记的设置。标记没有默认值，以免 conf 在迁移前填上它。
- main defaults、renderer defaults 和 settingsMetadata 同为 true。迁移写入 `auto`，显式切换写入 `new` 或 `classic`，与 `newShell` 同一次写入。其余设置和会话不迁移。
- 旧 E2E fixtures 显式选择 classic 来保留原测试目标；新安装场景删除 fixture settings 文件，升级场景改写为无标记的旧 false。现有“new shell first run asks only the updates question”场景去掉显式开启值，验证产品默认值。

## 失败先行

1. 首次 `npx vitest run src/__tests__/shared/newShellChoice.test.ts src/__tests__/cli/commands/settings-new-shell.test.ts src/__tests__/main/ipc/handlers/persistence.test.ts src/__tests__/renderer/stores/settingsStore.test.ts` 因 Vite 在只读依赖目录创建 `.vite-temp` 被 EPERM 拒绝，尚未执行断言。
2. 同一命令增加 `--configLoader runner --no-cache` 后，修复前有 5 个断言失败、406 项通过，另 1 个 suite 因尚无 migration 模块无法载入。失败覆盖主进程/CLI 默认值、renderer 默认值、UI/在线 CLI 的一次选择写入。
3. `node --test scripts/hb-baseline.test.mjs` 先因脚本模块不存在失败，随后实现参数/时间解析、尺寸统计和复用 `scripts/perf/summary.mjs` 的中位数。
4. `npm run test:e2e:fixtures -- --configLoader runner --no-cache e2e/fixtures/native/app-start.test.ts` 修复前 1 项失败、5 项通过，证明旧 fixture 尚未显式选择 classic。
5. 新目录不预设语言，启动夹具必须按 `project-start` 定位。增加断言后先观察 2 项失败，再移除英语按钮文案依赖；最终 `app-start.test.ts` 6 项通过。
6. 最终保留并通过迁移矩阵：新安装、升级缺值、旧 false 无标记、旧 true 无标记、迁移后明确 classic/new、二次启动不重复迁移、非布尔值拒绝。初始化 store 接线和离线 CLI 实际临时文件写入也有覆盖。没有放宽断言、跳过单元测试或添加重试。

## 最终命令与结果

| 命令                                                                                                                               | 结果                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `npx tsc -p tsconfig.json --noEmit`                                                                                                | 退出 0                                                               |
| `npm run lint`                                                                                                                     | 退出 0，包含 lint/main/cli 三份 TypeScript 检查                      |
| `npm run lint:eslint`                                                                                                              | 退出 0                                                               |
| `git diff --cached --name-only -z                                                                                                  | xargs -0 npx prettier --check`                                       | 退出 0；文件集合为提交中 `git diff-tree --no-commit-id --name-only -r HEAD` |
| 下方第一组 Vitest                                                                                                                  | 7 文件，487 项通过                                                   |
| 下方第二组 Vitest                                                                                                                  | 5 文件，323 项通过                                                   |
| `node --test scripts/hb-baseline.test.mjs`                                                                                         | 5 项通过                                                             |
| `npm run test:e2e:fixtures -- --configLoader runner --no-cache e2e/fixtures/native/app-start.test.ts`                              | 最终 6 项通过                                                        |
| `npm run test:e2e:fixtures`                                                                                                        | 退出 1；20 文件通过、1 文件失败，80 项通过、3 项失败，3 个未处理错误 |
| `npm run test:e2e:fixtures -- --configLoader runner --no-cache`                                                                    | 同样 80 通过、3 失败；没有绕过沙箱限制                               |
| `MAESTRO_E2E_REAL=0 npx playwright test e2e/native-new-shell-default.spec.ts e2e/native-new-shell.spec.ts --project=native --list` | 收集 16 个场景；未启动 Electron                                      |
| `git diff --check`                                                                                                                 | 退出 0                                                               |

Vitest 完整命令：

```sh
npx vitest run --configLoader runner --no-cache src/__tests__/shared/newShellChoice.test.ts src/__tests__/cli/commands/settings-new-shell.test.ts src/__tests__/main/ipc/handlers/persistence.test.ts src/__tests__/renderer/stores/settingsStore.test.ts src/__tests__/main/stores/instances.test.ts src/__tests__/main/stores/defaults.test.ts src/__tests__/cli/commands/settings-live.test.ts
npx vitest run --configLoader runner --no-cache src/__tests__/cli/services/storage.test.ts src/__tests__/renderer/hooks/useAppInitialization.test.ts src/__tests__/renderer/components/SettingsModal.test.tsx src/__tests__/renderer/i18n/newShellCopy.test.ts src/__tests__/shared/newShellFeatures.test.ts
```

夹具失败全部位于 `e2e/fixtures/native/protocol.test.ts`：shared app-server 驱动 connector、active rejection、queued rejection 三项。底层 `listen` 临时 `rpc.sock` 被 EPERM 拒绝，随后测试按原 5000ms 截止时间失败。没有修改这三项测试或它们的超时。其余夹具及本次修改的 app-start 测试通过。原始本地日志不入公共提交。

## Opus 沙箱外执行

```sh
npm run build
MAESTRO_E2E_REAL=0 npx playwright test e2e/native-new-shell-default.spec.ts e2e/native-new-shell.spec.ts --project=native --workers=1 --retries=0
npm run test:e2e:fixtures
node scripts/hb-baseline.mjs /absolute/path/to/hb.7.zip --runs 5 > /tmp/hb7-baseline.json
```

Electron 覆盖新目录默认落到项目起始页、只问更新、不显示经典欢迎与向导；旧 false 升级进入新界面，设置切回 classic 后重启仍保留，CLI 再切回 new 并重启仍保留。两份 spec 在 real 模式直接 `test.skip`，不会构造账户夹具。

基线脚本的启动、macOS sandbox 策略和退出尚未实机验证，只有纯逻辑测试通过；如策略拒绝启动应记录失败并修正，不能解除真实 home/Keychain 隔离。脚本仅支持 macOS，输入 `.app` 时无 ZIP 字节数，输出 null。冷启动不清系统页缓存；计时含 Playwright/sandbox 成本。详细定义见 [删除计划](../roadmap/new-shell-deletion-plan.md)。hb.7 的体积、启动数值及哈希仍待实际包测量，不能宣称 C4 性能验收完成。

分支 CI、用户一整天体验、默认切换决定、逐项删除决定、删除后全测试与包性能对比都未完成。它们不会被本次单元测试替代。
