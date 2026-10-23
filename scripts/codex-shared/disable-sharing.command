#!/bin/zsh
set -eu
base="${0:A:h}"
print '请先正常退出 Codex；本脚本不关闭桌面应用。活跃任务、队列或后台终端会阻止回退。'
/usr/bin/python3 "$base/codex-shared.py" --connector-stop-idle
/usr/bin/open -a /Applications/ChatGPT.app --env CODEX_CLI_PATH=
print '已请求按原生方式打开 Codex；会话、历史与置顶均保留。'
