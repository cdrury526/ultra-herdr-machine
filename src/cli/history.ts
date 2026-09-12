import { defaultMachineConfig } from "../auth/default";
import { listTaskHierarchy } from "../history/tasks";
import { checkReleaseAuthority, discardReleaseAuthority } from "../release/ancestry";
import { listMessageHistory, type HistoryListOptions } from "../history/list";
import { addHistoryCleanupCommands } from "./historyCleanup";
import { addLocalCleanupCommands } from "./localCleanup";
import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { readMessageHistory, type HistoryOptions } from "../history/message";
export function addHistoryCommands(program: Command) {
  const history = program.command("history").description("Inspect authorized immutable history without applying receipt effects.");
  history.command("authority").description("Prove current ancestor access to one descendant task; repeat the same journal while searching.")
    .requiredOption("--task <id>", "Descendant task identity")
    .requiredOption("--request-file <file>", "Protected retry journal")
    .option("--config <file>", "Protected machine profile", defaultMachineConfig())
    .action(async options => { console.log(JSON.stringify(await checkReleaseAuthority(options))); });
  history.command("authority-discard").description("Discard unused lineage proof after investigation.")
    .requiredOption("--check <id>", "Ancestry check identity")
    .option("--config <file>", "Protected machine profile", defaultMachineConfig())
    .action(async options => { console.log(JSON.stringify(await discardReleaseAuthority(options))); });
  history.command("tasks").description("List current direct children or root descendants within current authority.")
    .requiredOption("--task <id>", "Parent task, or root task for descendants")
    .option("--scope <scope>", "children or descendants", "children")
    .option("--ancestry-check <id>", "Verified ancestor proof for the parent task")
    .option("--cursor <cursor>", "Continue a page; restart when scope or membership changes")
    .option("--limit <count>", "Page size up to the deployment's configured bound")
    .option("--config <file>", "Protected machine profile", defaultMachineConfig())
    .option("--operator-profile <file>", "Explicit operator profile with history.manage")
    .action(async options => { console.log(JSON.stringify(await listTaskHierarchy(options))); });
  addHistoryCleanupCommands(history);
  addLocalCleanupCommands(history);
  history.command("list").description("List one authorized page of immutable message metadata in task order.")
    .requiredOption("--task <id>", "Task identity")
    .option("--ancestry-check <id>", "Verified current ancestor proof for this task; live session only")
    .option("--cursor <cursor>", "Continue a previous page; restart if history or permissions changed")
    .option("--limit <count>", "Page size up to the deployment's configured bound")
    .option("--config <file>", "Protected machine profile", defaultMachineConfig())
    .option("--released-session <id>", "Use this machine's recorded released session and its retained grants")
    .option("--operator-profile <file>", "Explicit operator profile with history.manage; excludes released-session mode")
    .action(async (options: HistoryListOptions) => { console.log(JSON.stringify(await listMessageHistory(options))); });
  history.command("message").description("Read one task-scoped message and save a verified private artifact.")
    .requiredOption("--task <id>", "Expected task identity, or packet task with --packet")
    .option("--ancestry-check <id>", "Verified current ancestor proof for this task; excludes packet/released/operator modes")
    .requiredOption("--message <id>", "Immutable message identity")
    .option("--digest <sha256>", "Expected message digest")
    .option("--packet <id>", "Received message explicitly referencing this body; --task is the packet task, operator requires inbox.review")
    .option("--config <file>", "Protected machine profile", defaultMachineConfig())
    .option("--released-session <id>", "Use this machine's recorded released session and its retained grants")
    .option("--operator-profile <file>", "Explicit operator profile: history.manage, or inbox.review with --packet; excludes released-session mode")
    .action(async (options: HistoryOptions) => { console.log(JSON.stringify(await readMessageHistory(options))); });
}
