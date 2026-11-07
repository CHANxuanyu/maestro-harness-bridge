# 性能分支合并主线验收

本次冲突合并及工具全文缓存修复的 Electron 场景，交给 Opus 在沙箱外执行。只使用合成提供方和临时目录，不设置真实模式。本文是待跑清单，不代表已通过。

先构建本分支：

```sh
npm run build:main
npm run build:renderer
```

主线功能与性能行渲染一起验收：

```sh
MAESTRO_E2E_REAL=0 npx playwright test e2e/native-tool-output.spec.ts e2e/native-codex-plan.spec.ts e2e/native-stop-resume.spec.ts --project=native --workers=1 --retries=0
```

- `native-tool-output.spec.ts`：Claude、Codex 历史，Claude 子对话，切换工具后的旧卡片，Codex 实时调用。展开已结束活动、再展开工具，按需读到输出末尾；CLI 读同一结果；全文收起后移除且不落入持久缓存。
- `native-codex-plan.spec.ts`：任务完成后最终回答仍作为正文显示，下一轮不会把它折叠成进度消息，任务面板保留完成状态。
- `native-stop-resume.spec.ts`：只读停止、正常重启、继续对话及旧历史修复，保留真实重复发送，不显示内部提示。

工具卡片的项目来源、已保存来源、原生调用 ID 单独更新，由 `TerminalOutput.feed.test.tsx` 的真实组件回归覆盖。Electron 的切换工具场景覆盖原生身份跨工具保留，不等同于这三种属性更新的逐项浏览器验证。

性能验收沿用 [renderer 性能复测](../docs/perf-renderer.md)，使用 `e2e/perf-renderer.spec.ts` 和同轮前后构建。关注首屏窗口、全部历史回填顺序、已结束活动行复用、流式正文及按键尾帧。不能用 jsdom 工作量断言代替 Electron 延迟或帧率结果。
