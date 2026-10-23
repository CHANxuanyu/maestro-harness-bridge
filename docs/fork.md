# Maestro Harness Bridge 分支

这是 [RunMaestro/Maestro](https://github.com/RunMaestro/Maestro) 的独立开发分支，面向中文日常使用、项目会话组织和各家原生 harness 的历史接续。它保留上游 Git 历史与 AGPL-3.0 许可证。应用名暂保留 **Maestro I18n**，便于现有试用安装继续读取自己的配置。

- [产品 changelog](../CHANGELOG.md)
- [本版验证与限制](verification/v1.0.1-hb.3.md)
- [开发过程记录](worklog.md)
- [信息流改造记录](roadmap/conversation-feed.md)
- [Codex 双端接续启动与回退](codex-shared.md)
- [本分支 Releases](https://github.com/CHANxuanyu/maestro-harness-bridge/releases)

## 当前能做什么

已有原生历史进入项目会话列表后，点开即可阅读并继续同一条会话，不必先挑选智能体配置。Maestro 负责组织界面与调度，Claude Code / Codex 仍各自运行其原生 harness，使用各自既有的认证与额度。

第一次使用前，在系统中安装并登录要使用的原生 CLI。Maestro 不提供统一订阅登录、额度共享或免费模型服务。若 CLI 不在 PATH 中，可在相应智能体配置中选择可执行路径。可发现的历史由原生 CLI 的账户目录、项目路径和主机决定。

本版信息流采用紧凑正文和按需消息信息，减少大卡片、留白及重复模型/时间。Codex 同一原生会话仍由一个原生进程写入；可选[共享连接器](codex-shared.md)让两端保持打开并轮流接续。它需要单独安装，限定原生版本和本机已有会话。未启用共享时，仍需正常释放另一客户端的占用，不删除写锁或复制历史。

## 下载与试用

`v1.0.1-hb.3` 为预览版，macOS Apple Silicon 是本轮验证目标。下载 Release 的 mac-arm64 ZIP，校验随附 SHA-256 清单，再解压应用。应用采用临时签名，未做 Apple Developer ID 公证；系统可能要求通过“系统设置 → 隐私与安全性”确认打开。

应用名 `Maestro I18n`、bundle ID `com.maestro.i18n.local` 与上游 Maestro 分开。默认配置目录为 `~/Library/Application Support/Maestro I18n`。现有同名试用版应先正常退出、备份该目录，再替换应用；不要同时启动两个同名版本。

本预览包不注册 `maestro://` 协议、不提供自动安装更新元数据，也不带上游崩溃上报凭据。手动从本分支 Releases 更新。上游帮助、赞助与部分反馈入口仍保留；本分支问题请报到[本仓库 Issues](https://github.com/CHANxuanyu/maestro-harness-bridge/issues)。

## 从源码构建

```sh
git clone https://github.com/CHANxuanyu/maestro-harness-bridge.git
cd maestro-harness-bridge
git checkout v1.0.1-hb.3
npm ci
npm run lint
npm run test
npm run package:harness-bridge:mac
```

打包脚本仅支持 Apple Silicon macOS，使用仓库锁定的依赖与原生模块，输出到 `release/harness-bridge/`。它会先完整构建，写入当前 Git commit，再生成应用 ZIP；不会安装应用、修改用户资料、上传资产或创建 GitHub Release。其他平台可继续研究上游构建流程，但不属于本轮预览包验证范围。

开发协作继续采用前端原生 Claude Code Opus、后端与集成 GPT 的分工。每次发布应记录产品变化、源码基线、检查结果和产物 SHA-256；未完成的体验工作进入明确的下一阶段，不把工程检查通过当作产品验收通过。
