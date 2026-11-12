# 新界面 renderer 性能复测

入口为 `e2e/perf-renderer.spec.ts`，第一轮的 `perf-new-shell.spec.ts` 保留原样。默认 3 轮，同轮交替 before 和 after，失败不重试。所有账户和应用数据都在独立临时目录，工具路径指向原生测试替身，不启动模型。第四轮还修复首屏行构造与流式历史重绘。

## 准备与运行

先保存 before 的完整构建目录，再构建 after。只保存 `dist/main/index.js` 不够，依赖模块和 renderer 也必须冻结。`MAESTRO_PERF_BEFORE_ENTRY` 指向冻结目录的入口，输出使用仓库外的新目录，避免 Playwright 清空上次结果。

```sh
npm run build:main
npm run build:renderer
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=3 MAESTRO_PERF_BEFORE_ENTRY=/absolute/before/dist/main/index.js npx playwright test e2e/perf-renderer.spec.ts --project=electron --workers=1 --retries=0 --output=/absolute/results/perf-renderer-full
```

没有 `MAESTRO_PERF_BEFORE_ENTRY` 时只测当前构建。`MAESTRO_PERF_ENTRY` 可指定 after 或 baseline 的完整构建入口，默认 `dist/main/index.js`。输出记录 main 与 renderer 每个文件的 SHA-256。不要把原始 JSON、trace 或私人路径提交到仓库。

## 阶段筛选

`MAESTRO_PERF_STAGES` 接受逗号分隔的 `startup,history,native,switch,backfill,ids,scroll,stream`。未设置时全跑；空值、拼写错误直接报错。自动补足必要前置阶段，并在 JSON 的 `requestedStages` 和 `effectiveStages` 中分别记录。选中 `startup` 才跑空数据启动；其他选择只跑大数据样本所需的启动。

| 选择            | 实际执行的测量阶段                                       |
| --------------- | -------------------------------------------------------- |
| `startup`       | 空数据和大数据启动                                       |
| `native`        | 大数据启动、历史行就绪、原生历史首屏                     |
| `backfill`      | 大数据启动、切换、剩余回填                               |
| `ids`           | 大数据启动、切换、剩余回填、完整行 ID 校验               |
| `stream`        | 大数据启动、切换、剩余回填、完整行 ID 校验、纯流式       |
| `scroll,stream` | 大数据启动、切换、剩余回填、完整行 ID 校验、滚动、纯流式 |

```sh
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=1 MAESTRO_PERF_STAGES=ids MAESTRO_PERF_BEFORE_ENTRY=/absolute/before/dist/main/index.js npx playwright test e2e/perf-renderer.spec.ts --project=electron --workers=1 --retries=0 --output=/absolute/results/perf-renderer-ids
```

1 至 20 轮均可运行。1 或 2 轮标记 `diagnostic: true`，不能作为至少 3 轮的比较结论。筛选阶段会改变之前的操作和缓存状态，只比较具有相同选择的运行。

## 超时和中途结果

每个阶段开始和结束都向 stdout 输出 `[perf] START`、`[perf] END`。阶段开始即写入 `running`；结束写入 `passed`、`failed`、`timedOut` 或 `blocked`，附时间、实际预算和出错时的等待名称。

| 阶段                   | 独立期限                                             |
| ---------------------- | ---------------------------------------------------- |
| 合成语料和构建身份准备 | 60 秒                                                |
| startup                | 90 秒，包含 launch、闪屏退出、两帧、输入就绪和时间线 |
| history                | 30 秒                                                |
| native                 | 60 秒                                                |
| switch                 | 45 秒                                                |
| backfill               | 120 秒                                               |
| ids                    | 15 秒                                                |
| scroll                 | 15 秒                                                |
| stream                 | 20 秒                                                |
| 启动 trace 文件等待    | 20 秒                                                |
| 每份样本关闭 Electron  | 5 秒                                                 |
| 最终临时目录清理       | 15 秒                                                |

空数据样本另有 90 秒总预算，大数据样本有 180 秒总预算。阶段实际预算取独立期限与样本剩余时间的较小值，写入 `budgetMs`。before 的回填超过 17 秒本身不算失败，不设性能快慢通过线。

外层期限覆盖 `page.evaluate`、双 `requestAnimationFrame`、CDP、按键探针收尾、trace 停止和 `app.close()`。断言失败会保留失败并继续可独立执行的阶段，例如 native 失败后仍可切换。传输超时则终止本次启动的 Electron 子进程，依赖该页面的阶段记录为 `blocked`，继续下一份独立样本。迟到的 launch 返回值也会被终止；迟到的阶段结果不会补写指标。关闭失败或超时也终止该子进程。不会自动重试失败阶段，`blocked` 不算通过，最终进程仍返回失败。

每次状态变化都有两份记录：

- `perf-results.json`：schema 4，通过临时文件和 rename 更新，包含已完成阶段的指标、失败和汇总。中途被杀时 `complete` 为 false；`complete: true` 只表示调度结束，不表示通过。
- `perf-results.jsonl`：按 START、END 追加独立 JSON 对象。若进程恰好在更新快照时被杀，可恢复已写出的记录；忽略被截断的最后一行。

汇总只纳入通过阶段的指标，失败没有补零。查看每个分布的 `n` 和阶段状态，不能把缺失的 before 样本当作改善。落盘在测量阶段边界完成，`durationMs` 还包含探针和 trace 收尾，不能代替各项指标的 `ms`。

默认 3 轮、两个构建、空和大数据共 12 份样本，预算为 `60 + 3 × 2 × (90 + 5 + 180 + 5) + 15 + 60 = 1815` 秒，即整体测试期限 **30 分 15 秒**。最后 60 秒给夹具文件写入、检查点和调度余量；连同 Playwright 启停，计划约 31 分钟上限。只测当前构建为 **16 分 15 秒**。这不是预期性能耗时，也不是操作系统或磁盘失去响应时的硬保证；同步文件操作仍可能阻塞 Node 定时器。

## 指标与边界

- 启动可用等闪屏移除和两帧，时间以进程创建时刻为零点。文档到模块就绪包含脚本读取、解析和执行，不能直接叫解析 CPU 时间。旧构建缺少的标记保持缺失，不补零推算。
- 打开 50 MiB 原生历史、切换 5000 条消息分别测首屏。切换后测剩余回填，再核对全部规范显示行 ID 的数量和顺序，包含折叠活动宿主。缺行、重复和换序仍失败，仅将失败输出缩成首个差异，避免输出数千行 diff。
- 每个交互测量发送无文本 Shift 按键，记录事件等待、下一动画帧、长任务、renderer 脚本时间、DOM 数量和两进程内存。不会插入或提交草稿；这些是响应代理，不是 GPU 呈现延迟。
- 流式必须通过完整 ID 校验，才注入 300 个、间隔 10 ms 的合成 `process:data` 事件。不启动提供方，不把回填记作纯流式。第一轮含重叠，不能直接相减。
- 无文本探针和原生窗口行为仍需外部 Electron 验证。沙箱单测使用假传输和合成数据，不能证明实际帧率改善。

## 单独采 trace

普通计时不启用 profiler。trace 运行标记为诊断，不能和普通计时混算。

```sh
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=1 MAESTRO_PERF_STAGES=backfill MAESTRO_PERF_TRACE=1 npx playwright test e2e/perf-renderer.spec.ts --project=electron --workers=1 --retries=0 --output=/absolute/results/perf-renderer-interaction-trace
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=1 MAESTRO_PERF_STARTUP_TRACE=1 npx playwright test e2e/perf-renderer.spec.ts --project=electron --workers=1 --retries=0 --output=/absolute/results/perf-renderer-startup-trace
node scripts/analyze-perf-trace.mjs /absolute/results/trace.json
```

交互 trace 按阶段录制并检查缓冲区未接近满载。启动 trace 通过 Chromium 参数覆盖前五秒，只执行启动场景。两种模式互斥；启动超过五秒时不能宣称完整归因。旧脚本第 117 行把单轮诊断挡在 launch 之前，现已由轮数验证和诊断标记分别处理。

## 沙箱内回归和外部验收

```sh
npx vitest run src/__tests__/scripts/perf-renderer.test.ts src/__tests__/scripts/perf-renderer-runner.test.ts --configLoader runner --no-cache
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p scripts/perf/tsconfig.json
npx playwright test e2e/perf-renderer.spec.ts --project=electron --list
```

沙箱内只发现 Playwright 用例，不启动 Electron。外部需要执行：

1. 两个冻结构建的默认 3 轮，核对每阶段 stdout、持续更新的 JSON、构建身份和失败状态。
2. `MAESTRO_PERF_STAGES=ids` 单轮，确认慢 before 回填可成功，并完整核对 ID；再单独选 `stream`，确认未运行 native 或空数据启动。
3. 单轮启动 trace 和交互 trace 分别执行，确认不再被轮数校验拒绝，且 trace 文件真实生成、可分析。
4. 单独一份诊断运行中途终止测试进程，确认已结束阶段仍在 JSON 或 JSONL。必要时清理该次诊断遗留的测试 Electron 和临时目录，不复用该次数据作为完整结果。

这些是待跑的验收场景，不是已取得的 Electron 结果。

## 第四轮长任务定位

`longTaskMs` 是阶段中所有超过 50 ms 任务的累计值，`maxLongTaskMs` 才是最长单次任务。每个 sample 的 `observations[阶段名].longTasks` 保存 `startMs` 和 `durationMs`，起点是该项观察器启动时刻。`startedAt` 是 renderer 的 performance.now，`timeOrigin` 是其时间原点，可用于对齐单独采集的 trace。数字汇总另含 `layoutMs`、`styleMs`，原始任务数组不参与中位数计算。普通 Long Tasks API 不能定位 JavaScript 函数，调用栈归因仍用独立 trace。

第四轮 before 固定使用可运行克隆 `~/Downloads/maestro-t4-perf-base/dist/main/index.js`，不要使用临时目录中的冻结构建。完整三轮对比同时覆盖打开 50 MiB、切换、完整回填、纯流式及启动；诊断 trace 另选 `stream`，不能与普通计时混算。

流式回归还覆盖工具前的正文：collapseAiResponseLogs 每批会重建合并对象，因此活动行按全部浅层字段比较，不仅比较对象身份。该场景先复现 15000 次历史行重绘；不能用只有工具没有中间正文的简化语料替代。

## U7：流式期间按键延迟调查

同轮三份流式样本的按键事件等待 p95，before 为 85.3、81.1、95.4 ms，after 为 154.1、151.2、182.8 ms。每份只有 32 或 33 个按键，p95 是第二大的等待值。after 的脚本时间与长任务数量下降，不能据此否定按键退化，也不能从这些汇总值判定是批处理挤占同一帧。

本轮仅修补基准与测试，没有修改产品调度。jsdom 使用真实 data listener、200 ms batcher、草稿 store、输入 change hook 和 TerminalOutput，在批次前、同一 React 批次、批次后穿插输入，检查会话更新次数、订阅渲染次数和全部 300 片正文。历史活动行复用仍按严格次数检查。此测试不模拟浏览器事件队列、布局或 GPU，不能产出真实按键延迟。

修复了两项可复现的基准问题：先排空最后一个按键，再等待两帧，避免末次 next-frame 回调漏计；帧间隔的 startMs 记录前一帧时间，而非区间结束时间。schema 4 保留原有百分位，并增加：

- `observations[阶段].keyEvents`：按到达顺序保存 eventStartMs、handledMs、nextFrameMs，以及该键处理时的 visibilityState、focused。
- `observations[阶段].frames`：按时间顺序保存 startMs 与 durationMs，可与 longTasks 对齐。
- `metrics[阶段].keyPaintCount`：必须等于 keyEventCount。缺失下一帧记录直接失败，不补零。

相对时间均以同一观察器的 startedAt 为起点，配合 timeOrigin 对齐独立 trace。下一帧仍是 rAF 代理，不能称为像素呈现时间。尾帧漏计影响 next-frame 指标，不能解释原始 keyDelayP95Ms 上升；原始三轮仍是待核实的退化信号。

Opus 在外部使用同一份修正后的 spec，对冻结的 before 和 after 构建跑七轮，只选择 stream。其启动、切换、完整回填和 ID 校验是必要前置，不运行 native、scroll 或空数据启动。不要将旧脚本三轮结果与新脚本七轮直接混算。

```sh
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=7 MAESTRO_PERF_STAGES=stream MAESTRO_PERF_TRACE=0 MAESTRO_PERF_STARTUP_TRACE=0 MAESTRO_PERF_BEFORE_ENTRY=/absolute/before/dist/main/index.js MAESTRO_PERF_ENTRY=/absolute/after/dist/main/index.js npx playwright test e2e/perf-renderer.spec.ts --project=electron --workers=1 --retries=0 --output=/absolute/results/perf-renderer-u7-stream-7
```

检查 before、after 各七份流式样本及全部依赖通过，schema 为 4，按键与尾帧计数相等，关注高延迟按键对应的帧间隔、长任务、前台与焦点状态。报告每轮值及七轮中位数，不只摘一个汇总值。出现失焦、后台或失败样本时保留并注明，不自动丢弃或重试。两构建七轮只选 stream 的现有总期限为 45 分 25 秒；这是失败上限，不是预期耗时。

若仍有稳定退化，另跑一轮 stream trace，输出到另一个新目录。普通计时不要开启 trace，诊断数据不计入七轮结论。

```sh
MAESTRO_E2E_PERF=1 MAESTRO_PERF_ROUNDS=1 MAESTRO_PERF_STAGES=stream MAESTRO_PERF_TRACE=1 MAESTRO_PERF_STARTUP_TRACE=0 MAESTRO_PERF_BEFORE_ENTRY=/absolute/before/dist/main/index.js MAESTRO_PERF_ENTRY=/absolute/after/dist/main/index.js npx playwright test e2e/perf-renderer.spec.ts --project=electron --workers=1 --retries=0 --output=/absolute/results/perf-renderer-u7-stream-trace
```

Electron 七轮和独立 trace 尚未执行。没有足够证据修改 200 ms 刷新周期、放弃历史行复用或声称按键延迟已恢复。

2026-11-12 七轮结果（schema 4，只选 stream，before 为 `maestro-t4-perf-base` 的构建，after 为原计划收尾整合分支的开发构建，Apple M4）：流式期间按键事件等待 p95，before 七轮为 103.9、91.2、95.1、98.1、94.8、81.9、78.0 ms，中位数 94.8 ms；after 为 125.2、86.9、75.8、80.7、91.3、84.4 ms，中位数 85.7 ms。after 第 7 轮在启动阶段因 `electronApplication.evaluate` 遇到页面重载而失败，依赖阶段记为 blocked，未重试，不计入汇总。每份按键与尾帧计数相等。此前三轮的退化信号在七轮对比中没有重现，after 不比 before 慢；没有据此修改 200 ms 刷新周期。完整回填 before 约 30.7 s，after 约 17.9 s。独立 trace 未执行，因为没有稳定退化需要定位。
