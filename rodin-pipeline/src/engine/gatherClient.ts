import type { GatherPlan, GatherSource } from "./gather";

/** Talks to the 모아 뽑기 worker: one worker per job, gone when the job is. */
export type GatherRequest =
  | { kind: "read"; file: File }
  | { kind: "write"; files: File[]; sources: GatherSource[]; plan: GatherPlan; title: string; thumbnail: Uint8Array | null };

export type GatherReply =
  | { kind: "progress"; done: number; total: number }
  | { kind: "read"; source: GatherSource }
  | { kind: "write"; blob: Blob }
  | { kind: "error"; key: string; params: Record<string, string | number> };

/** A job that failed; `key` is an i18n key under gather.err. */
export class GatherJobError extends Error {
  constructor(
    readonly key: string,
    readonly params: Record<string, string | number>,
  ) {
    super(key);
  }
}

function run<T extends GatherReply["kind"]>(request: GatherRequest, want: T, onProgress?: (fraction: number) => void): Promise<Extract<GatherReply, { kind: T }>> {
  const worker = new Worker(new URL("./gather.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<GatherReply>) => {
      const reply = event.data;
      if (reply.kind === "progress") {
        onProgress?.(reply.total > 0 ? reply.done / reply.total : 0);
        return;
      }
      worker.terminate();
      if (reply.kind === "error") reject(new GatherJobError(reply.key, reply.params));
      else if (reply.kind === want) resolve(reply as Extract<GatherReply, { kind: T }>);
      else reject(new GatherJobError("unknown", { message: reply.kind }));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new GatherJobError("unknown", { message: event.message }));
    };
    worker.postMessage(request);
  });
}

export async function readInWorker(file: File, onProgress?: (fraction: number) => void): Promise<GatherSource> {
  return (await run({ kind: "read", file }, "read", onProgress)).source;
}

export async function writeInWorker(
  files: File[],
  sources: GatherSource[],
  plan: GatherPlan,
  title: string,
  thumbnail: Uint8Array | null,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  return (await run({ kind: "write", files, sources, plan, title, thumbnail }, "write", onProgress)).blob;
}
