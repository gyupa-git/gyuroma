/// <reference lib="webworker" />
/**
 * The colour map's "one patch in one piece" off the main thread: a large patch takes the solver
 * seconds, and the window must stay live meanwhile (unfold.ts).
 */
import { unfoldPatch } from "./unfold";
import type { UnfoldReply, UnfoldRequest } from "./unfoldClient";

const post = (reply: UnfoldReply, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(reply, transfer);

self.onmessage = (event: MessageEvent<UnfoldRequest>) => {
  const { id, positions, triangles } = event.data;
  try {
    let last = 0;
    // A big patch gets fewer solver steps: near enough to read, and it comes in seconds, not a minute.
    const out = unfoldPatch(positions, triangles, {
      maxIterations: triangles.length / 3 > 200_000 ? 1500 : 4000,
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - last < 150) return;
        last = now;
        post({ id, kind: "progress", done, total });
      },
    });
    post({ id, kind: "done", uv: out.uv, piece: out.piece, pieces: out.pieces }, [out.uv.buffer, out.piece.buffer]);
  } catch (error) {
    post({ id, kind: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
