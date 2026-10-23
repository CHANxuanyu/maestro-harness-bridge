#!/usr/bin/python3
"""Retain the genuine Codex process as desktop's direct child.
No signatures or authorization checks are modified. Sidecar only frames JSON-RPC.
"""
import os, sys, json, hashlib, stat, subprocess, time, uuid, shutil
from pathlib import Path
NATIVE='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
NODE=os.environ.get('MAESTRO_SHARED_NODE') or shutil.which('node') or str(Path.home()/'.local/bin/node')
VERSION='codex-cli 0.163.0-alpha.11.1'
HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('MAESTRO_SHARED_STATE',str(Path.home()/'.codex/maestro-shared-v2')))

def private_json(file):
    s=file.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077: raise RuntimeError('Unsafe connector record: '+str(file))
    return json.loads(file.read_text())
def alive(pid):
    if type(pid)!=int or pid<2: raise RuntimeError('Invalid recorded process identity')
    try: os.kill(pid,0);return True
    except ProcessLookupError:return False

def verify_package():
    manifest=json.loads((HERE/'MANIFEST.json').read_text())
    if manifest.get('state')!='READY_FOR_OPT_IN' or manifest.get('nativeVersion')!=VERSION: raise RuntimeError('Package is not approved for opt-in')
    for name, expected in manifest['files'].items():
        if Path(name).name!=name or hashlib.sha256((HERE/name).read_bytes()).hexdigest()!=expected: raise RuntimeError('Connector integrity mismatch: '+name)

def native_check():
    version=subprocess.check_output([NATIVE,'--version'],text=True).strip()
    if version!=VERSION:raise RuntimeError('Untested native version; shared startup refused: '+version)
    subprocess.run(['/usr/bin/codesign','--verify','--strict',NATIVE],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)

args=sys.argv[1:]
values={'-c','--config','--enable','--disable','--remote','--remote-auth-token-env','-m','--model','-C','--cd','-p','--profile','-s','--sandbox','-a','--ask-for-approval','--add-dir','-i','--image','--local-provider'}
skip=False; command=None
for a in args:
    if skip:skip=False;continue
    if a=='--':break
    if a in values:skip=True;continue
    if not a.startswith('-'):command=a;break
options=args[:args.index('--')] if '--' in args else args
inspection=any(a in ['--help','-h','--version','-V'] for a in options)
env=dict(os.environ,CODEX_CLI_PATH=NATIVE,MAESTRO_SHARED_STATE=str(ROOT))
main=command=='app-server' and any(a.startswith('plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=') for a in args)
if args==['--connector-check']:
    verify_package();native_check();print(json.dumps({'version':VERSION,'runtimeRoot':str(ROOT),'nativeSignatureVerified':True,'activationPerformed':False},ensure_ascii=False));sys.exit(0)
if args in (['--connector-verify-runtime'], ['--connector-stop-idle']):
    verify_package()
    script, action = ('exec-adapter-v2.bundle.cjs', '--verify-runtime') if args[0]=='--connector-verify-runtime' else ('connector-admin.bundle.cjs', 'stop-idle')
    os.execve(NODE, [NODE, str(HERE/script), action], env)
if command=='exec' and not inspection:
    verify_package()
    os.execve(NODE,[NODE,str(HERE/'exec-adapter-v2.bundle.cjs')]+args,env)
if not main or inspection:os.execve(NATIVE,[NATIVE]+args,env)

verify_package();native_check()
if any(a in ['--listen','--stdio'] or a.startswith('--listen=') for a in args):raise RuntimeError('Explicit app-server transport cannot be replaced')
ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
s=ROOT.lstat()
if not stat.S_ISDIR(s.st_mode) or stat.S_ISLNK(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077:raise RuntimeError('Unsafe runtime directory')
# This is a connector-only startup lease, never a native writer lock. Retain
# dead records as evidence; any live/unknown owner refuses a second core.
mutex=ROOT/'starting'
if mutex.exists():
    owner=private_json(mutex/'owner.json')
    if alive(owner['pid']):raise RuntimeError('Another shared startup is still running; no second core started')
    mutex.rename(ROOT/('starting-stopped-'+str(time.time_ns())))
mutex.mkdir(mode=0o700)
ownerfile=mutex/'owner.json'
with os.fdopen(os.open(ownerfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:json.dump({'pid':os.getpid(),'startedAt':time.time()},f)
sidecar=None
try:
    descriptor=ROOT/'runtime.json'
    if descriptor.exists():
        old=private_json(descriptor)
        if alive(old['pid']) or (old.get('sidecarPid') and alive(old['sidecarPid'])):raise RuntimeError('An existing shared process still owns this runtime; no second core started')
        descriptor.rename(ROOT/('runtime-stopped-'+str(time.time_ns())+'.json'))
    socket=str(ROOT/(uuid.uuid4().hex[:8]+'.sock'))
    if len(socket.encode())>100:raise RuntimeError('Runtime path exceeds macOS Unix socket limit')
    log=str(ROOT/('server-'+str(time.time_ns())+'.log'))
    args_hash=hashlib.sha256(json.dumps(args,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    sidecar=subprocess.Popen([NODE,str(HERE/'sidecar-v2.bundle.cjs'),socket,str(os.getpid()),str(os.getppid()),args_hash,log],stdin=sys.stdin,stdout=sys.stdout,stderr=sys.stderr,env=env,close_fds=True,start_new_session=True)
    logfd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);nullfd=os.open(os.devnull,os.O_RDONLY)
    os.dup2(nullfd,0);os.dup2(logfd,1);os.dup2(logfd,2);os.close(nullfd);os.close(logfd)
    os.execve(NATIVE,[NATIVE]+args+['--listen','unix://'+socket],env)
except Exception:
    if sidecar is not None:
        sidecar.terminate()
        try:sidecar.wait(timeout=3)
        except subprocess.TimeoutExpired:pass
    if mutex.exists() and private_json(ownerfile)['pid']==os.getpid():mutex.rename(ROOT/('starting-failed-'+str(time.time_ns())))
    raise
