import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCaller } from "../context/resolve";
export function addContextCommands(program: Command) {
  program.command("whoami").description("Resolve this caller's verified product session.")
    .option("--config <file>", "Protected machine credential configuration", join(homedir(), ".config", "ultra-herdr", "machine.json"))
    .action(async (options: { config: string }) => { console.log(JSON.stringify(await resolveCaller(options.config))); });
}
