import { useEffect, useState } from "react";
import { render, Box, Text, useInput } from "ink";
import { runAgent, type RuntimeStatus } from "../runtime/run";
export async function showAgent(directory: string) {
  const stop = new AbortController();
  const quit = () => stop.abort();
  process.on("SIGINT", quit); process.on("SIGTERM", quit);
  let publish: (s: RuntimeStatus) => void = () => undefined;
  function Agent() {
    const [status, setStatus] = useState<RuntimeStatus>({ machine: "loading", cloud: "connecting", auth: "pending", herdr: "verifying", state: "starting", commands: "unknown", operator: "unknown" });
    useEffect(() => { publish = setStatus; }, []);
    useInput(input => { if (input === "q") quit(); });
    return <Box flexDirection="column"><Text bold>ULTRA-HERDR</Text><Text>{status.machine}</Text>
      <Text>cloud     {status.cloud}</Text><Text>auth      {status.auth}</Text><Text>herdr     {status.herdr}</Text><Text>state     {status.state}</Text>
      <Text>commands  {status.commands}</Text><Text>operator  {status.operator}</Text>
      <Text dimColor>q: quit/offline · task completion retains worker panes</Text></Box>;
  }
  const ui = render(<Agent />, { exitOnCtrlC: false });
  try { await runAgent(directory, state => publish(state), stop.signal); }
  finally { ui.unmount(); process.off("SIGINT", quit); process.off("SIGTERM", quit); }
}
