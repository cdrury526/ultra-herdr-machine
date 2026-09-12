import type { Command } from "commander";
import { runSink } from "../sink/harness";

export function addSinkCommand(program: Command) {
  program.command("sink").description("Developer test harness: scripted agent that receives offers and follows a SINK plan (see scripts/sink in the cloud repo).")
    .option("--root <plan>", "Act as root manager: dispatch this plan file, then complete/release its submission")
    .option("--ignore-offers <count>", "Ignore the first N terminal offers (tests resend)", "0")
    .action(async (options: { root?: string; ignoreOffers: string }) => {
      const ignoreOffers = Number(options.ignoreOffers);
      if (!Number.isInteger(ignoreOffers) || ignoreOffers < 0) throw new Error("--ignore-offers must be a non-negative integer.");
      await runSink({ root: options.root, ignoreOffers });
    });
}
