import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { sendConversation, questionState, type ConversationOptions } from "../conversation/client";
import { addAutoRequestFileOption, addDocumentInputOptions, resolveDocumentInput, resolveRequestFile } from "./mutationOptions";

type ConversationCliOptions = ConversationOptions & { data?: string; dataFile?: string; requestFile?: string };

function conversationAction(kind: "question" | "reply" | "nudge", options: ConversationCliOptions) {
  const input = resolveDocumentInput(kind, options);
  const requestFile = resolveRequestFile(kind, options.requestFile);
  return sendConversation(kind, { ...options, input, requestFile });
}

export function addConversationCommands(program: Command) {
  const config = defaultMachineConfig();
  for (const [command, kind] of [["ask", "question"], ["reply", "reply"], ["nudge", "nudge"]] as const) {
    const cmd = program.command(command).description(kind === "question"
      ? "Send a typed task question; execution continues and expected-reply timing starts on receipt."
      : kind === "nudge" ? "Send an authorized update nudge; the original request cooldown and clocks remain in force."
      : "Send a correlated answer; only a current final reply resolves the response obligation.");
    addDocumentInputOptions(cmd, "Typed JSON input and brief slots; omit kind and requestId");
    addAutoRequestFileOption(cmd);
    cmd.option("--config <file>", "Protected machine profile", config)
      .action(async (options: ConversationCliOptions) => { console.log(JSON.stringify(await conversationAction(kind, options))); });
  }
  for (const [command, kind] of [["operator-reply", "reply"], ["operator-nudge", "nudge"]] as const) {
    const cmd = program.command(command).description(command === "operator-reply"
      ? "Answer an obligation transferred to the authenticated operator."
      : "Nudge an authorized message recipient without changing its clocks or cooldown.")
      .requiredOption("--operator-profile <file>", "Explicit operator profile");
    addDocumentInputOptions(cmd, "Typed input and slots; omit kind and requestId");
    addAutoRequestFileOption(cmd);
    cmd.action(async (options: ConversationCliOptions) => { console.log(JSON.stringify(await conversationAction(kind, options))); });
  }
  program.command("question-state").description("Inspect your question's response obligation without receiving content or changing clocks.")
    .requiredOption("--request <message-id>", "Immutable question message identity")
    .option("--config <file>", "Protected machine profile", config)
    .action(async (options: { config: string; request: string }) => { console.log(JSON.stringify(await questionState(options))); });
}
