import type { Command } from "commander";
import { readOperatorInbox, readOperatorEscalations, receiveOperator } from "../receive/operator";
export function addOperatorInboxCommands(operator: Command) {
  operator.command("inbox").description("List one page of this operator's pending delivery metadata")
    .requiredOption("--profile <file>", "Protected operator profile")
    .option("--cursor <cursor>", "Continue a previous page")
    .option("--limit <count>", "Page size up to the deployment bound")
    .action(async options => console.log(JSON.stringify(await readOperatorInbox(options))));
  operator.command("escalations").description("List pending and unresolved review escalations, including received messages")
    .requiredOption("--profile <file>", "Protected operator profile")
    .option("--cursor <cursor>", "Continue a previous page")
    .option("--limit <count>", "Page size up to the deployment bound")
    .action(async options => console.log(JSON.stringify(await readOperatorEscalations(options))));
  operator.command("receive").description("Verify an addressed escalation, save it privately and confirm receipt")
    .requiredOption("--profile <file>", "Protected operator profile")
    .option("--ticket <ticket>", "Opaque message ticket")
    .option("--delivery <reference>", "Delivery reference from operator inbox")
    .option("--generation <number>", "Delivery generation from inbox")
    .action(async (options: { profile: string; ticket?: string; delivery?: string; generation?: string }) => {
      if (Boolean(options.ticket) === Boolean(options.delivery) || (options.ticket && options.generation !== undefined) ||
          (options.delivery && (!options.generation || !/^[1-9][0-9]*$/.test(options.generation) || !Number.isSafeInteger(Number(options.generation)))))
        throw new Error("Use --ticket, or --delivery with --generation from operator inbox.");
      console.log(JSON.stringify(await receiveOperator(options.profile, options.ticket ?? { deliveryId: options.delivery!, generation: Number(options.generation) })));
    });
}
