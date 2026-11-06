# 新界面 renderer 性能复测

入口为 `e2e/perf-renderer.spec.ts`，第一轮的 `perf-new-shell.spec.ts` 保留原样。默认 3 轮，同轮交替 before 和 after，失败不重试。所有账户和应用数据都在独立临时目录，工具路径指向原生测试替身，不启动模型。本轮只改基准和回归，不改产品代码。

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

- `perf-results.json`：schema 3，通过临时文件和 rename 更新，包含已完成阶段的指标、失败和汇总。中途被杀时 `complete` 为 false；`complete: true` 只表示调度结束，不表示通过。
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
