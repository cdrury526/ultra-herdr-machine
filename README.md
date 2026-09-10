# ultra-herdr-machine

Public machine CLI for ultra-herdr. It supports explicit operator profiles,
machine setup/recovery keys, credential registration, authenticated credential status
and a renewal path. `whoami` resolves the caller through authenticated backend
verification. Complete enrollment/system installation, task operations and the
visible runtime are not yet available.

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

`python3 scripts/credential-interruption-smoke.py OPERATOR_PROFILE` checks Linux
process-death recovery before and after atomic credential publication. It builds a
test-only C interposer (`cc` required), stops only its own compiled CLI child, kills
that child and retries with the original request or saved profile. It verifies the
actual lock's close-on-exec flag, same-machine recovery and pending-save acknowledgement.
The interposer is not included in the product binary. Fixture machines are revoked.

Caller identity uses the machine configuration (default
`~/.config/ultra-herdr/machine.json`):

```sh
herdr-cli whoami --config /secure/machine.json
```

It returns a verified product session as JSON, waits internally for pending
verification, and fails with a typed setup/retry hint if context is unavailable.
It requires a ready enrolled verifier; credential registration alone does not make
that verifier available. Complete runtime installation and real harness acceptance
are still in progress. The task CLI does not connect to Herdr or choose panes.

This build consumes public API 0.3.0 / protocol 3. It includes generated context
references and response validators. The compiled caller smoke was exercised against
a live backend with modeled terminal observations; that is not actual harness
launch or system-pane acceptance.
