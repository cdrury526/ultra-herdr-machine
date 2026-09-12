import type { Command } from "commander";
import { formatBuildVersion } from "../buildInfo";

export function addVersionCommand(program: Command) {
  program.command("version").description("Show package version and embedded build identity.")
    .option("--json", "Print build metadata as JSON")
    .action((options: { json?: boolean }) => { console.log(formatBuildVersion({ verbose: options.json })); });
}
