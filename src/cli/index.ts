import { addHistoryCommands } from "./history";
import { HistoryError } from "../history/message";
import { addReceiveCommand } from "./receive";
import { ReceiveError } from "../receive/artifact";
import { addCatalogCommands } from "./catalog";
import { CatalogError } from "../catalog/client";
import { Command } from "commander";
import { PROTOCOL_VERSION } from "@ultra-herdr/api";
import { addContextCommands } from "./context";
import { ContextError } from "../context/errors";
import { addAuthCommands } from "./auth";
import metadata from "../../package.json";

const program = new Command()
  .name("herdr-cli")
  .description(`Ultra-herdr machine CLI (protocol ${PROTOCOL_VERSION}). Authenticated message receipt is available; dispatch and lifecycle commands remain in development.`)
  .version(metadata.version)
  .showHelpAfterError();

addAuthCommands(program);
addCatalogCommands(program);
addContextCommands(program);
addReceiveCommand(program);
addHistoryCommands(program);
program.action(() => program.help());
try {
  await program.parseAsync();
} catch (error) {
  // Avoid backend exception bodies, validator inputs and tokens in CLI diagnostics.
  const message = (error instanceof CatalogError || error instanceof ReceiveError || error instanceof HistoryError) ? error.message : error instanceof ContextError ? `${error.code}: ${error.message}`
    : error instanceof Error && error.constructor === Error ? error.message
    : "Operation failed. Check command inputs and current authorization.";
  console.error(message);
  process.exitCode = 1;
}
