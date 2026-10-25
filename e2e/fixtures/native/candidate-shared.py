#!/usr/bin/python3
"""Candidate-only acceptance entry. Never installed as the desktop launcher.

Every invocation checks the exact catalog, exported protocol and signature.
It can address only the private directories owned by a native E2E test.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
source = Path(__file__).resolve().parents[3] / 'scripts/codex-shared'
spec = importlib.util.spec_from_file_location('shared', source / 'codex-shared.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
root = shared.ROOT.resolve()
test_root = root.parent
if (os.environ.get('MAESTRO_E2E_REAL') != '1'
        or not test_root.name.startswith('maestro-native-e2e-')
        or root.name != 'shared-runtime'
        or test_root.stat().st_uid != os.getuid()
        or test_root.stat().st_mode & 0o077
        or Path(os.environ.get('CODEX_HOME', '')).resolve() != test_root / 'codex'
        or Path(os.environ.get('MAESTRO_USER_DATA', '')).resolve() != test_root / 'maestro'):
    raise RuntimeError('Candidate acceptance requires a private native E2E runtime')

version = subprocess.check_output([shared.NATIVE, '--version'], text=True).strip()
entry = next((entry for entry in shared.version_catalog() if entry['version'] == version), None)
if not entry or entry['state'] not in ('candidate', 'admitted'):
    raise RuntimeError('No reviewed protocol for this exact native version: ' + version)
differences = json.loads(subprocess.check_output(
    [shared.NODE, str(source / 'protocol-check.cjs'), shared.NATIVE], text=True))['differences']
if differences:
    raise RuntimeError('Candidate protocol differs: ' + json.dumps(differences))
subprocess.run(['/usr/bin/codesign', '--verify', '--strict', shared.NATIVE], check=True)

args = sys.argv[1:]
env = dict(os.environ, CODEX_CLI_PATH=shared.NATIVE)
if args == ['--connector-check']:
    print(json.dumps({'version': version, 'state': entry['state'],
                     'nativeSignatureVerified': True, 'activationPerformed': False}))
elif args == ['--connector-verify-runtime']:
    os.execve(shared.NODE, [shared.NODE, str(source / 'exec-adapter-v2.cjs'), '--verify-runtime'], env)
elif args == ['--connector-stop-idle']:
    os.execve(shared.NODE, [shared.NODE, str(source / 'connector-admin.cjs'), 'stop-idle'], env)
elif args and args[0] == 'exec':
    os.execve(shared.NODE, [shared.NODE, str(source / 'exec-adapter-v2.cjs')] + args, env)
elif args and args[0] == 'app-server':
    shared.start_shared(args, env, source / 'sidecar-v2.cjs')
else:
    raise RuntimeError('Unsupported candidate acceptance command')
