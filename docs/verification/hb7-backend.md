# hb.7 backend verification, 2026-11-05

Latest tested artifact: local review-fix source on `codex/hb7-backend`, based on Opus's corrected spec/review commit `5f5ce0ae86e071075945d19bead8a0aab74bf84a`. The original A-D implementation was based on spec commit `a74424287` over `72545fdad`. No remote, push, Electron launch, real-mode run, model request or release package. All account-like test values were synthetic. Original CLI help used three fresh account environment directories for every invocation inside the clone's ignored scratch tree. This review-fix pass used temporary Git repositories and mocked transports only, with no account directory access. Private raw captures are not committed.

## Local commits

- A: `db028ef26`, registers the default-false `newShell` setting in metadata, main defaults, renderer loading/saving and search. Existing generic CLI settings set/get commands are tested against isolated disk storage.
- B: `bca64388f`, shared changes types, read-only main service, IPC, preload, renderer service and `changes` CLI. One invocation and SSH connection for status plus counts. File diffs use a preliminary status read for rename sources, then a bounded patch read.
- C: `40bb02505`, matches execution cwd and host, creates missing targets from provider globals, adds review drafts, read-only startup, persisted origin and CLI/read parity.
- D: the audit commit containing this report records installed CLI evidence and version annotations beside existing capability flags. No capability boolean changed. See [capability evidence](hb7-capabilities.md).
- Review fixes: the local commit containing this update changes untracked-entry handling, native root spelling and the review draft instructions, with regression tests and records together.

## Opus review corrections

Re-read the corrected appendix C item 2 before changing the review draft. The chosen untracked contract is documented in the shared types and canonical guide: nested repositories/directories retain Git's trailing `/`; directories, dangling or valid symlinks and unreadable files have null counts and empty diffs (`binary: false`, `tooLarge: false`). A per-entry untracked read failure does not abort the snapshot. A combined fixture checks all four odd entries beside a normal modified file (2 additions, 1 deletion) and a normal untracked file, including exact totals.

Review drafts now ask for `git diff HEAD` for tracked changes and direct reads of untracked files in the list. Existing goal, file list, read-only instruction and token-budget assertions remain. Local roots use the platform path module, including timeout/non-repository fallbacks; SSH roots preserve the remote spelling. Windows tests inject `path.win32.normalize` into an isolated default path export, never mutate `process.platform`, and still assert slash-separated file paths and the branch. Existing root assertions now compare the required native form exactly; they were not loosened.

Test-first command, before implementation:

```sh
npx vitest run src/__tests__/main/git/changes.test.ts src/__tests__/main/git/changes-transport.test.ts src/__tests__/renderer/services/aiHandoffContext.test.ts
```

Initial result: exit 1, 14 failed / 21 passed. The nested-repository, dangling-symlink and unreadable-file snapshots failed with directory, missing-target and permission errors. Other failures covered the chosen null/empty symlink behavior, native and SSH root spelling, and missing untracked review instructions. Directory diffs were already tolerated; symlink diffs previously returned Git's link patch. After implementation, the exact same command passed: exit 0, 3 files, 35/35, no skips.

The exact 18-file Vitest command in the original A-D verification section below was rerun unchanged: exit 0, 18 files, 951/951, no skips. This replaces 938/938 as the latest result and adds 13 regression cases. These runs overlap and are not additive coverage counts.

Touched-file ESLint commands:

```sh
npx eslint src/main/git-changes.ts src/renderer/services/aiHandoffContext.ts src/shared/gitChanges.ts
npx eslint -c eslint.dashes.config.mjs src/__tests__/main/git/changes.test.ts src/__tests__/main/git/changes-transport.test.ts src/__tests__/renderer/services/aiHandoffContext.test.ts
```

Both exited 0. The second command uses the repository's dedicated config because the main config ignores tests.

| Command                    | Latest review-fix result                    |
| -------------------------- | ------------------------------------------- |
| `npm run lint`             | Exit 0, all three TypeScript configurations |
| `npm run format:check:all` | Exit 0, entire repository                   |
| `npm run docs:verify`      | Exit 0, 653 asserted paths, 0 missing       |
| `git diff --check`         | Exit 0                                      |

The added-line Unicode check also exited 0:

```sh
python3 - <<'PY'
import subprocess
patch = subprocess.check_output(['git', 'diff', '--no-ext-diff', '--unified=0'], text=True)
added = [line[1:] for line in patch.splitlines() if line.startswith('+') and not line.startswith('+++')]
assert not any(chr(code) in line for line in added for code in (0x2013, 0x2014))
print('Added-line Unicode dash check passed')
PY
```

Not verified in this correction pass: native Windows execution, a real SSH host, Electron/GUI, model calls, built CLI execution and packaging. POSIX symlink/permission tests are conditional on a non-Windows host and all ran on this Mac; the Windows-style path tests run on every host. No real account folders were read or written. Original A-D limitations below still apply.

## Test-first evidence

A's corrected CLI tests failed twice against the unregistered setting, and the new renderer store case failed before implementation. B's new local and CLI suites failed on missing modules before implementation; subsequent real-repository tests also caught rename filtering, large files forced to text by attributes and staged deletion handling. C's initial core run had 5 failures / 31 passes on the required routing, mode and review draft behavior; the separate renderer/read run had 3 failures / 128 passes on origin and SSH review. A final host-key regression also failed 1/17 before namespacing SSH IDs separately from the local host key. These failures were fixed, and the final combined run below passed. D is a help-only audit with no changed behavior; its existing capability suite passed 25/25 before the comment/documentation change. No artificial failing test was added for a documentation-only audit.

## Original A-D verification commands

The final Vitest command includes every test file touched or added, plus the existing capability suite:

```sh
npx vitest run src/__tests__/cli/commands/settings-new-shell.test.ts src/__tests__/renderer/stores/settingsStore.test.ts src/__tests__/main/git/changes.test.ts src/__tests__/main/git/changes-transport.test.ts src/__tests__/cli/commands/changes.test.ts src/__tests__/main/preload/git.test.ts src/__tests__/renderer/services/git.test.ts src/__tests__/main/ipc/handlers/git.test.ts src/__tests__/main/ai-handoff.test.ts src/__tests__/main/ai-handoff-desktop.test.ts src/__tests__/renderer/services/aiHandoff.test.ts src/__tests__/renderer/services/aiHandoffContext.test.ts src/__tests__/cli/commands/handoff.test.ts src/__tests__/main/web-server/web-server-factory.test.ts src/__tests__/renderer/services/aiHandoffEntry.test.ts src/__tests__/cli/commands/tab.test.ts src/__tests__/renderer/hooks/utils/useDebouncedPersistence.test.ts src/__tests__/main/agents/capabilities.test.ts
```

Result: exit 0, 18 files, 938/938 tests, no skips.

Source ESLint command:

```sh
npx eslint src/cli/commands/changes.ts src/cli/commands/handoff.ts src/cli/index.ts src/cli/services/session-command.ts src/main/agents/capabilities.ts src/main/ai-handoff-desktop.ts src/main/ai-handoff.ts src/main/git-changes.ts src/main/ipc/handlers/git/read.ts src/main/preload/git.ts src/main/stores/defaults.ts src/main/stores/types.ts src/main/web-server/callbacks/sessionCallbacks.ts src/renderer/components/Settings/searchableSettings.ts src/renderer/global.d.ts src/renderer/services/aiHandoff.ts src/renderer/services/aiHandoffContext.ts src/renderer/services/aiHandoffEntry.ts src/renderer/services/git.ts src/renderer/stores/settingsStore.ts src/renderer/types/index.ts src/shared/aiHandoff.ts src/shared/desktopTabs.ts src/shared/gitChanges.ts src/shared/settingsMetadata.ts
```

Result: exit 0. The normal repository ESLint config ignores tests, so test files were separately checked with its dedicated dash config:

```sh
npx eslint -c eslint.dashes.config.mjs src/__tests__/cli/commands/changes.test.ts src/__tests__/cli/commands/handoff.test.ts src/__tests__/cli/commands/settings-new-shell.test.ts src/__tests__/cli/commands/tab.test.ts src/__tests__/main/ai-handoff-desktop.test.ts src/__tests__/main/ai-handoff.test.ts src/__tests__/main/git/changes-transport.test.ts src/__tests__/main/git/changes.test.ts src/__tests__/main/ipc/handlers/git.test.ts src/__tests__/main/preload/git.test.ts src/__tests__/main/web-server/web-server-factory.test.ts src/__tests__/renderer/hooks/utils/useDebouncedPersistence.test.ts src/__tests__/renderer/services/aiHandoff.test.ts src/__tests__/renderer/services/aiHandoffContext.test.ts src/__tests__/renderer/services/aiHandoffEntry.test.ts src/__tests__/renderer/services/git.test.ts src/__tests__/renderer/stores/settingsStore.test.ts
```

Result: exit 0.

| Command                     | Result                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run lint`              | Exit 0, all three TypeScript configurations                                                             |
| `npm run format:check:all`  | Exit 0, entire repository                                                                               |
| `npm run docs:verify`       | Exit 0, 653 asserted paths, 0 missing                                                                   |
| `npm run gen:cli-reference` | Exit 0, rebuilt the CLI bundle and regenerated the command reference; generated Markdown then formatted |
| `git diff --check`          | Exit 0                                                                                                  |

The two built-CLI settings commands ran with fresh `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `MAESTRO_USER_DATA` directories in the ignored scratch tree, plus an initially empty settings JSON file.

Earlier focused Vitest commands ran the A pair (270 tests), B's six files (328 tests), C's nine files (315 tests), and `npx vitest run src/__tests__/main/agents/capabilities.test.ts` (25 tests). These overlap the final 938 tests and are not additional coverage counts. Before final success, type checking found the missing renderer git declarations and a renderer import entering the CLI type graph; both were fixed. The first default ESLint invocation listed ignored-test warnings; the final dedicated test command above checks those files under repository policy.

A Python check on added diff lines rejects both prohibited Unicode dash code points and checks the local commit messages. `git diff --check` also checks whitespace. Formatting all generated CLI reference content accounts for the larger Markdown diff; no new CLI verb was added for settings.

## CLI parity rows

Added to the Covered table in [CLI-UI-PARITY.md](../agent-guides/CLI-UI-PARITY.md):

- Read conversation changes and a file diff: `changes [--agent <id>] [--tab <id>] [--file <path>] [--json]`.
- Ask another provider to review the current conversation changes: `handoff <tab> <provider> --review [--send] [--json]`; read origin with `tab show <tab> --json`.

The existing `session list` transport also returns origin, and its main callback has a regression test. Settings continue to use `settings set newShell true` and `settings get newShell`.

## Remaining acceptance

- Electron, actual UI shell switching, queued native spawning and restart acceptance: not run; Opus owns E2E. No installable artifact was built.
- Real SSH host: not used. Tests cover generated SSH commands, canonical option/remote path handling, parser behavior and same-host handoff routing. The changes command assumes the remote POSIX shell and standard git/xargs/wc tools.
- Windows: no Windows runtime. Platform-independent Windows-style parser inputs run without changing process.platform; the real git tests use portable file names. Git for Windows shell-alias execution still needs Windows CI/E2E.
- Remote DeepSeek creation: the existing preset factory creates local isolated account folders only. An existing DeepSeek runner in the same remote directory can be reused. Without one, preparation fails clearly; no remote account protocol or local fallback was introduced.
- A missing local DeepSeek runner can be created only when provider global settings identify the DeepSeek gateway and provide its credentials; otherwise preparation fails clearly. Credentials are never borrowed from another project's runner.
- If the required review header and file list exceed the requested token budget, preparation reports a budget error instead of dropping the mandatory review instructions. A timed-out or non-repository changes snapshot cannot create a review draft.
- Paid model validation: DeepSeek image input, DeepSeek reasoning effort, and Codex executing `maestro-cli` through the local bridge from its sandbox. Dedicated Codex planning behavior and DeepSeek model behavior under plan mode also remain unverified beyond the advertised permission flags. Opus must obtain authorization before those calls.
