# hb.7 capability check, 2026-11-05

Scope: installed CLI help and feature flags only. No prompt, model request, login, network probe, Electron launch or real account directory was used. Every command received a separate fresh `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` under the clone's gitignored `.maestro/scratch/` tree. Raw help captures remain ignored. This does not expand real-mode admission or validate a release artifact.

| Command               | Exit | Result                                                                                                                                   |
| --------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `claude --version`    | 0    | Claude Code `2.1.317`                                                                                                                    |
| `claude --help`       | 0    | Advertises `--permission-mode` with `plan`, `--effort` with low/medium/high/xhigh/max, and stream-json input                             |
| `codex --version`     | 0    | Codex CLI `0.166.0-alpha.6`                                                                                                              |
| `codex --help`        | 0    | Advertises sandbox policies, image input and TOML configuration overrides; no separate plan CLI option                                   |
| `codex exec --help`   | 0    | Advertises `--sandbox` with read-only/workspace-write/danger-full-access and `--image`                                                   |
| `codex features list` | 0    | Lists feature states, including `shell_tool`, `reasoning_effort_override` and `network_proxy`; this is flag inspection, not a model call |

The account environment for each row was established by Python `subprocess.run(args, env=env, capture_output=True, text=True, timeout=20)`, after creating three new directories and assigning their absolute paths to the three named variables. The initial shell only resolved the installed executable paths with `command -v`; it did not invoke either CLI without isolation.

| Spec item marked pending  | Evidence and conclusion                                                                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex plan mode           | The read-only sandbox flag exists. Keep `supportsReadOnlyMode: true`; this is a filesystem permission control. CLI help does not prove a separate planning workflow or model behavior.                                                                            |
| DeepSeek plan mode        | DeepSeek is the Claude Code preset. The harness exposes `--permission-mode plan`. Keep the existing harness read-only capability; model/API behavior remains untested.                                                                                            |
| DeepSeek reasoning effort | The harness exposes `--effort`. Help cannot show whether the DeepSeek gateway accepts or honors the setting. Paid model validation is required.                                                                                                                   |
| DeepSeek images           | Stream-json input on the harness does not prove that the DeepSeek endpoint accepts and understands images. Paid model validation is required.                                                                                                                     |
| Codex as dispatcher       | Help exposes shell execution and sandbox policies. It does not prove that a model can execute `maestro-cli`, reach the local authenticated WebSocket bridge from that sandbox, or return and resume child work correctly. Paid end-to-end validation is required. |

No capability boolean changed. The two read-only fields now carry the inspected CLI versions beside them in `src/main/agents/capabilities.ts`. DeepSeek remains a Claude Code preset; no new provider identity, capability field or unverified model support was invented. The existing capability tests passed 25/25 before this documentation-only audit; there is no new behavior for a failing test to demonstrate.

Opus should ask the user before real calls for DeepSeek image input, DeepSeek reasoning effort and Codex dispatch through Maestro. If a dedicated Codex planning workflow or DeepSeek plan behavior must be certified beyond the documented permission flags, include that in the same authorized acceptance run. No paid call was made here.

## 2026-11-11 后续真实范围

保留上文帮助核对和早期未实测结论。PR #77 的开发构建 `eab909e35` 已真实通过 Codex app-server 与 Codex 主控派 Codex 子任务，版本和工作负载见 [真实记录](real-codex.md)。派 Claude 子任务因访问令牌过期未完成。DeepSeek 图片、强度与真实网关、三家真实接力、任务清单 exec 的完整应用链路仍未验证，不由这两条结果推断。
