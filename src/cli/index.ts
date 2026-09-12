import { addRuntimeCommands } from "./runtime";
import { addOwnershipCommands } from "./ownership";
import { addReleaseCommands } from "./release";
import { ReleaseError } from "../release/client";
import { addConversationCommands } from "./conversation";
import { ConversationError } from "../conversation/client";
import { addReviewCommands } from "./review";
import { ReviewError } from "../review/client";
import { addFailureCommands } from "./failure";
import { FailureError } from "../failure/client";
import { addInboxCommand } from "./inbox";
import { addReportCommands } from "./report";
import { ReportError } from "../reports/input";
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
  .description(`Ultra-herdr machine CLI (protocol ${PROTOCOL_VERSION}). Cooperative stops/resumes, allowance extensions, typed questions/replies/nudges, authenticated receipt, history, worker reports and parent revisions, completion, feedback and failure are available; dispatch remains in development.`)
  .version(metadata.version)
  .showHelpAfterError();

addAuthCommands(program);
addRuntimeCommands(program);
addCatalogCommands(program);
addContextCommands(program);
addReceiveCommand(program);
addInboxCommand(program);
addHistoryCommands(program);
addReportCommands(program);
addFailureCommands(program);
addReviewCommands(program);
addReleaseCommands(program);
addOwnershipCommands(program);
addConversationCommands(program);
program.action(() => program.help());
try {
  await program.parseAsync();
} catch (error) {
  // Avoid backend exception bodies, validator inputs and tokens in CLI diagnostics.
  const message = (error instanceof ReleaseError || error instanceof CatalogError || error instanceof ReceiveError || error instanceof HistoryError || error instanceof ReportError || error instanceof FailureError || error instanceof ReviewError || error instanceof ConversationError) ? error.message : error instanceof ContextError ? `${error.code}: ${error.message}`
    : error instanceof Error && error.constructor === Error ? error.message
    : "Operation failed. Check command inputs and current authorization.";
  console.error(message);
  process.exitCode = 1;
}
