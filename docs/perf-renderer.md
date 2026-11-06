# 新界面 renderer 性能复测

入口为 `e2e/perf-renderer.spec.ts`。第一轮的 `perf-new-shell.spec.ts` 保留原样。第二轮使用同一合成语料，每轮交替 before 和 after，默认五轮，失败不重试。所有账户和应用数据都在独立临时目录，工具路径指向原生测试替身，不启动模型。

## 准备与运行

先保存第一轮 after 的完整构建目录，再构建本轮源码。只保存 `dist/main/index.js` 不够，依赖模块和 renderer 也必须冻结。`MAESTRO_PERF_BEFORE_ENTRY` 指向该冻结目录的 `dist/main/index.js`，输出目录使用仓库外路径。

```sh
npm run build:main
npm run build:renderer
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=5 MAESTRO_PERF_BEFORE_ENTRY=<冻结构建的绝对路径>/dist/main/index.js npx playwright test e2e/perf-renderer.spec.ts --project=electron --workers=1 --retries=0 --output=<仓库外输出目录>
```

没有 `MAESTRO_PERF_BEFORE_ENTRY` 时只测当前构建。输出包含每个 main 和 renderer 文件的 SHA-256，避免入口文件相同却误认为两个构建相同。不要把原始数据和 trace 提交到仓库。

## 指标与边界

- 启动可用必须等闪屏移除和两帧绘制。时间线以进程创建时刻为零点，记录主进程模块就绪、store、app ready、核心服务、历史、统计、IPC、窗口创建，以及 renderer 文档、模块、数据就绪和闪屏移除。旧构建没有新增标记，字段会缺失，不能补零推算。
- 文档到模块就绪包含脚本读取、解析和执行，不能直接叫作解析 CPU 时间。窗口开始到创建完成只测同步创建，不含后续 renderer 加载。各阶段实际占比需看返回的数据。
- 打开 50 MiB 原生历史、切换 5000 条消息分别测首屏。切换后立即测剩余回填，结束后比较全部规范显示行 ID 的顺序，包含折叠活动宿主。历史没有因性能测量被截短。
- 每个交互阶段发送无文本的 Shift 按键，记录事件等待及事件到下一动画帧的 p95 和最大等待。不会写入或提交草稿。它是键盘响应代理，不是文字插入或 GPU 呈现延迟。
- 流式场景等完整历史回填后才注入 300 个、间隔 10 ms 的合成 `process:data` 事件，避免把回填脚本记入纯流式。第一轮含重叠，因此两种基准的总时间不能直接相减。
- 保留滚动、帧间隔、长任务、renderer 脚本时间、DOM 数量及两进程内存。没有修改滚动实现。

## 单独采 trace

普通计时不启用采样 profiler。需要归因时另跑，不能把带 profiler 的结果当作普通耗时。

```sh
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=3 MAESTRO_PERF_TRACE=1 npx playwright test e2e/perf-renderer.spec.ts --project=electron --workers=1 --retries=0 --output=<交互 trace 输出目录>
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=3 MAESTRO_PERF_STARTUP_TRACE=1 npx playwright test e2e/perf-renderer.spec.ts --project=electron --workers=1 --retries=0 --output=<启动 trace 输出目录>
node scripts/analyze-perf-trace.mjs <trace.json>
```

交互 trace 按阶段分别录制，包含剩余回填，并检查缓冲区未接近满载。启动 trace 通过 Chromium 启动参数覆盖前五秒，仅执行启动场景。两种采集模式互斥；若启动超过五秒，采集窗口不够，不能宣称完整归因。启动 flags 与实际原生运行仍需外部验证。

## 沙箱内回归

```sh
npx vitest run src/__tests__/renderer/components/TerminalOutput/TerminalOutput.performance.test.tsx src/__tests__/renderer/hooks/agent/internal/useAgentDataListener.performance.test.tsx src/__tests__/renderer/splashPerformance.test.ts --configLoader runner --no-cache
PERF_ROW_COUNT=5000 npx vitest run src/__tests__/renderer/components/TerminalOutput/TerminalOutput.performance.test.tsx --configLoader runner --no-cache --disableConsoleIntercept
npx tsc --noEmit -p tsconfig.json
```

行元素回归替换了重型行组件，计时包含 jsdom 和探针开销，只用来确认重复构造的数量与全部行顺序。事件回归使用真实 listener、batcher 和 store，覆盖尾批、卸载、切换界面和其他标签。实际交互是否改善，由上面的 Electron 数据判断。
