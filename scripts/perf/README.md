# 新界面性能基准

只用临时目录中的合成数据，不读取个人账户，不调用模型。需要支持 zstd 的 Node 运行时和已有依赖，不安装或修改 `node_modules`。

```sh
node scripts/perf/native-history.mjs --rounds 7 --output /tmp/native-baseline.json
node scripts/perf/native-history.mjs --before <修改前提交> --rounds 7 --output /tmp/native-comparison.json
```

第二条命令通过 `git show` 打包修改前代码，不切换工作区。每轮交替 AB、BA，使用相同的临时语料，每个样本另起 Node 进程和元数据缓存。输出包含各次值、中位数、最近秩 p95、CPU 时间、事件循环最大延误、结束时 RSS、堆增量、进程最大 RSS、运行前后系统负载。7 次样本的 p95 就是最大值，不能当成稳定的服务等级。没有清空操作系统页缓存；这里的 cold 指应用缓存为空。

数据是 20 个非 Git 项目、2000 份转录，Claude 与 Codex 各 1000 份，Codex 中 250 份为 zstd。最大普通转录和最大压缩转录解压后都是 50 MiB。独立转换用例含 5000 条消息、1250 条带工具结果的消息和代码块。默认项目发现仍遵守 1024 文件上限；另测放宽预算后的完整扫描，不能把前者的计数称为全量。项目历史分别测真实适配器完整路径和已加载列表的纯归属整理。

存储、解析、转换和 `PerformanceMetrics` 使用生产实现。Node 打包只替换 Electron 路径、空 origins store、日志、遥测和不可调用的远程边界。所有账户均显式传入，Git 工作树、SSH、真实磁盘冷读和 Electron IPC 不在 Node 测量内。每次对完整结果做语义摘要校验，前后不同直接失败。计时不含建语料、打包、GC 和摘要计算；内存是观察值，不是对象独占内存。

Electron 基准默认跳过，不能在沙箱里启动。由 Opus 构建后执行：

```sh
npm run build:main
npm run build:renderer
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=7 npx playwright test e2e/perf-new-shell.spec.ts --project=electron --workers=1 --retries=0
```

同轮前后对比还需设置 `MAESTRO_PERF_BEFORE_ENTRY=/绝对路径/修改前构建/dist/main/index.js`。保留该入口相邻的 renderer 和 preload 构建，使用同一依赖、构建模式和窗口条件。只指定一个构建时报告只称为基线。空数据启动先测起始页可用，再打开合成项目测输入框可编辑，不输入或发送提示。大数据启动与切换使用 5000 条持久消息；50 MiB 原生读取单独测 IPC 返回，不能把它当成原生历史点击到首屏时间。

滚动记录 rAF 帧间隔、相对 60 Hz 的估算缺帧、长任务、CDP 主线程任务和脚本时间、DOM 节点、堆大小。流式输出以 100 Hz 注入 300 个合成 `process:data` 事件，经过真实 preload、批处理和渲染，不启动提供方。空数据和大量数据每次使用独立临时配置。原始 JSON 和 trace 位于 Playwright 的用例输出目录；记录入口哈希、运行负载，原始 trace 不提交。

```sh
node scripts/analyze-perf-trace.mjs <用例输出目录>/after-0-trace.json > /tmp/perf-analysis.md
```

复用生产 `buildTraceConfig()` 的采集类别。输入框可编辑是 readiness 代理，rAF 延误是流畅性代理，不声称测到硬件呈现帧。尚未运行的 Electron 结果不得填入 Node 报告。新增基准没有产品界面动作，也没有新增 CLI 动词。
