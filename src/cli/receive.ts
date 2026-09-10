import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { receiveTicket } from "../receive/client";
export function addReceiveCommand(program: Command) {
  program.command("receive").description("Verify a ticketed message, save it privately and confirm receipt.")
    .requiredOption("--ticket <ticket>", "Opaque message ticket")
    .option("--config <file>", "Protected machine credential configuration", join(homedir(), ".config", "ultra-herdr", "machine.json"))
    .action(async (options: { ticket: string; config: string }) => {
      console.log(JSON.stringify(await receiveTicket(options.config, options.ticket)));
    });
}
