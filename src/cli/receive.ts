import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { receiveTicket, receiveDelivery } from "../receive/client";
export function addReceiveCommand(program: Command) {
  program.command("receive").description("Verify a ticketed message, save it privately and confirm receipt.")
    .option("--ticket <ticket>", "Opaque message ticket")
    .option("--delivery <reference>", "Delivery reference from inbox; requires --generation")
    .option("--generation <number>", "Delivery generation from inbox")
    .option("--config <file>", "Protected machine credential configuration", defaultMachineConfig())
    .action(async (options: { ticket?: string; delivery?: string; generation?: string; config: string }) => {
      if (Boolean(options.ticket) === Boolean(options.delivery) || (options.ticket && options.generation !== undefined) ||
          (options.delivery && (!options.generation || !/^[1-9][0-9]*$/.test(options.generation) || !Number.isSafeInteger(Number(options.generation)))))
        throw new Error("Use --ticket, or use --delivery with --generation from inbox.");
      console.log(JSON.stringify(options.ticket ? await receiveTicket(options.config, options.ticket)
        : await receiveDelivery(options.config, options.delivery!, Number(options.generation))));
    });
}
