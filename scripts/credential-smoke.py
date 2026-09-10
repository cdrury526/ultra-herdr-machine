#!/usr/bin/env python3
"""Small live compiled-CLI credential smoke; creates and revokes one fixture machine."""
import concurrent.futures
import json
import os
from pathlib import Path
import re
import subprocess
import shutil
import sys
import tempfile

binary = Path(__file__).resolve().parent.parent / 'dist/herdr-cli'
source = Path(sys.argv[1]).resolve()
fixture = Path(tempfile.mkdtemp(prefix='ultra-compiled-auth-'))
profile, key, config = (fixture / name for name in ('operator.json', 'setup.json', 'machine.json'))
machine_id = None
checks = 0
completed = False

def run(arguments, success=True):
    result = subprocess.run([str(binary), *map(str, arguments)], env={'PATH': '/nonexistent'},
                            capture_output=True, text=True, timeout=45)
    combined = result.stdout + result.stderr
    if re.search(r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|uhp1\.[A-Za-z0-9]+\.[A-Za-z0-9_-]{43}', combined):
        raise RuntimeError('Credential appeared in CLI output; output suppressed')
    if (result.returncode == 0) != success:
        raise RuntimeError('Unexpected CLI exit status; output suppressed')
    return json.loads(result.stdout) if success else None

def check(condition, label):
    global checks
    if not condition:
        raise RuntimeError(label)
    checks += 1
    print('PASS ' + label)

try:
    imported = run(['operator', 'import', '--from', source, '--output', profile])
    check(len(imported['capabilities']) == 6, 'explicit operator import verifies capabilities')
    run(['operator', 'whoami'], False)
    check(True, 'operator commands require an explicit profile')
    run(['credentials', 'status', '--config', profile], False)
    check(True, 'operator profile rejected as machine config')
    issued = run(['operator', 'setup-key', '--profile', profile, '--output', key])
    check(bool(issued['permitId']), 'compiled CLI saves setup key without printing it')
    args = ['credentials', 'register', '--config', config, '--deployment', 'http://127.0.0.1:33210',
            '--key-file', key, '--name', 'compiled-auth-smoke']
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: run(args), range(2)))
    machine_id = results[0]['machineId']
    check(results[1]['machineId'] == machine_id, 'concurrent compiled registration retains one machine')
    saved = json.loads(config.read_text())
    check('pendingSaveAcknowledgement' not in saved, 'saved credential acknowledged internally')
    check(all((path.stat().st_mode & 0o777) == 0o600 for path in (profile, key, config)), 'all credential artifacts use mode 0600')
    check(results[0]['installation'] == 'not_installed', 'registration does not claim system installation')
    status = run(['credentials', 'status', '--config', config])
    check(status['machineId'] == machine_id, 'compiled machine status uses live authentication')
    recovery = fixture / 'recovery.json'
    recovered_key = run(['operator', 'setup-key', '--profile', profile, '--output', recovery, '--recover', machine_id])
    recovered = run(['credentials', 'register', '--config', config, '--deployment', 'http://127.0.0.1:33210',
                     '--key-file', recovery, '--recovery'])
    check(recovered['machineId'] == machine_id and json.loads(config.read_text())['recoveryEpoch'] == saved['recoveryEpoch'] + 1,
          'compiled recovery preserves identity and saves the new routing epoch')
    run(['operator', 'revoke-key', '--profile', profile, '--permit', recovered_key['permitId']])
    check(run(['credentials', 'status', '--config', config])['machineId'] == machine_id, 'redeemed-key revocation preserves machine access')
    os.chmod(config, 0o644)
    run(['credentials', 'status', '--config', config], False)
    os.chmod(config, 0o600)
    check(True, 'unsafe credential permissions rejected')
    run(['operator', 'revoke-machine', '--profile', profile, '--machine', machine_id])
    run(['credentials', 'status', '--config', config], False)
    check(True, 'compiled machine status rejects revoked credentials')
    completed = True
    print(f'Compiled credential smoke passed ({checks} checks), with PATH=/nonexistent.')
finally:
    if machine_id:
        run(['operator', 'revoke-machine', '--profile', profile, '--machine', machine_id])
    if completed:
        shutil.rmtree(fixture)
    else:
        print(f'Protected interrupted fixture directory: {fixture}')
