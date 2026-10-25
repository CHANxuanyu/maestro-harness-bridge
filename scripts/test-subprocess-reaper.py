"""Reap orphaned test processes on Linux containers without a working init."""

import ctypes
import os
import subprocess
import sys


# PR_SET_CHILD_SUBREAPER makes orphaned fixtures our children. Reaping happens
# outside Vitest, so its PID assertions still require actual process removal.
if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "Could not enable child subreaper")

child = subprocess.Popen(sys.argv[1:])
status = 1
while True:
    try:
        pid, code = os.waitpid(-1, 0)
    except InterruptedError:
        continue
    except ChildProcessError:
        break
    if pid == child.pid:
        status = os.waitstatus_to_exitcode(code)
        child.returncode = status

sys.exit(status if status >= 0 else 128 - status)
