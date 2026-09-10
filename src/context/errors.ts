export type ContextErrorCode = "MISSING_CONTEXT" | "UNKNOWN_CONTEXT" | "AMBIGUOUS_CONTEXT"
  | "CONFLICTING_CONTEXT" | "STALE_BINDING" | "UNSUPPORTED_CONTEXT" | "OPERATION_NOT_READY";

export class ContextError extends Error {
  constructor(readonly code: ContextErrorCode, message: string) { super(message); }
}
