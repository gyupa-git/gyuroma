import type { UnfoldResult } from "./unfold";

/**
 * Talks to the unfold worker.  Only the newest patch matters: a newer request makes the older one's
 * answer be thrown away (the worker is restarted, so a long solve does not hold the new one up).
 */
export type UnfoldRequest = { id: number; positions: Float64Array; triangles: Int32Array; core: number; occluders: Float64Array; onCard: boolean };
export type UnfoldReply =
  | { id: number; kind: "progress"; done: number; total: number }
  | { id: number; kind: "done"; uv: Float32Array; piece: Int32Array; pieces: number; onCard: boolean }
  | { id: number; kind: "error"; message: string };

/** An unfold overtaken by a newer one. */
export class UnfoldSuperseded extends Error {}

let worker: Worker | null = null;
let nextId = 1;
let pending: { id: number; reject: (reason: unknown) => void } | null = null;

/**
 * The patch's faces (corners as local vertex ids into `positions`) unfolded, island by island; the first `core` are
 * the pick, the rest the faces round it (unfold.ts conformalAround, islandsOf); `occluders` the centres of faces near
 * it not laid out, that may lie over it.
 */
export function unfoldInWorker(positions: Float64Array, triangles: Int32Array, core: number, occluders: Float64Array, onProgress?: (share: number) => void, onCard = true): Promise<UnfoldResult> {
  // A solve still running for an older patch: stop it, its answer is not wanted.
  if (pending && worker) {
    worker.terminate();
    worker = null;
    pending.reject(new UnfoldSuperseded());
    pending = null;
  }
  worker ??= new Worker(new URL("./unfold.worker.ts", import.meta.url), { type: "module" });
  const id = nextId++;
  const current = worker;
  return new Promise<UnfoldResult>((resolve, reject) => {
    pending = { id, reject };
    current.onmessage = (event: MessageEvent<UnfoldReply>) => {
      const reply = event.data;
      if (reply.id !== id) return;
      if (reply.kind === "progress") {
        onProgress?.(reply.total > 0 ? reply.done / reply.total : 0);
        return;
      }
      pending = null;
      if (reply.kind === "done") resolve({ uv: reply.uv, piece: reply.piece, pieces: reply.pieces, onCard: reply.onCard });
      else reject(new Error(reply.message));
    };
    current.postMessage({ id, positions, triangles, core, occluders, onCard } satisfies UnfoldRequest, [positions.buffer, triangles.buffer, occluders.buffer]);
  });
}

/** No unfold wanted any more (the pick cleared, the map closed): a solve still running is stopped. */
export function cancelUnfold(): void {
  if (!pending || !worker) return;
  worker.terminate();
  worker = null;
  pending.reject(new UnfoldSuperseded());
  pending = null;
}
