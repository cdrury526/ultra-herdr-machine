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

This build consumes public API 0.6.0 / protocol 6. It includes generated context
references and response validators. The compiled caller smoke was exercised against
a live backend with modeled terminal observations; that is not actual harness
launch or system-pane acceptance.

## Operator catalog workflow

Catalog commands use an explicitly selected protected operator profile with
`catalog.manage`. They call Convex; they do not require caller-pane discovery or
perform Herdr I/O. Imports remain inactive until complete validation and explicit
review/apply. For example:

```sh
herdr-cli catalog import --profile /secure/operator.json --file catalog.jsonl \
  --mode replace --note "Initial catalog" --request /secure/import.request > release.json
herdr-cli catalog validate --profile /secure/operator.json --release release.json
herdr-cli catalog review --profile /secure/operator.json --release release.json \
  --brief submission --sample sample.json --note "Reviewed catalog" \
  --request /secure/review.request > review.json
herdr-cli catalog diff --profile /secure/operator.json --review REVIEW_ID --page 0
herdr-cli catalog apply --profile /secure/operator.json --review review.json \
  --request /secure/apply.request
herdr-cli catalog export --profile /secure/operator.json --release release.json \
  --output backup.jsonl
```

Use actual brief keys from `catalog entries`; the example's `submission` is an
operator-authored catalog key. A sample contains `values`, `bundleValues` keyed by
exact `key@revision`, and `context` with `recipientRole` plus any supported matching
context. `catalog preview` renders without preparing an activation; `catalog explain`
pages its immutable reasons. `catalog list`, `head`, `show`, and `history` inspect
stored releases and activations. `diff` reports its page count; read every page.

Files use UTF-8 JSONL: first line `{"format":"herdr-catalog-file-1"}`, then one
`{"kind":"schema","key":"example","body":{...}}` record per line, sorted by kind
then key. Exports add manifest metadata to the header and exact `revision` and
`bodyDigest` assertions to records. Bodies contain exact numeric references; when
authored content changes, update its dependent references and any revision/digest
assertions before importing. The backend never overwrites immutable revisions.

`--mode patch` accepts explicit records with `operation: "upsert"` or `"remove"`;
remove records contain only operation, kind and key. Omitted entries remain in the
expected base. Replacement omission removes entries. Inputs stream in bounded
batches; duplicate JSON keys and invalid contracts reject in Convex.

Keep each request file and reuse the same command/input to resume interrupted work.
The file binds content, operator, deployment and expected head. A changed base
requires a new review and request; nothing silently rebases. For rollback, review
the entire prior release against the current head, then use `catalog rollback`
with that review and a new apply request file. Existing exports are never replaced.

The compiled catalog smoke exercises live import/patch, complete validation,
review/apply, retries, canonical export round trip and rollback without Node/Bun
on PATH. Task operations and the complete system runtime remain later work.

## Receive a message

From the intended enrolled session, run the compact instruction delivered to it:

```bash
herdr-cli receive --ticket <opaque-ticket>
```

Use `--config` for a nondefault protected machine profile. The command resolves
its caller internally, verifies message integrity, saves an owner-only artifact
under `<config>.messages/`, and confirms receipt before returning JSON with the
verified envelope, artifact path and original receipt identity. Retry the same
instruction after interruption; it reuses the artifact and does not repeat receipt
effects. Failed or revoked receives print no message body, artifact path or ticket.

The current Phase 04 backend supports live-session assignment receipt. Historical message inspection is available below; other ticket receipt effects remain in implementation;
dispatch, lifecycle commands and automatic worker launch are not available yet.
The API uses endpoint protocol 6; immutable stored message envelopes retain revision 4.

`scripts/receive-smoke.ts` compiles to a standalone smoke covering local publication
and simulated transport interruptions. Private deployment tooling additionally
verifies the shipped command with real machine credentials, public endpoints and
SIGKILL at publication/confirmation boundaries; runtime observations are modeled.

## Inspect a retained message

```bash
herdr-cli history message --task <task-id> --message <message-id>
```

This verifies and saves immutable content without confirming a delivery or applying
an action. Normal reads resolve the live caller and enforce its retained message
cutoff. For a recorded released session, use `--released-session <session-id>` with
that machine's `--config`; both the session and retained binding must be released.
For operator inspection, select `--operator-profile <file>` explicitly; it requires
`history.manage` and cannot be combined with released-session mode. `--digest`
optionally asserts the exact expected SHA-256 content identity.

Reads return `mode: "history"`, the envelope and private artifact path. They expose
no current task/delivery status and do not reset retention or receipt clocks. The
current session path covers direct participant grants; ancestor and packet access
are still being implemented. Historical ticket confirmation is separate work.
