import { render } from "ink";
import { PROTOCOL_VERSION } from "@ultra-herdr/api";
import { StatusLine } from "../src/agent/ui";

const app = render(<StatusLine message={`Ink compile check: protocol ${PROTOCOL_VERSION}`} />, {
  exitOnCtrlC: false,
  patchConsole: false,
});
await new Promise((resolve) => setTimeout(resolve, 50));
app.unmount();
await app.waitUntilExit();
