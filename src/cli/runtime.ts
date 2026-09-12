import type { Command } from "commander";
import { enroll, herdrCommand } from "../runtime/install";
import { pluginDirectory, protectedDirectory, pluginId } from "../runtime/config";
import { ensureRuntime } from "../runtime/startup";
import { showAgent } from "../agent/main";
export function addRuntimeCommands(program: Command) {
  program.command("enroll").description("Register this machine, install the plugin and ensure its visible system runtime")
    .option("--config <file>", "Protected machine config (default: plugin config directory)", "")
    .requiredOption("--deployment <url>").requiredOption("--key-file <file>")
    .requiredOption("--name <name>").option("--session <name>", "Enrolled Herdr session", "default")
    .requiredOption("--socket <path>", "Socket of the enrolled Herdr session")
    .requiredOption("--herdr-bin <path>", "Installed Herdr executable")
    .action(async options => console.log(JSON.stringify(await enroll(options), null, 2)));
  program.command("ensure").description("Idempotent installed-plugin startup entrypoint")
    .option("--herdr-bin <path>", "Installed Herdr binary when invoked outside plugin context")
    .action(async options => {
      const directory = process.env.HERDR_PLUGIN_CONFIG_DIR ? pluginDirectory()
        : options.herdrBin ? protectedDirectory(await herdrCommand(options.herdrBin, ["plugin", "config-dir", pluginId]))
        : pluginDirectory();
      console.log(JSON.stringify(await ensureRuntime(directory), null, 2));
    });
  program.command("agent").description("Reserved plugin TUI entrypoint; started by enrollment/ensure")
    .action(async () => showAgent(pluginDirectory()));
}
