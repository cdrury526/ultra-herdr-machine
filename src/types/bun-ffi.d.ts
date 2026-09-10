/** Narrow declaration for the Bun 1.4.2 FFI calls used by Linux locking and socket verification. */
declare module "bun:ffi" {
  export const FFIType: { i32: number; ptr: number; u64: number };
  export function ptr(value: ArrayBufferView): number;
  export function dlopen(path: string, definitions: Record<string, { args: number[]; returns: number }>): {
    symbols: Record<string, (...args: number[]) => number>;
    close(): void;
  };
}
