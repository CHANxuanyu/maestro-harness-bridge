#!/bin/zsh
set -eu
base="${0:A:h}"
/usr/bin/python3 "$base/codex-shared.py" --connector-check
print 'Codex / Maestro 同 ID 共享接续 v2'
print '保留原生签名校验；首次接入需要正常退出一次 Codex。之后两边保持打开，轮流发送。'
if /usr/bin/python3 "$base/codex-shared.py" --connector-verify-runtime >/dev/null 2>&1
then
 print 'v2 共享服务已在运行，无需退出或再次启动。可返回两款应用轮流继续已有会话。';exit 0
fi
print '请确认其他 Codex 任务已结束。如果 Codex 正在运行，正常退出后回到这里按 Enter；已退出则直接按 Enter。'
print '此脚本不关闭任何应用。'
read -r reply
if /bin/ps -axo command= | /usr/bin/grep -q '^/Applications/ChatGPT.app/Contents/MacOS/ChatGPT'; then
 print 'Codex 仍在运行，尚未切换。请正常退出后重新运行。';exit 1
fi
/usr/bin/open -a /Applications/ChatGPT.app --env "CODEX_CLI_PATH=$base/codex-shared.py"
print '已请求启动。请在 Maestro 的 Codex 智能体配置中选择本目录的 codex-shared.py。'
print '在两端打开同一已有会话，上一轮结束后再换端发送。今后冷启动使用此入口。'
