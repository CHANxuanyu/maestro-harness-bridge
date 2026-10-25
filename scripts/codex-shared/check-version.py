#!/usr/bin/python3
"""Read-only source preflight, without building or installing a connector."""
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
source = Path(__file__).with_name('codex-shared.py')
spec = importlib.util.spec_from_file_location('shared', source)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
version = shared.native_check()
print(json.dumps({'version': version, 'nativeSignatureVerified': True, 'activationPerformed': False}))
