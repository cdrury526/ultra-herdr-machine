import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { sendConversation, questionState, type ConversationOptions } from "../conversation/client";
export function addConversationCommands(program: Command) {
  const config = join(homedir(), ".config", "ultra-herdr", "machine.json");
  for (const [command, kind] of [["ask", "question"], ["reply", "reply"], ["nudge", "nudge"]] as const) {
    program.command(command).description(kind === "question"
      ? "Send a typed task question; execution continues and expected-reply timing starts on receipt."
      : kind === "nudge" ? "Send an authorized update nudge; the original request cooldown and clocks remain in force."
      : "Send a correlated answer; only a current final reply resolves the response obligation.")
      .requiredOption("--input <file>", "Typed JSON input and brief slots; omit kind and requestId")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries")
      .option("--config <file>", "Protected machine profile", config)
      .action(async (options: ConversationOptions) => { console.log(JSON.stringify(await sendConversation(kind, options))); });
  }
  program.command("operator-reply").description("Answer an obligation transferred to the authenticated operator.")
    .requiredOption("--operator-profile <file>", "Explicit operator profile with current response authority")
    .requiredOption("--input <file>", "Typed reply input and slots; omit kind and requestId")
    .requiredOption("--request-file <file>", "Protected journal; reuse for unchanged retries")
    .action(async (options: ConversationOptions) => { console.log(JSON.stringify(await sendConversation("reply", options))); });
  program.command("operator-nudge").description("Nudge an authorized message recipient without changing its clocks or cooldown.")
    .requiredOption("--operator-profile <file>", "Explicit operator profile with task participation")
    .requiredOption("--input <file>", "Typed nudge input and slots; omit kind and requestId")
    .requiredOption("--request-file <file>", "Protected journal; reuse for unchanged retries")
    .action(async (options: ConversationOptions) => { console.log(JSON.stringify(await sendConversation("nudge", options))); });
  program.command("question-state").description("Inspect your question's response obligation without receiving content or changing clocks.")
    .requiredOption("--request <message-id>", "Immutable question message identity")
    .option("--config <file>", "Protected machine profile", config)
    .action(async (options: { config: string; request: string }) => { console.log(JSON.stringify(await questionState(options))); });
}
