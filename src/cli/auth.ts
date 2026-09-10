import type { Command } from "commander";
import { authApi } from "@ultra-herdr/api";
import { importOperator, issuePermit, operatorClient } from "../auth/operator";
import { registerMachine } from "../auth/registration";
import { clientFor, loadProfile } from "../auth/client";

function show(value: unknown) { console.log(JSON.stringify(value, null, 2)); }
export function addAuthCommands(program: Command) {
  const operator = program.command("operator").description("Use an explicitly selected operator profile");
  operator.command("import").description("Verify and save an operator profile")
    .requiredOption("--from <file>", "Protected operator artifact")
    .requiredOption("--output <file>", "New protected profile path")
    .action(async options => show(await importOperator(options.from, options.output)));
  operator.command("whoami").requiredOption("--profile <file>", "Protected operator profile")
    .action(async options => show(await (await operatorClient(options.profile)).query(authApi.operator, {})));
  operator.command("setup-key").description("Write a single-use machine setup or recovery key")
    .requiredOption("--profile <file>", "Protected operator profile")
    .requiredOption("--output <file>", "New protected key artifact")
    .option("--recover <machine-id>", "Recover the existing machine")
    .action(async options => show(await issuePermit(options.profile, options.output, options.recover)));
  operator.command("revoke-key").requiredOption("--profile <file>", "Protected operator profile")
    .requiredOption("--permit <id>", "Permit identifier")
    .action(async options => { await (await operatorClient(options.profile)).mutation(authApi.revokePermit, { permitId: options.permit }); show({ revoked: true }); });
  operator.command("revoke-machine").requiredOption("--profile <file>", "Protected operator profile")
    .requiredOption("--machine <id>", "Machine identifier")
    .action(async options => { await (await operatorClient(options.profile)).mutation(authApi.revokeMachine, { machineId: options.machine }); show({ revoked: true }); });
  const credentials = program.command("credentials").description("Manage machine credentials; system installation is not available yet");
  credentials.command("register").description("Save machine credentials only; does not install the system pane")
    .requiredOption("--config <file>", "Protected machine config path")
    .requiredOption("--deployment <url>", "Convex API deployment URL")
    .requiredOption("--key-file <file>", "Protected setup-key artifact or plain key file")
    .option("--name <name>", "Machine name for new registration")
    .option("--session <name>", "Herdr session for new registration (default: default)")
    .option("--recovery", "Recover existing identity using a machine-bound key")
    .action(async options => show(await registerMachine(options)));
  credentials.command("status").description("Check machine authentication; does not verify caller/session binding")
    .requiredOption("--config <file>", "Protected machine config path")
    .action(async options => show(await clientFor(await loadProfile(options.config, "machine")).query(authApi.machine, {})));
}
