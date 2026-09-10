# ultra-herdr-machine

Public machine CLI for ultra-herdr. It supports explicit operator profiles,
machine setup/recovery keys, credential registration, authenticated credential status
and a renewal path. Complete enrollment/system installation, verified caller identity,
task operations and the visible runtime are not yet available.

Requires Bun 1.4.2 to build. Installed compiled binaries do not require Node.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
./dist/herdr-cli --help
./dist/herdr-cli --version
bun run smoke:ink
```

The versioned public API tarball in `vendor/` permits isolated builds before registry
publication. It contains only public protocol JavaScript, declarations and package
metadata; no private backend source. Future functions are added as implemented.

Keep credentials outside the checkout in protected product configuration. Do not
commit machine configuration, tokens, environment files or signing keys.

Credential commands use explicit protected file paths:

```sh
herdr-cli operator import --from /secure/operator-import.json --output /secure/operator.json
herdr-cli operator whoami --profile /secure/operator.json
herdr-cli operator setup-key --profile /secure/operator.json --output /secure/setup-key.json
herdr-cli credentials register --config /secure/machine.json \
  --deployment http://127.0.0.1:33210 --key-file /secure/setup-key.json --name studio
herdr-cli credentials status --config /secure/machine.json
```

Use paths owned by your account; directories must deny group/other writes and
credential files must be mode 0600. Machine credential operations currently require
Linux. Use the actual deployment URL supplied by the administrator; HTTPS is required
except for local loopback HTTP. Key/token values are never command-line arguments
or printed outputs. The deployment administrator creates the operator import artifact.

Registration only saves credentials. It retains an owner-only request beside the
config for interrupted retries, then confirms the save internally. Retry with the
same inputs after a lost response. If save confirmation is pending, `credentials
status` retries it. File locks and atomic writes protect concurrent registration and
renewal. Operator profiles are never selected automatically for machine commands.

For credential recovery, create a key with `operator setup-key --recover MACHINE_ID`,
then run `credentials register --recovery` with the same config/deployment and that
protected key file, omitting name/session. Recovery preserves machine identity;
operator and machine revocation commands are listed in `--help`.

The compiled credential smoke is `python3 scripts/credential-smoke.py OPERATOR_PROFILE`.
It uses the local development API port, creates/revokes a fixture machine, checks
concurrent registration and recovery without Node, and deletes successful local fixtures.
It does not establish expired-token/rotation acceptance or caller/session binding.
