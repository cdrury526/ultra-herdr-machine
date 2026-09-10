#!/usr/bin/env python3
"""Stop only a test child at credential publication, SIGKILL it, and verify real recovery."""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

root = Path(__file__).resolve().parent.parent
binary = root / 'dist/herdr-cli'
profile = Path(sys.argv[1]).resolve()
fixture = Path(tempfile.mkdtemp(prefix='ultra-credential-interruption-'))
shim = fixture / 'stop-at-publish.so'
subprocess.run(['cc', '-shared', '-fPIC', '-o', str(shim),
                str(root / 'scripts/fixtures/stop-at-publish.c'), '-ldl'], check=True)
machines = []
checks = 0
completed = False

def no_secrets(text):
    if re.search(r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|uhp1\.[A-Za-z0-9]+\.[A-Za-z0-9_-]{43}', text):
        raise RuntimeError('Credential in command output; output suppressed')

def run(args):
    result = subprocess.run([str(binary), *map(str, args)], capture_output=True, text=True,
                            env={'PATH': '/nonexistent'}, timeout=45)
    no_secrets(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError('Compiled operation failed; output suppressed')
    return json.loads(result.stdout)

def check(value, label):
    global checks
    if not value:
        raise RuntimeError(label)
    checks += 1
    print('PASS ' + label, flush=True)

try:
    for stage in ['before', 'after']:
        case = fixture / stage
        case.mkdir(mode=0o700)
        config, key = case / 'machine.json', case / 'key.json'
        run(['operator', 'setup-key', '--profile', profile, '--output', key])
        args = ['credentials', 'register', '--config', config, '--deployment', 'http://127.0.0.1:33210',
                '--key-file', key, '--name', 'interrupted-' + stage]
        child = subprocess.Popen([str(binary), *map(str, args)], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={'PATH': '/nonexistent', 'LD_PRELOAD': str(shim), 'ULTRA_TEST_PUBLISH_PATH': str(config),
                 'ULTRA_TEST_PUBLISH_STAGE': stage})
        stopped = False
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                pid, status = os.waitpid(child.pid, os.WUNTRACED | os.WNOHANG)
                if pid:
                    if os.WIFSTOPPED(status):
                        stopped = os.WSTOPSIG(status) == signal.SIGSTOP
                        break
                    child.returncode = os.waitstatus_to_exitcode(status)
                    break
                time.sleep(0.02)
            check(stopped, f'compiled child reaches {stage}-publication stop point')
            lock_fd = next(fd for fd in Path(f'/proc/{child.pid}/fd').iterdir()
                           if os.readlink(fd) == str(config) + '.lock')
            flags = next(line.split(':', 1)[1].strip() for line in
                         Path(f'/proc/{child.pid}/fdinfo/{lock_fd.name}').read_text().splitlines()
                         if line.startswith('flags:'))
            check(int(flags, 8) & 0o2000000, f'{stage}: actual product lock is close-on-exec')
            check(config.exists() == (stage == 'after'), f'{stage}: credential publication is atomic')
            candidates = [config] if config.exists() else list(case.glob('.herdr-credential-*.tmp'))
            staged = [json.loads(path.read_text()) for path in candidates]
            credential = next(value for value in staged if 'machineId' in value)
            machines.append(credential['machineId'])
            check(bool(credential.get('pendingSaveAcknowledgement')), f'{stage}: staged credential records pending acknowledgement')
            os.kill(child.pid, signal.SIGKILL)
            stdout, stderr = child.communicate(timeout=5)
            no_secrets(stdout.decode() + stderr.decode())
            check(child.returncode == -signal.SIGKILL, f'{stage}: process actually dies by SIGKILL')
        finally:
            if child.returncode is None:
                child.kill()
                child.communicate(timeout=5)
        restored = run(args if stage == 'before' else ['credentials', 'status', '--config', config])
        saved = json.loads(config.read_text())
        check(restored['machineId'] == credential['machineId'], f'{stage}: retry retains backend identity and acquires released lock')
        check('pendingSaveAcknowledgement' not in saved and config.stat().st_mode & 0o777 == 0o600,
              f'{stage}: retry completes protected save acknowledgement')
        run(['operator', 'revoke-machine', '--profile', profile, '--machine', credential['machineId']])
    completed = True
    print(f'Credential interruption smoke passed ({checks} checks), without Node.')
finally:
    for machine in machines:
        run(['operator', 'revoke-machine', '--profile', profile, '--machine', machine])
    if completed:
        shutil.rmtree(fixture)
    else:
        print(f'Protected interrupted fixture directory: {fixture}')
