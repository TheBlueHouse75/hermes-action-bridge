import { positiveInteger } from "./validation.js";

export interface ExecutionGate {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/** Reject excess direct MCP work immediately; asynchronous jobs use their own bounded queue. */
export function createExecutionGate(maxConcurrent: number = 4): ExecutionGate {
  const limit = positiveInteger(maxConcurrent, 4, "maxConcurrent");
  let active = 0;
  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (active >= limit) throw new Error(`Hermes direct execution limit reached (${limit})`);
      active += 1;
      try {
        return await operation();
      } finally {
        active -= 1;
      }
    },
  };
}
