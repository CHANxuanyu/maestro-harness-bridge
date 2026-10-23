# Harness Bridge 版本与发布管理

本制度只适用于 [CHANxuanyu/maestro-harness-bridge](https://github.com/CHANxuanyu/maestro-harness-bridge)。上游 `scripts/release.mjs`、main/rc 晋级、自动 bump 和公告流程不适用于本分支。HB 发版不会给上游发邮件、Discord 公告或 npm 包。

## 分支和合并

| 对象                              | 作用                         | 规则                                                 |
| --------------------------------- | ---------------------------- | ---------------------------------------------------- |
| `codex/i18n-zh-cn`                | 本 fork 的集成主线和默认分支 | 保留现名以兼容既有路径；通过 PR 合并，禁止强推和删除 |
| `codex/<工作内容>` 或已有功能分支 | 开发与审查                   | 从集成主线建立；在 PR 中记录范围、风险与验证         |
| `vX.Y.Z-hb.N`                     | 已冻结的候选/发行源码        | 注解标签；创建后不移动、不删除、不复用编号           |
| 上游 `main`、`rc` 及导入分支      | 上游历史参照                 | 不作为 HB 发版主线，不批量清理、不把 HB 代码推回上游 |

`origin` 在某些已有本机 checkout 指向上游，而 `fork` 指向本项目。GitHub CLI 命令显式带 `--repo CHANxuanyu/maestro-harness-bridge`；推送前核对 `git remote -v`，不能凭 remote 名猜目的地。

主线要求 PR、解决所有审查对话及六项 GitHub Actions 检查：`HB release policy`、`lint-and-format`、Linux 两个分片、Windows 两个分片。要求基于最新主线测试，不允许用本机单平台通过代替。PR 与合并后的提交是不同身份，发版使用**合并后实际源码提交**的完整 CI。

目前为单人维护，外部批准人数设为 0，避免作者无法批准自己的 PR。仍须在 PR 中留下实际审查、测试和未验项；规则无日常绕过名单。以后有第二位长期维护者，再通过治理 PR 增加外部审批。合并方式保留现状，不改写已发布历史。未合并或来源不明的分支不自动删除。

前端语义实现继续由原生 Claude Code Opus 承担；GPT 负责后端、审查、集成和发布。本制度、脚本与 CI 调整不要求重做产品前端。

## 版本编号

- 对外预览沿用 `X.Y.Z-hb.N`，Git 标签为 `vX.Y.Z-hb.N`，GitHub Release 必须为 **prerelease**，不标记稳定版 Latest。
- `N` 在同一基线上单调递增。每个公开安装包必须有新编号，即使只是构建修复；失败但已经占用的编号不复用。`hb.1` 保留为未发布失败候选，不能补发。
- 开发预览使用 `X.Y.Z-hb.N-dev.M`，明确标注开发包；不能冒用正式 HB 标签。基础 `X.Y.Z` 是既定产品基线，不因同步一笔上游提交就自动更改。
- 只有准备新安装包时才 bump。治理、文档等修改可先进入 Unreleased，不为本制度单独生成 hb.5 安装包。主线源码不等于最近发布包，复现发布必须检出对应标签。
- 发布候选的 `package.json`、`package-lock.json` 两处版本、产品 changelog、README 与分支入口、版本验收文档必须一致。`node scripts/hb-release.mjs check` 自动检查这些关系。

## 发版顺序

1. **准备候选 PR。** 汇总用户能感知的变化；按[模板](release-notes-template.md)写产品说明、更新/启动/回退方法和已知限制。明确平台、原生 CLI 版本、账户/主机边界及连接器是否变化。
2. **审查并合并。** 使用 [PR 模板](../.github/PULL_REQUEST_TEMPLATE.md)记录实际结果。合并后等待主线对应提交 CI 全绿；不要拿 PR 合成 merge SHA、旧 commit 或跳过任务的结果代替。
3. **冻结源码并构建。** 记录完整 40 位 commit，保证工作区干净。运行 `npm ci`、必要本机验证、`npm run package:harness-bridge:mac` 和 `npm run package:codex-shared`。打包不会安装、发布或激活连接器。包内版本、构建文件、签名、ZIP、原生 SQLite/PTY 和隐私扫描都要有实测记录。
4. **形成五个公开附件。** 应用 ZIP、连接器 ZIP、`BUILD-MANIFEST.json`、`VERIFICATION.json`、`SHA256SUMS.txt` 放在独立目录，不能混入原始日志或截图。清单以实际字节计算，不填预期值。运行 `node scripts/hb-release.mjs assets --dir <资产目录>`；检查不通过即停止。
5. **建立注解标签并上传草稿。** 标签指向构建来源 commit。先确认远端编号未被别的候选使用；仅在恢复同一候选时允许复用同 ID、同 commit 的草稿。HB 标签本身不自动发布安装包。
6. **发布前核对。** 上传五项完成后执行 `npm run release:hb:verify -- --tag <标签> --dir <资产目录> --notes <版本说明文件> --state draft`。它核对源码、包版本、远端真实 CI、资产大小/哈希和说明；任何差异都不能发布。
7. **公开并复核。** 使用 `gh release edit <标签> --repo CHANxuanyu/maestro-harness-bridge --draft=false --prerelease --latest=false --verify-tag`。随后执行 `npm run release:hb:verify -- --tag <标签> --state published`，并检查匿名下载。`Verify HB release` 工作流也会在发布后核验来源、CI 和附件身份；它是发布后的检查，不能替代步骤 6。
8. **完成留痕。** PR、源码标签、CI URL、包身份、版本验收文档与 Release 相互可追溯。本机完整证据另存，不上传私人对话、账号目录、真实会话 ID、未脱敏截图或原始日志。

命令中的 `<...>` 是待替换参数。`scripts/hb-release.mjs` 只有读取和检查功能，不会替维护者创建草稿、发送公告、移动标签、上传文件或修复远端状态。它返回非零时需要修正原因，不能当作“自动处理成功”。

## 证据的最低内容

`BUILD-MANIFEST.json` 记录 `version`、`sourceCommit`、仓库、平台、应用/连接器文件名、大小、SHA-256、包验证和原生模块结果。`VERIFICATION.json` 记录同一版本/commit、本机测试、真实主线 CI 的 run ID/commit、隐私检查、GUI 范围和已知限制。格式可参考 [hb.4 公开附件](https://github.com/CHANxuanyu/maestro-harness-bridge/releases/tag/v1.0.1-hb.4)；新增版本使用通用 `gui.fullOriginalCrossAppWriteSequenceRepeated` 布尔字段，旧 hb.4 字段仅兼容历史记录。

`SHA256SUMS.txt` 覆盖两个 ZIP 和两个 JSON，不包含它自己。远端检查下载三个小型证据文件并核对字节；两个 ZIP 使用 GitHub 的资产 SHA-256 与大小校验，指定本地资产目录时也核对本地 ZIP。该工具不替代真实运行应用、验签、公证或完整源代码/二进制隐私审查。自动证据校验采用 hb.4 及后续结构；更早版本缺少字段时按其原始验收记录人工核对，不能补造通过结果。

自动测试、开发预览 GUI、发行包 GUI 必须分开记录。影响原生接续、账户、写入或停止机制时，须验证同一原始会话的多轮、工具、停止恢复和重启继续。纯展示变化可以引用用户认可的预览及未变化的后端证据，但要明确哪些旧验收被复用、理由和本版未重跑项。未完成的测试如实写出，不能将旧包的完整验收改成新包“全部通过”。

## 冻结、失败和回退

- 启用 GitHub release immutability 后，新公开版本的附件与标签不能替换。需要修复时增加版本号。可修正文案，但需在工作记录中说明更正，不改变包身份。
- 规则启用前的 hb.2/hb.3/hb.4 不会自动变成 immutable。保留原发布记录，不通过删除重发伪装成受保护的新发布；HB 标签另由规则集防止移动和删除。
- 草稿/上传失败先查现有 Release ID、资产和运行结果，再恢复同一候选。不要反复创建同名草稿，或用覆盖上传掩盖包差异。
- 代码错误通过新 PR 修复；CI 服务故障可以有记录地重跑失败项，不通过删除检查或管理员强行合并规避失败。
- 已发布问题用下一版修复，并在 Release 说明影响与回退办法。回退先正常退出 Maestro，备份当前配置，再恢复已验证旧安装包；如涉及配置迁移，必须说明旧版兼容性和备份恢复，不能删除原生历史或写锁。
- 若规则配置错误导致无法工作，管理员可依照已保存配置修正规则，但必须记录原因、影响范围和恢复结果。日常流程不关闭保护或修改旧标签。

## GitHub 设置作为代码留档

- 默认分支规则：[hb-integration.json](../.github/rulesets/hb-integration.json)。
- HB 标签规则：[hb-tags.json](../.github/rulesets/hb-tags.json)。
- 检查与历史例外：[hb-release-policy.json](../.github/hb-release-policy.json)。
- 远端实时规则：[Rules](https://github.com/CHANxuanyu/maestro-harness-bridge/rules)。修改规则要同步 PR、JSON 和远端回读结果，不能只改文档。
- 上游发布流程保留其仓库条件；上游 main/rc 守卫、SDK 发布、stale 自动关闭只在上游执行，避免本 fork 误跑。

依据 GitHub 的[规则集说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)和[不可变发布说明](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)。本制度的变更与普通代码同样经 PR 和 CI；它不改变当前安装、原生 harness 或现有会话。
