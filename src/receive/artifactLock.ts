import { resolve } from "node:path";
import { withCredentialLock } from "../auth/storage";
/** Stable sibling lock shared by cleanup, history saving and receipt transactions.
 * Kept outside the artifact directory so cleanup can never select the lock itself. */
export function withArtifactLock<T>(directory: string, operation: () => Promise<T>) {
  return withCredentialLock(`${resolve(directory)}.artifacts`, async () => operation());
}
