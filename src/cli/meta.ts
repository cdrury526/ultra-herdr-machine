import type { Command } from "commander";
import { buildCommandCatalog } from "./metaCatalog";

export function addMetaCommands(program: Command) {
  const meta = program.command("meta").description("Machine-readable CLI discovery (commands, flags, task/ticket-first recipes).");
  meta.command("commands").description("JSON catalog of mutating commands, flags, and recommended argv recipes.")
    .action(() => { console.log(JSON.stringify(buildCommandCatalog(), null, 2)); });
}
