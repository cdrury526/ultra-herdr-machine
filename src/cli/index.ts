import { Command } from "commander";
import { PROTOCOL_VERSION } from "@ultra-herdr/api";
import { addContextCommands } from "./context";
import { ContextError } from "../context/errors";
import { addAuthCommands } from "./auth";
import metadata from "../../package.json";

const program = new Command()
  .name("herdr-cli")
  .description(`Ultra-herdr machine CLI (protocol ${PROTOCOL_VERSION}). Task operations are not available yet.`)
  .version(metadata.version)
  .showHelpAfterError();

addAuthCommands(program);
addContextCommands(program);
program.action(() => program.help());
try {
  await program.parseAsync();
} catch (error) {
  // Avoid backend exception bodies, validator inputs and tokens in CLI diagnostics.
  const message = error instanceof ContextError ? `${error.code}: ${error.message}`
    : error instanceof Error && error.constructor === Error ? error.message
    : "Credential operation failed. Check protected inputs and current authorization.";
  console.error(message);
  process.exitCode = 1;
}
