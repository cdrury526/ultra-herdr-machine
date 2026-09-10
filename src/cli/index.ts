import { Command } from "commander";
import { PROTOCOL_VERSION } from "@ultra-herdr/api";
import metadata from "../../package.json";

const program = new Command()
  .name("herdr-cli")
  .description(`Ultra-herdr machine CLI (protocol ${PROTOCOL_VERSION}). Task operations are not available yet.`)
  .version(metadata.version)
  .showHelpAfterError();

program.action(() => program.help());
await program.parseAsync();
