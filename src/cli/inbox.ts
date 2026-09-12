import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { readInbox } from "../receive/inbox";
export function addInboxCommand(program: Command) {
  program.command("inbox").description("List one page of this session's pending delivery metadata.")
    .option("--cursor <cursor>", "Continue a previous page; restart if deliveries or permissions changed")
    .option("--limit <count>", "Page size up to the deployment's configured bound")
    .option("--config <file>", "Protected machine profile", defaultMachineConfig())
    .action(async (options: { config: string; cursor?: string; limit?: string }) => console.log(JSON.stringify(await readInbox(options))));
}
