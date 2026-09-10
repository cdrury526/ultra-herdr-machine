import { Text } from "ink";

/** Presentation only; runtime ownership and orchestration are added in their phases. */
export function StatusLine({ message }: { message: string }) {
  return <Text>{message}</Text>;
}
