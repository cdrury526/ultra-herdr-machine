# Contributor instructions

This is the public machine repository. Never copy private cloud implementation or
credentials here. The CLI is compiled with Bun; cloud state/authorization belongs
to Convex and pane I/O belongs to the visible machine runtime. Harnesses
use product task commands, not Herdr routing. Configuration is catalog data, never
harness-name branches. Task completion retains the pane until authorized release.

Implement only the current authorized initiative phase. Advertise only implemented behavior. Credential operations and the backend-driven `whoami` client are implemented;
enrollment/plugin/ensure and the authenticated system TUI are implemented. Worker
command execution and public dispatch remain unavailable until their owning targets. Source/config files must remain at most
600 lines; split at natural module boundaries. Markdown/generated builds are exempt.
Run `bun run typecheck`, relevant builds/smokes and `scripts/check-file-length.sh`.
Commit and push completed logical chunks to origin/main without prompting. Never
commit credentials or overwrite user changes. Read the private cloud initiative
handoff when that repository is available to the contributor.
