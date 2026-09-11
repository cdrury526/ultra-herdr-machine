# ultra-herdr-machine

Public machine CLI for ultra-herdr. It supports explicit operator profiles,
machine setup/recovery keys, credential registration, authenticated credential status
and a renewal path. `whoami` resolves the caller through authenticated backend
verification. Message receipt, retained history, typed worker reports and parent cooperative stops, revisions, completion, feedback and failure are available. Complete
enrollment/system installation, dispatch, other parent decisions and the visible runtime
are not yet available.

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

This build consumes public API 0.10.0 / protocol 10. It includes generated context
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
on PATH. Dispatch and the complete system runtime remain later work.

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

The current Phase 04 backend supports live-session assignment, submission, failure-report, current review-feedback and completion-notice receipt. Historical message inspection is available below; other ticket receipt effects remain in implementation;
dispatch, parent decisions and automatic worker launch are not available yet.
The API uses endpoint protocol 10; immutable stored message envelopes retain revision 4.

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
current session path supports direct grants, explicit ancestor proofs and received
packet references as described below. These reads do not confirm tickets.

## Submit a worker report

```bash
herdr-cli submit --assignment <assignment-message-id> --input report.json --request-file /secure/report-request.json
herdr-cli report-failure --assignment <assignment-message-id> --input failure.json --request-file /secure/failure-request.json
```

Use the immutable assignment/revision message identity returned by receive. The
input is UTF-8 JSON containing `values` and `bundleValues`, with optional
`attributes`; populate the slots required by that assignment's frozen reply
contract. Duplicate keys and invalid contracts reject. Caller discovery is internal.

Keep the request file and retry the same command after interruption. This private
journal stores a request identity and input digest, without report bodies or tickets.
Changing input or caller while reusing it rejects. Use a fresh request-file path
for an intentional new report, including one with identical content. Successful
output identifies the accepted report; lost responses recover that same result.

Current received-assignment reports pause execution for parent review. Failure
reports also require the parent's decision; neither command closes the task or
releases its session. Historical reports retain their actual assignment provenance.
The backend applies feedback on receipt against the still-current review, resuming
only the remaining budget when no stop or exhaustion blocks it. The parent feedback
and closure command surface remains in implementation.

A completion notice reports an already accepted parent decision. Receiving it never
closes a task again or alters a newer task using the retained session. Backend
parent completion now validates the current reviewed submission and child-task
ordering, records evidence and frees the task slot while retaining the session.
The public parent command surface and subtree failure handling remain in progress.

Receive uses stable logical delivery references for new messages and preserves native
references for legacy deliveries. Confirmation keeps the same reference across
backend materialization; ticket format and stored envelope revision are unchanged.

`history list --task <id>` returns one page of authorized message metadata in task
sequence order. Pass the returned cursor with `--cursor` for the next page, or use
`--limit` to request a smaller page. The same live-session, released-session and
operator profile modes as `history message` apply. Listing creates no artifact or
receipt. Use `history message --task <id> --message <id>` to verify a listed body.

Current ancestor managers can investigate a specific descendant using
`history authority --task <id> --request-file /secure/history-authority.json`.
Repeat with the same journal if the returned state is `searching`. Once `verified`,
pass its `checkId` as `--ancestry-check <id>` to `history list` or `history message`
for that task. Every read/page rechecks current ancestor ownership. A stale proof
fails even when a separate direct history grant exists; omit the proof to use that
grant and its cutoff. Proofs are live-session-only and cannot be combined with
packet, released-session or operator modes. They confer no task control or receipt
effects. Use `history authority-discard --check <id>` after investigation to discard
unused proof material (proofs referenced by accepted control operations are retained).

`history tasks --task <parent-id>` lists one page of current direct children.
Use `--scope descendants --task <root-id>` for a root's descendants (the root itself
is excluded). Current owners, proven ancestors (`--ancestry-check`) and operators
with `--operator-profile` / history.manage can investigate their scope. A live
supervisor without parent-wide authority sees only direct children it currently owns,
including individually taken-over children under someone else’s assignment; it cannot list an
arbitrary root or siblings. Released/former-participant grants authorize immutable
history, not current hierarchy. Pages report lineage, current owner and lifecycle
state, without message bodies. Continue `--cursor` even after an empty page; restart
if membership or authority changes. `--limit` is bounded by deployment policy.


If the server rejects a stale cursor, restart without it. A listing's first page
fixes its upper sequence boundary; start a new listing to include later messages.

`inbox` lists one page of the current verified session's pending delivery metadata.
Use `--limit` for a smaller page and `--cursor` to continue; restart without the
cursor if deliveries or permissions changed. Listing neither exposes tickets nor
confirms receipt. A pending old message may remain visible even when its task no
longer permits receipt; use scoped history to inspect retained content.

`receive --delivery <deliveryId> --generation <generation>` uses the inbox fields
to resolve its protected ticket internally, then performs the same verified
artifact/confirmation sequence as `receive --ticket`. The modes are mutually
exclusive. Receive rechecks current grants, generation, binding and task state;
a stale inbox entry cannot authorize an action.

Parent-owned failure uses the current task owner epoch and assignment revision:

```sh
herdr-cli fail --task TASK_ID --owner-epoch 1 --revision 1 \
  --input /secure/failure-briefs.json --request-file /secure/failure-request.json
herdr-cli failure-status --request-file /secure/failure-request.json
```

The input contains `root` and `descendants`. Each selects `noticeBriefKey` and
`stopBriefKey`, with `noticeValues`, `stopValues`, `noticeBundleValues` and
`stopBundleValues` (and optional `attributes`). These must satisfy the task's pinned
brief contracts. The backend validates every generated descendant message before
accepting the failure; panes remain retained. Workers use `report-failure` to ask
the parent for disposition.

`fail` returns a request state. `preparing` means work is pending; only `accepted`
contains the committed decision. Preparation continues in the backend after the
CLI exits. `failure-status` is read-only. If state is `awaiting_authorization`, rerun
`fail` with the original input and request file to provide fresh authority. For
`rejected`, inspect the reported field error and correct the input as a new intent
with a new request file. Reusing an existing journal with changed task, epochs,
briefs, deployment or caller is rejected. The owner-only journal contains identity
and a digest, never bodies, tickets or credentials; retain it across lost responses.

Parent review commands use the task's current review and pinned brief contracts:

```sh
herdr-cli review-state --task TASK_ID
herdr-cli feedback --input /secure/feedback.json --request-file /secure/feedback-request.json
herdr-cli complete --input /secure/completion.json --request-file /secure/completion-request.json
```

`review-state` returns owner epoch, assignment revision, received revision, current
review ID/generation and submission identity, or the committed terminal decision.
It is owner-only, read-only metadata. Retrieve submission content through the normal
receive/history path. State is a snapshot: accepting commands recheck expectations.

Both input files contain `taskId`, `submissionId`, `expectedOwnerEpoch`,
`expectedRevision`, `briefKey`, `values`, `bundleValues` and optional `attributes`.
Feedback additionally contains `reviewId` and `reviewGeneration`; select the pinned
review-feedback brief and identify the same submission in its payload. Completion
additionally contains `failedChildren` (an empty array when none), accounting for
each failed child's task and decision identity with task references in the evidence.
Completion notice type/outcome/decision identity are backend-generated; do not
supply them in payload slots. Omit `requestId`: the CLI saves it before sending.

Feedback requests corrections under the same assignment contract. Accepting feedback
does not resume work; receipt of current feedback does. Completion requires the
latest received revision, current submission and no unfinished children. It releases
the task reservation while retaining the worker session and pane. A changed review,
owner, revision or submission rejects. Unchanged retries recover the same accepted
message after a lost response; changed input or a different operation requires a new
journal. Journals and parent-command diagnostics contain no message bodies or secrets.

Use `revise` for a full assignment revision within the task's existing catalog:

```sh
herdr-cli revise --input /secure/revision.json --request-file /secure/revision-request.json
herdr-cli review-state --task TASK_ID
```

Revision input contains `taskId`, `expectedOwnerEpoch`, `expectedRevision`,
`briefKey`, `values`, `bundleValues`, and optional `attributes`; omit `requestId`.
For the initial catalog, select `briefKey: "revision"` and supply all assignment
payload fields plus `changeReason`. This is a full replacement, not a partial patch.
Reply schemas, task identity, child assignments and execution allowance stay pinned.
One revision may await receipt at a time; `review-state.pendingRevision` identifies
its immutable message. The field is absent after receipt or terminal disposition.

A revision issued during review resumes remaining execution time only on receipt,
unless stopped or exhausted. Running tooling time continues across revision receipt.
A first revision may replace an unread initial assignment; retrieve the new revision
instead of its obsolete initial ticket. The worker then submits against the revision's
message ID. Older reports remain history and cannot satisfy the revised assignment.
Unchanged retries use the same protected request file; changing operation or input
conflicts with that journal.

### Task questions and replies

Use `ask --input question.json --request-file question-request.json` to send a
question to an authorized participant in the task. Questions can refer to completed
tasks and do not pause, restart, or reopen execution. The initial interface supports
direct task participants, including transferred reply authority. Current ancestors can add `ancestryCheckId` to question or nudge input; explicit
packet/ancestor citation proofs remain separate as described below. Include
`--config` when using a nondefault machine profile.

Question input contains `taskId`, `recipientSessionId`, `briefKey`, `values`,
`bundleValues`, and optional `attributes`. For the initial `question` brief,
`values.payload` contains `question` (text), `context` (authorized reference array),
`purpose` (`clarification` or `context`), and `expectsReply` (boolean). Supply any
bundle inputs required by the pinned catalog. The CLI supplies `kind` and `requestId`;
do not include them in the file.

`question-state --request <question-message-id>` returns response metadata to the
requester or current responder. `obligation: null` means the question is one-way.
An open obligation has a `generation`; `receivedAt` and `dueAt` appear after first
confirmed receipt. Inspection does not receive content or change clocks.

Use `reply --input reply.json --request-file reply-request.json`. Reply input contains
`requestMessageId`, `expectedGeneration` from question-state, `values`,
`bundleValues`, and optional `attributes`. For the initial pinned reply brief,
`values.payload` contains the same `requestMessageId`, `answer` (text), `evidence`
(`summary` and authorized `references`), and `final` (boolean). Interim replies leave
the obligation open. A valid current final reply resolves it without completing the
task. Later valid answers remain historical evidence. Retrieve either message with
the ordinary `receive` command and its returned delivery identity.

Both accepting commands parse a bounded typed input file and save a protected,
body-free retry journal before sending. Reuse the same input and journal after a
lost response; a fresh journal represents a new intent. Changed input, operation,
deployment, or caller conflicts with an existing journal. Response timers are durable
records; automated overdue reminders/escalation remain in development.

Use `nudge --input nudge.json --request-file nudge-request.json` to ask an
already authorized request recipient for an update. Input contains
`requestMessageId`, `briefKey`, `values`, `bundleValues`, and optional `attributes`.
For the initial `nudge` brief, `values.payload` contains that same
`requestMessageId` and `text`. Refer to the original addressed message, not an
earlier nudge or system reminder. A reply awaiting receipt is itself an addressed
message and can be nudged by a permitted participant other than its recipient. The backend resolves its recipient and applies
the original request's pinned cooldown (five minutes in the initial catalog),
shared across senders and brief choices. An unopened earlier nudge does not prevent
a new one after cooldown. Nudges do not reset receipt/reply deadlines, resolve
obligations or change task ownership. Current direct-participant authority applies;
ancestor and transferred authority remain in development.

### Execution allowance

`budget --task <task-id>` returns a timestamped snapshot for the current task owner:
`asOfMs`, `allowanceMs`, stored `spentMs`, `accruedSpentMs` including elapsed running
time, `remainingMs`, optional `runningSince`, clock generation, owner/revision
expectations, stop epochs, terminal outcome and the original pinned extension bounds.
All durations are milliseconds. Inspection does not expire execution or start/stop a
clock, and the snapshot grants no permission to a later operation.

`extend --input extension.json --request-file extension-request.json` takes `taskId`,
`expectedOwnerEpoch`, `expectedRevision`, positive integer `addedAllowanceMs`,
`briefKey`, `values`, `bundleValues`, and optional `attributes`. The initial brief is
`extension`, with `values.payload.reason` as text. Supply required pinned bundle
inputs and omit `requestId`; the CLI saves its generated identity before acceptance.
Use the same protected journal and unchanged input after a lost response.

Extension checks the task's original per-increment and optional cumulative bounds.
It changes allowance once, preserves elapsed time and never clears a stop or review
pause. Receipt of its notice grants no additional time. An already expired running
task currently refuses extension until its due subtree stop can be accepted; that
expiry integration and explicit stop/resume commands remain in development. Include
`--config` when using a nondefault machine profile.

### Cooperative subtree stop

The current task owner can request a nonterminal stop for a task and its unfinished
descendants:

```bash
herdr-cli stop --task <task-id> --owner-epoch 1 --revision 1 \
  --input /secure/stop-briefs.json --request-file /secure/stop-request.json
herdr-cli stop-status --request-file /secure/stop-request.json
```

The input contains `root` and `descendants`; each has `stopBriefKey`, `stopValues`
and `stopBundleValues`. For the seeded catalog, use brief `stop` and supply
`stopValues.payload.reason`, with bundle slots from the selected pinned catalog.
The backend supplies the stop cause. Task owners may inspect the current expected
owner epoch and revision through `review-state`.

`preparing` means the request has not yet taken effect. On acceptance, delegation
is blocked throughout the unfinished subtree. Running time continues until each
worker confirms its stop ticket with `receive`; tasks, reviews and session reservations
remain retained. This is cooperative: it does not interrupt current tooling or close
panes. Reuse the original input and request journal after interruption or when state
is `awaiting_authorization`. Status is read-only, and failure/stop journals are distinct.
An extension does not resume stopped work. Explicit per-task resume is available below; automatic execution expiry is still
being implemented.

### Resume one stopped task

```bash
herdr-cli review-state --task <task-id>
herdr-cli resume --input /secure/resume.json --request-file /secure/resume-request.json
```

The input includes `taskId`, `expectedOwnerEpoch`, `expectedRevision`,
`expectedStopEpoch`, `briefKey`, `values`, and `bundleValues`. For the seeded catalog,
select `resume` and supply `values.payload.reason` plus its required bundle slots.
The CLI supplies the durable request identity. Reuse the same input and request
journal after interruption.

`review-state` exposes stop `epoch`, `receivedEpoch`, and `resumedThroughEpoch`.
A pending resume includes its message identity, stop epoch, revision and `superseded`
flag. That flag reports whether its saved state has changed; it is not a readiness
check or authorization. Terminal tasks omit pending resume metadata.

Resume requires the current stop and assignment to be received, positive remaining
time, a verified current worker binding, no pending review/revision, and a parent
that is nonterminal, unstopped and has available time. Acceptance leaves the stop
and clock unchanged. Worker `receive` rechecks those conditions and restarts only
that task's remaining time. Resume parent tasks before their children; descendants
remain stopped until separately resumed. A changed stop, assignment, binding, review
or clock generation invalidates an unread resume. An extension changes the clock
generation: issue a fresh explicit resume after extending. Use a new request file
for a replacement resume when the old pending snapshot is superseded; the original
journal always recovers the original message. Existing received-ticket
retries retain their original artifact and receipt.

## Operator escalation inbox

Operators can retrieve execution-budget escalation messages addressed to their own
identity using an explicit protected profile with `inbox.review`:

```bash
herdr-cli operator inbox --profile /secure/operator.json
herdr-cli operator escalations --profile /secure/operator.json
herdr-cli operator receive --profile /secure/operator.json --delivery DELIVERY_ID --generation 1
```

Receive also accepts `--ticket TICKET` instead of delivery and generation. It verifies
and atomically saves an owner-only message artifact before confirming receipt, then
prints the result. Interrupted retries retain the same artifact and receipt.
Acknowledgement does not take over a task, resume execution, or acknowledge the
worker's stop. These commands require no Herdr pane or machine caller binding.
History access remains separately authorized. Other escalation causes are not yet
supported for receipt. API 0.18 uses a new inbox cursor format; restart pagination
without a cursor after upgrading.

To retrieve an earlier message explicitly cited by an acknowledged execution
escalation, select that packet rather than general history authority:

```bash
herdr-cli history message --operator-profile /secure/operator.json \
  --task TASK_ID --packet ESCALATION_MESSAGE_ID --message REFERENCED_MESSAGE_ID
```

This mode requires `inbox.review` for an operator. Live or released sessions use
the existing explicit session options and must be the packet's addressed recipient.
It retrieves only the named earlier same-task message, verifies and saves its
private artifact, and reports `mode: packet`. It does not acknowledge the target,
start its clocks, or grant general task history. Receive the escalation first.
Task/session identity references do not grant current-state access; this command
retrieves message/submission bodies only. Received assignments/revisions, question
context, and submission/failure/reply/notice evidence also grant their explicit
message references. For these, use `history message --task PACKET_TASK_ID
--packet RECEIVED_MESSAGE_ID --message REFERENCED_MESSAGE_ID`. The source may belong
to another task; the saved envelope retains its actual source task identity.
The packet must already be received and its content still authorized. Only the
selected explicit reference is readable: there is no whole-source-task grant or
recursive expansion through another packet. Reads never acknowledge the source or
restart its clocks. Missing/erased content fails explicitly.

When citing a source that is readable only through a received packet or ancestor
proof, add optional `referenceAuthorities` beside `values` and `bundleValues` in
report, question/reply, revision or completion input. The `referenceId` must identify
a cited reference; duplicate and unused mappings fail. Examples:

```json
{
  "referenceAuthorities": [
    {"kind": "packet", "referenceId": "SOURCE_MESSAGE_ID", "taskId": "PACKET_TASK_ID", "packetId": "RECEIVED_MESSAGE_ID"},
    {"kind": "ancestor", "referenceId": "DESCENDANT_MESSAGE_ID", "checkId": "VERIFIED_ANCESTRY_CHECK_ID"}
  ]
}
```

Use the mapping appropriate to each source; other input fields remain required.
Packet proof permits only the explicitly received message/submission edge. Ancestor
proof permits the referenced task or its message/submission under current ownership.
A supplied stale or wrong proof fails even if another grant could permit the source.
Proofs authorize citation, not the destination task operation, its recipient, or
reply/control authority. They are included in the request digest; an unchanged
accepted retry returns the original result rather than creating a new citation.
For staged failure, put `referenceAuthorities` inside each applicable `root` or
`descendants` slot object, beside `noticeValues`. Proof authority must remain valid
until activation; revocation invalidates prepared drafts.

For a new ancestor question or nudge, add `"ancestryCheckId": "VERIFIED_CHECK_ID"`
to ordinary `ask`/`nudge` input. The proof must target that conversation's task and
is checked against current ancestor ownership. Recipients still need ordinary
current task-message authority. The accepted question gives its requester narrow
access to that question and addressed replies, including after ancestor ownership
changes; it creates no general task participation. Read replies through `receive`
or their explicit history message ID. `question-state` remains requester/responder
only. New questions/nudges after authority loss fail; an unchanged accepted retry
returns its original result. Discarding an unused ancestry proof does not erase the
accepted conversation's audit or its narrow historical grant.



`operator escalations` lists one page of awaiting, unresolved, or blocked review and reply
escalations addressed to the selected operator, including messages already received.
Receipt does not reset the response window. Resolved or superseded reviews disappear
from this view while their accepted message receipts remain available. Follow a
non-null `cursor` with `--cursor`, even after an empty page. If the listing changes,
restart without a cursor. Review items precede reply items; an empty review page
can have a continuation to the reply page. A final answer removes its reply item;
task completion alone does not. This metadata view grants no task-control authority.

### Force-release obligation review

`force-release-preview --task TASK --config PROFILE` is read-only metadata
pagination. Its cursor does not establish that every page was reviewed.

Start a durable review with `force-release-review --task TASK --request-file JOURNAL
--config PROFILE`. Read the returned page, then invoke `force-release-review-ack
--review REVIEW_ID --generation GENERATION --page-digest DIGEST --config PROFILE`
with that page's returned fields. Each acknowledgement returns the next page;
acknowledge empty pages too. The final acknowledgement returns `reviewed`.
There is no automatic acknowledgement. Retrying the same acknowledgement recovers
its exact successor page. Repeating the begin command returns the original first
page; it does not advance the review. `state` describes overall review progress,
including acknowledgements already accepted from another invocation by this actor.

Changed work, obligations or authority invalidate the review. Discard an unused
review with `force-release-review-discard --review REVIEW_ID --config PROFILE`;
remaining cleanup continues automatically. Start a new review with a new journal
when the old scope is stale. Journals contain the request identity and scope digest,
not task bodies, tickets, or credentials.

The corresponding `operator-force-release-review`, `operator-force-release-review-ack`
and `operator-force-release-review-discard` commands require an explicit
`--operator-profile PROFILE` with `sessions.forceRelease`. Operator and session
reviews cannot be exchanged. Reviewing alone never requests release.

After the final acknowledgement, run:

```bash
herdr-cli force-release --review REVIEW_ID --input force-release.json --request-file force-request.json --config PROFILE
```

The JSON input contains `reason` and three notice selections: `executionNotice`,
`responseNotice`, and `closedNotice`. Each selection contains `briefKey`, `values`,
`bundleValues`, and optional `attributes`. For the initial catalog the brief keys
are `notice-execution-unavailable`, `notice-response-unavailable`, and
`notice-session-released`; supply `values: {"payload": {}}` and the bundle slots
required by the selected catalog. The backend supplies identity, reason and
unavailable/confirmed-state fields. Do not supply `requestId`; the CLI journals it.
Each notice must validate against its task or original question's pinned release.

The command advances bounded preparation, then atomically accepts the audited
release, execution-unavailable state, response-unavailable incoming requests and
requester/supervisor notices. It preserves unfinished tasks, submissions, child
execution and outgoing requests. Receiving notices is informational. Late valid
replies remain evidence and cannot resolve an unavailable response obligation.
`release-state` shows the execution-unavailable fact.

Retry with the same review, input and request file after interruption. If an
unaccepted preparation's progress lease expires, automatic cleanup frees the
coordinator; perform a new review with new journals. Changed scope or invalid
pinned notice contracts also require discarding the unused review and starting
a fresh one. Accepted review and decision records remain protected.

`operator-force-release` provides the same operation with an explicit
`--operator-profile PROFILE` and that operator's own completed review.
A `closing` result is a durable close intent. Actual machine pane closure and its
confirmation are Phase 05 work; no physical closure is performed by this CLI.

Ownership offers and explicit takeover are available through `handoff`, `takeover`,
`operator-handoff`, and `operator-takeover` (API/CLI 0.28.0). Each takes a typed
`--input` file and a separate protected `--request-file`; reuse that journal for
retries of the same intent. Handoff publication leaves the current owner responsible;
control changes only after the recipient confirms receipt. Takeover continues bounded
preparation internally and requires backend-verified eligibility. Operator commands
require an explicit profile with `tasks.takeover` and `inbox.review`.

Receive internally completes pending handoff preparation before returning the receipt.
Transferred obligation notices include a verified original-content artifact as
`sourcePath`; existing response deadlines remain backend-owned. These paths have
backend domain and local client checks; compiled live ownership acceptance, operator
response actions and replacement are still under implementation. This does not
establish actual worker launch or dispatch.

`operator-reply` (API/CLI 0.29.0) answers a question whose response authority was
transferred to the explicitly authenticated operator. Supply `--operator-profile`,
`--input` and a protected `--request-file`; input uses the ordinary reply fields
without `kind` or `requestId`. Only a current final answer resolves the obligation.
Backend live checks cover authority, stale generation, retries and requester receipt;
compiled live operator-reply acceptance remains pending. Operator review actions,
operator-directed nudges and replacement are still under implementation.

API/CLI 0.30.0 adds `operator-feedback`, `operator-complete`, `operator-revise`,
`operator-extend`, `operator-resume`, and `operator-review-state`. Use an explicit
`--operator-profile`; actions use the ordinary typed input and protected retry
journal. Fresh credentials and current task ownership authorize new actions.
Same-intent retries recover the already accepted result under retained message access;
they do not repeat the action or regain task control. Operator-addressed submissions
and failure reports are receivable without implicitly completing the task.

Live backend checks exercise operator feedback, worker receipt/resumption, a corrected
submission, operator report receipt, completion/retry and retained session reservation.
Operator revision/extension/resume success and compiled live real-JWT acceptance remain
pending; shared session behavior is not claimed as new operator acceptance evidence.

The existing worker `nudge` command also routes to an operator after that operator
receives response authority through takeover/handoff. `operator-receive` accepts the
informational nudge; receipt does not reset the original reply deadline. Backend
checks verify cooldown, retry and receipt alongside operator extension and revision
success (including worker receipt). Operator-originated nudges, operator resume
acceptance and real-JWT compiled ownership verification remain pending.

API/CLI 0.31.0 adds `operator-stop`, `operator-fail`, `operator-stop-status`, and
`operator-failure-status`. Explicit takeover/handoff must make the operator the
current owner first. Supply `--operator-profile`, expected task/owner/revision,
brief input and a protected retry journal. Preparing means pending; status does
not refresh authorization. Repeating the unchanged request can renew preparation
under fresh credentials from the same operator family.

Scheduled work checks the stored ordinary credential's expiry, revocation, family
and capabilities without a machine binding or stored JWT. Live backend checks cover
operator stop acceptance, worker receipt, explicit resume/receipt, failure acceptance
and same-intent recovery. Caller/runtime are modeled and operator identity uses
admin impersonation. Compiled real-JWT acceptance, operator authorization recovery/
revocation faults, descendant combinations and expiry-precedence races remain pending.

API/CLI 0.32.0 adds `operator-nudge --operator-profile <file> --input <file>
--request-file <file>`. Input supplies `requestMessageId`, `briefKey`, `values` and
`bundleValues`; omit `kind` and `requestId`. The operator needs takeover/review
capabilities and participation covering the original and new message. The backend
selects the recipient and enforces the original request's shared cooldown. Receipt
is informational and preserves response clocks. Reuse the protected journal for an
unchanged retry. Domain acceptance uses modeled callers; compiled real-JWT acceptance
of this command remains pending.

API/CLI 0.33.0 validates optional replacement context in assignment envelopes:
`taskId`, `assignmentRevision`, `historyThroughSequence`, and
`sourceInstructions: "superseded"`. These identify retained prior-task history;
the new assignment supplies the governing instructions. Public replacement/dispatch
commands still await their orchestration integration.

### Cloud history disposal

An operator with `history.manage` can request audited disposal. The backend checks
retention age, active work, unanswered requests and protected references, then
continues in bounded batches. `--early` explicitly bypasses only the age requirement.

```bash
herdr-cli history cleanup --task <task-id> --reason "Approved history disposal" \
  --operator-profile /secure/operator.json --request-file /secure/cleanup-request.json
herdr-cli history cleanup-status --cleanup <cleanup-id> --operator-profile /secure/operator.json
herdr-cli history cleanup-list --task <task-id> --operator-profile /secure/operator.json
```

Reuse the same request file for unchanged retries. `cleanup-resume --cleanup <id>`
uses current operator authority to advance and rearm interrupted work.
`cleanup-cancel --cleanup <id>` cancels checking before deletion is accepted;
accepted deletion must finish. Both require `--operator-profile`. Canceling an
automatic attempt does not disable the retention policy; a later sweep reevaluates
eligibility.

Disposal revokes old tickets and erases eligible cloud bodies while preserving task,
session and audit identities. Later authorized questions and explicit session release
remain possible. Cloud disposal leaves local verified artifacts and credentials untouched. Local
artifact cleanup is a separate explicit operation below. Automatic cloud cleanup uses a configurable
one-year default and rechecks substantive activity and references before acceptance.
API/CLI 0.34.0 adds these disposal commands.


### Local artifact cleanup

Preview one task, one assigned-worker/message-participant session, or the selected
profile's cache. Preview never removes files. Use a new private manifest filename;
existing files are not overwritten.

```bash
herdr-cli history local-cleanup preview --task <task-id> \
  --operator-profile /secure/operator.json --preview-file /secure/cache-preview.json
herdr-cli history local-cleanup apply \
  --operator-profile /secure/operator.json --preview-file /secure/cache-preview.json
```

Replace `--task` with `--session <id>` or `--eligible-cache` to change scope. A
preview inspects 100 files by default (`--limit` up to 1000); use its `next` value
with `--after` and a new manifest for another page. Apply removes eligible IDs from
that manifest; `--artifact <ids...>` selects a subset. Scope is fixed by the manifest.
Machine profiles use the same live or `--released-session` history authority as
history reads; `--operator-profile` selects that operator's adjacent cache.

Apply rechecks current backend permission and file identity. Active tasks and
unanswered requests block removal. Replaced files require a new preview; already
absent files are harmless retries. Cleanup and artifact saving share a local lock.
Unknown files, symlinks, malformed envelopes and credentials are excluded. Local
cleanup changes no cloud content or receipt facts. Retained cloud content can be
retrieved again; new receives may save fresh artifacts after cleanup.
API/CLI 0.35.0 adds this explicit local cleanup flow.


Obligation and delivery citations identify their immutable source message. Use an
obligation ID or a native/logical delivery ID in `{kind,id,digest?}`; an optional
digest must match that message. Normal source-content authority or an explicit
ancestor/received-source packet proof is required. The envelope keeps the typed
reference while retention protects its source message. Citing it grants no current
reply or delivery status. Standalone typed-reference retrieval remains pending.


Task decision citations use `{kind:"decision",id:DECISION_ID,digest?}`. The optional
digest identifies the canonical decision, while access and retention follow its
accepted notice. Failure/stop decisions become citable after activation, including
before physical copy. Unpublished preparations are unavailable. This covers task
completion/failure/stop/extension/replacement decisions; release/ownership decision
citations and standalone typed-reference retrieval remain pending.
