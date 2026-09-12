import { PROTOCOL_VERSION } from "@ultra-herdr/api";

type Flag = { name: string; required?: boolean; description: string };
type Recipe = { label: string; role: "manager" | "supervisor" | "worker" | "any"; argv: string[] };
type CommandMeta = {
  name: string; group: string; description: string; mutating: boolean;
  taskFirst?: boolean; ticketFirst?: boolean;
  input?: { modes: string[]; reportSlots?: boolean };
  requestFile?: { auto: boolean; note?: string };
  flags: Flag[]; recipes: Recipe[];
};

const journalReuse = "Reuse the same --request-file path with unchanged input after interruption; a new path is a new intent.";

export function buildCommandCatalog() {
  const commands: CommandMeta[] = [
    { name: "receive", group: "inbox", description: "Retrieve and confirm one ticketed delivery.", mutating: true, ticketFirst: true,
      requestFile: { auto: false, note: "Receipt uses delivery identity; no request journal." },
      flags: [{ name: "--ticket", required: true, description: "Opaque ticket from terminal offer or inbox" },
        { name: "--delivery", description: "Delivery id with --generation when ticket unavailable" },
        { name: "--generation", description: "Delivery generation with --delivery" }],
      recipes: [{ label: "Worker or manager receive", role: "any", argv: ["herdr-cli", "receive", "--ticket", "<ticket>"] }] },
    { name: "context", group: "discovery", description: "Scoped task/ticket state, actions, and scaffolds.", mutating: false, taskFirst: true,
      flags: [{ name: "--task", description: "Task identity" }, { name: "--ticket", description: "Ticket anchor" },
        { name: "--delivery", description: "Delivery anchor with --generation" }, { name: "--generation", description: "Delivery generation" }],
      recipes: [{ label: "Inspect task", role: "any", argv: ["herdr-cli", "context", "--task", "<task-id>"] }] },
    { name: "dispatch", group: "manager", description: "Accept assignment and start worker orchestration.", mutating: true,
      input: { modes: ["--input", "--data", "--data-file"] }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--input|--data|--data-file", required: true, description: "briefKey, launchProfileKey, workingDirectory, values" }],
      recipes: [{ label: "Manager dispatch (inline)", role: "manager", argv: ["herdr-cli", "dispatch", "--data", "{...}", "--request-file", "dispatch.request.json"] }] },
    { name: "submit", group: "worker", description: "Send typed worker submission.", mutating: true, taskFirst: true,
      input: { modes: ["--input", "--data", "--data-file"], reportSlots: true }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--task", description: "Resolve assignment from task (preferred)" }, { name: "--assignment", description: "Legacy assignment message id" },
        { name: "--data", description: "Report payload or {values:…}" }],
      recipes: [{ label: "Worker submit", role: "worker", argv: ["herdr-cli", "submit", "--task", "<task-id>", "--data", "{\"payload\":{...}}"] }] },
    { name: "report-failure", group: "worker", description: "Send typed failure report.", mutating: true, taskFirst: true,
      input: { modes: ["--input", "--data", "--data-file"], reportSlots: true }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--task", description: "Resolve assignment from task (preferred)" }, { name: "--data", description: "Failure payload" }],
      recipes: [{ label: "Worker failure", role: "worker", argv: ["herdr-cli", "report-failure", "--task", "<task-id>", "--data", "{\"payload\":{...}}"] }] },
    { name: "feedback", group: "parent", description: "Send same-contract corrections.", mutating: true, taskFirst: true,
      input: { modes: ["--input", "--data", "--data-file"] }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--task", description: "Scaffold from review-state (preferred)" }, { name: "--note", description: "Feedback text with --task" }],
      recipes: [{ label: "Parent feedback", role: "manager", argv: ["herdr-cli", "feedback", "--task", "<task-id>", "--note", "..."] }] },
    { name: "complete", group: "parent", description: "Accept submission; retain worker session.", mutating: true, taskFirst: true,
      input: { modes: ["--input", "--data", "--data-file"] }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--task", description: "Scaffold from review-state (preferred)" }, { name: "--summary", description: "Completion summary with --task" }],
      recipes: [{ label: "Parent complete", role: "manager", argv: ["herdr-cli", "complete", "--task", "<task-id>", "--summary", "..."] }] },
    { name: "release", group: "parent", description: "Request routine worker session release.", mutating: true, taskFirst: true,
      input: { modes: ["--input", "--data", "--data-file"] }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--task", description: "Scaffold from release-state (preferred)" }, { name: "--reason", description: "Release reason with --task" }],
      recipes: [{ label: "Parent release", role: "manager", argv: ["herdr-cli", "release", "--task", "<task-id>", "--reason", "..."] }] },
    { name: "revise", group: "parent", description: "Full assignment revision.", mutating: true, taskFirst: true,
      input: { modes: ["--input", "--data", "--data-file"] }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--task", description: "Clone latest assignment payload" }, { name: "--reason", required: true, description: "changeReason with --task" }],
      recipes: [{ label: "Parent revise", role: "manager", argv: ["herdr-cli", "revise", "--task", "<task-id>", "--reason", "..."] }] },
    { name: "extend", group: "parent", description: "Increase allowance within pinned bounds.", mutating: true, taskFirst: true,
      input: { modes: ["--input", "--data", "--data-file"] }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--task", description: "Scaffold from review-state" }, { name: "--allowance-ms", required: true, description: "Positive increment" },
        { name: "--reason", required: true, description: "Extension reason" }],
      recipes: [{ label: "Parent extend", role: "manager", argv: ["herdr-cli", "extend", "--task", "<task-id>", "--allowance-ms", "60000", "--reason", "..."] }] },
    { name: "resume", group: "parent", description: "Resume one stopped task.", mutating: true, taskFirst: true,
      input: { modes: ["--input", "--data", "--data-file"] }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--task", description: "Scaffold from stop metadata" }, { name: "--reason", required: true, description: "Resume reason" }],
      recipes: [{ label: "Parent resume", role: "manager", argv: ["herdr-cli", "resume", "--task", "<task-id>", "--reason", "..."] }] },
    { name: "ask", group: "conversation", description: "Send typed task question.", mutating: true,
      input: { modes: ["--input", "--data", "--data-file"] }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--data", description: "Question brief slots" }],
      recipes: [{ label: "Task question", role: "any", argv: ["herdr-cli", "ask", "--data", "{...}"] }] },
    { name: "reply", group: "conversation", description: "Send correlated answer.", mutating: true,
      input: { modes: ["--input", "--data", "--data-file"] }, requestFile: { auto: true, note: journalReuse },
      flags: [{ name: "--data", description: "Reply brief slots" }],
      recipes: [{ label: "Question reply", role: "any", argv: ["herdr-cli", "reply", "--data", "{...}"] }] },
  ];
  return {
    version: 1, cli: "herdr-cli", protocolVersion: PROTOCOL_VERSION,
    conventions: {
      inputAliases: ["--data", "--data-file"],
      requestFileAutoPath: "/tmp/herdr-cli-<operation>-request-<uuid>/request.json",
      explicitRequestFile: ["release-authority", "fail-status", "stop-status", "operator-fail-status", "operator-stop-status",
        "force-release-review", "operator-force-release-review", "catalog import/review/apply (--request)"],
      taskFirst: "Prefer --task or --ticket plus content flags; omit assignment message ids and owner epochs in harness instructions.",
    },
    commands,
  };
}
