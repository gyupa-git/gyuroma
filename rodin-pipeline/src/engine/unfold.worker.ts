/// <reference lib="webworker" />
/**
 * The colour map's "one patch in one piece" off the main thread: a large patch takes the solver
 * seconds, and the window must stay live meanwhile (unfold.ts).  The long solves go to the graphics
 * card when there is one (gpuSolve.ts, 11-05), else they run here as before.
 */
import { cardSolver } from "./gpuSolve";
import { cpuSolver, unfoldPatch, type Solver } from "./unfold";
import type { UnfoldReply, UnfoldRequest } from "./unfoldClient";

const post = (reply: UnfoldReply, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(reply, transfer);

/** Whether the last unfold's big solves ran on the graphics card. */
let onCard = false;
/** The solver, looked for once (the worker is made again for each patch overtaken, so once a patch). */
let solver: Promise<Solver> | null = null;
const solverReady = () =>
  (solver ??= cardSolver((used) => {
    onCard = onCard || used;
  })
    .then((s) => s ?? cpuSolver)
    .catch(() => cpuSolver));

self.onmessage = async (event: MessageEvent<UnfoldRequest>) => {
  const { id, positions, triangles, core, occluders, onCard: cardWanted } = event.data;
  try {
    let last = 0;
    onCard = false;
    // A big patch gets fewer solver steps: near enough to read, and it comes in seconds, not a minute.
    const out = await unfoldPatch(positions, triangles, {
      maxIterations: triangles.length / 3 > 200_000 ? 1500 : 4000,
      core,
      occluders,
      // ⚙ GPU off: the processor's solver (the same steps, slower on a big patch).
      solver: cardWanted === false ? cpuSolver : await solverReady(),
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - last < 150) return;
        last = now;
        post({ id, kind: "progress", done, total });
      },
    });
    post({ id, kind: "done", uv: out.uv, piece: out.piece, pieces: out.pieces, onCard }, [out.uv.buffer, out.piece.buffer]);
  } catch (error) {
    post({ id, kind: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
