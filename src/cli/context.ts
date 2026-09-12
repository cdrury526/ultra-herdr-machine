import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { resolveCaller } from "../context/resolve";
import { readTaskContext } from "../task/context";

function requireExclusiveAnchor(options: { task?: string; ticket?: string; delivery?: string; generation?: string }) {
  const modes = [options.task, options.ticket, options.delivery].filter(Boolean).length;
  if (modes !== 1) throw new Error("Use exactly one of --task, --ticket, or --delivery with --generation.");
  if (options.delivery && (!options.generation || !/^[1-9][0-9]*$/.test(options.generation)))
    throw new Error("--delivery requires --generation from inbox metadata.");
}

export function addContextCommands(program: Command) {
  const config = defaultMachineConfig();
  program.command("whoami").description("Resolve this caller's verified product session.")
    .option("--config <file>", "Protected machine credential configuration", config)
    .action(async (options: { config: string }) => { console.log(JSON.stringify(await resolveCaller(options.config))); });
  program.command("context").description("Read authorized task context from a ticket, delivery reference, or task id.")
    .option("--task <id>", "Task identity")
    .option("--ticket <ticket>", "Opaque delivery ticket")
    .option("--delivery <reference>", "Inbox delivery reference; requires --generation")
    .option("--generation <number>", "Delivery generation from inbox")
    .option("--child-limit <count>", "Page size within the deployment processing bound; default uses the bound")
    .option("--config <file>", "Protected machine profile", config)
    .action(async (options: { config: string; task?: string; ticket?: string; delivery?: string; generation?: string; childLimit?: string }) => {
      requireExclusiveAnchor(options);
      const childLimit = options.childLimit !== undefined ? Number(options.childLimit) : undefined;
      if (childLimit !== undefined && (!Number.isFinite(childLimit) || childLimit < 1 || !Number.isInteger(childLimit)))
        throw new Error("--child-limit must be a positive integer within the deployment processing bound.");
      console.log(JSON.stringify(await readTaskContext({ config: options.config, task: options.task, ticket: options.ticket,
        delivery: options.delivery, generation: options.generation ? Number(options.generation) : undefined, childLimit })));
    });
}
