# 新界面性能基准

只用临时目录中的合成数据，不读取个人账户，不调用模型。需要支持 zstd 的 Node 运行时和已有依赖，不安装或修改 `node_modules`。

```sh
node scripts/perf/native-history.mjs --rounds 7 --output /tmp/native-baseline.json
node scripts/perf/native-history.mjs --before <修改前提交> --rounds 7 --output /tmp/native-comparison.json
node scripts/perf/native-history.mjs --before <修改前提交> --after <修改后提交> --rounds 7 --output /tmp/native-commits.json
```

第二条命令通过 `git show` 打包修改前代码，不切换工作区。每轮交替 AB、BA，使用相同的临时语料，每个样本另起 Node 进程和元数据缓存。输出包含各次值、中位数、最近秩 p95、CPU 时间、事件循环最大延误、结束时 RSS、堆增量、进程最大 RSS、运行前后系统负载及两份打包代码的 SHA-256。7 次样本的 p95 就是最大值，不能当成稳定的服务等级。没有清空操作系统页缓存；这里的 cold 指应用缓存为空。

数据是 20 个非 Git 项目、2000 份转录，Claude 与 Codex 各 1000 份，Codex 中 250 份为 zstd。最大普通转录和最大压缩转录解压后都是 50 MiB。独立转换用例含 5000 条消息、1250 条带工具结果的消息和代码块。默认项目发现仍遵守 1024 文件上限；另测放宽预算后的完整扫描，不能把前者的计数称为全量。项目历史分别测真实适配器完整路径和已加载列表的纯归属整理。

压缩文件放在适配器支持的 `sessions/YYYY/MM/DD/` 内。每个样本断言完整项目发现累计 2000 份转录、项目历史返回 2000 条且无错误、普通与 zstd 长会话均解析出 3750 条消息并分页返回 500 条、5000 条源消息转换出 6250 个显示条目。任一断言或结果摘要不符即失败，不重试。早期语料放在 `archived_sessions`，暴露了会话适配器不扫描该目录的已有限制；旧结果保留并标记 `supersededBy`，只采用 `results/validated-*.json`。

存储、解析、转换和 `PerformanceMetrics` 使用生产实现。Node 打包只替换 Electron 路径、空 origins store、日志、遥测和不可调用的远程边界。所有账户均显式传入，Git 工作树、SSH、真实磁盘冷读和 Electron IPC 不在 Node 测量内。每次对完整结果做语义摘要校验，前后不同直接失败。计时不含建语料、打包、GC 和摘要计算；内存是观察值，不是对象独占内存。

Electron 基准默认跳过，不能在沙箱里启动。由 Opus 构建后执行：

```sh
npm run build:main
npm run build:renderer
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=7 npx playwright test e2e/perf-new-shell.spec.ts --project=electron --workers=1 --retries=0
```

同轮前后对比还需设置 `MAESTRO_PERF_BEFORE_ENTRY=/绝对路径/修改前构建/dist/main/index.js`。保留该入口相邻的 renderer 和 preload 构建，使用同一依赖、构建模式和窗口条件。只指定一个构建时报告只称为基线。空数据启动先测起始页可用，再打开合成项目测输入框可编辑，不输入或发送提示。大数据启动与切换使用 5000 条持久消息；50 MiB 原生历史另测侧栏点击到末尾正文可见、输入框可编辑的首屏时间。历史列表就绪等待单列；解析、转换和 IPC 均包含在点击到首屏内，Node 基准另外测读取解析与转换。

滚动记录 rAF 帧间隔、相对 60 Hz 的估算缺帧、长任务、CDP 主线程任务和脚本时间、DOM 节点、堆大小及 main 的 RSS。流式输出以 100 Hz 注入 300 个合成 `process:data` 事件，经过真实 preload、批处理和渲染，不启动提供方。停止短 trace 后另测渐进渲染到第一条消息进入 DOM 的剩余等待，避免只验证末尾而漏掉被截短的历史。空数据和大量数据每次使用独立临时配置。原始 JSON 和 trace 位于 Playwright 的用例输出目录；记录入口哈希、运行负载，原始 trace 不提交。

`npx tsc --noEmit -p scripts/perf/tsconfig.json` 单独检查 Electron 基准及其导入。根 `tsconfig.json` 不包含 `e2e/`，不能用根类型检查通过代替这个检查。

```sh
node scripts/analyze-perf-trace.mjs <用例输出目录>/after-0-trace.json > /tmp/perf-analysis.md
```

复用生产 `buildTraceConfig()` 的采集类别。输入框可编辑是 readiness 代理，rAF 延误是流畅性代理，不声称测到硬件呈现帧。尚未运行的 Electron 结果不得填入 Node 报告。新增基准没有产品界面动作，也没有新增 CLI 动词。
