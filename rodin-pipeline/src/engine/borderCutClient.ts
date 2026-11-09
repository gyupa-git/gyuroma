import type { BorderCut } from "@core/borderCut";
import type { MeshModel } from "@core/types";

/**
 * Talks to the border-cut worker.  The model goes over once (and again only
 * for another model); a cut request carries just the face groups.  Only the
 * newest request matters: one still waiting is dropped when a newer one comes
 * (the worker is never stopped — it holds the model).
 */
export type CutRequest =
  | { type: "model"; modelId: number; positions: Float64Array; corners: Int32Array }
  | { type: "forget" }
  | { type: "cut"; id: number; modelId: number; groups: Int32Array; protectedGroup: Uint8Array; span: number; settled?: Int32Array; cutFaces?: Uint8Array };

export type CutReply = { id: number; cut: BorderCut } | { id: number; error: string };

/** A request overtaken by a newer one before the worker got to it. */
export class CutSuperseded extends Error {}

interface Pending {
  request: Extract<CutRequest, { type: "cut" }>;
  resolve: (cut: BorderCut) => void;
  reject: (reason: unknown) => void;
}

let worker: Worker | null = null;
/**
 * The model the worker holds, known by its triangles — held weakly: a strong hold kept the last model's 4.6M face
 * triples (~185MB) alive after another model was opened (11-09).
 */
let sentModel: { triangles: WeakRef<MeshModel["triangles"]>; id: number } | null = null;
let nextModelId = 1;
let nextId = 1;
/** Who asks: the result view's preview, or an export — each newer request replaces only its own kind waiting. */
export type CutAsker = "preview" | "export";
/** The request the worker is working on, and the ones waiting (one per asker). */
let running: Pending | null = null;
const waiting = new Map<CutAsker, Pending>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./borderCut.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<CutReply>) => {
    const done = running;
    running = null;
    if (done && done.request.id === event.data.id) {
      if ("cut" in event.data) done.resolve(event.data.cut);
      else done.reject(new Error(event.data.error));
    }
    // (A request given up by forgetCutModel has no-op handlers: its answer is dropped here.)
    sendNext();
  };
  return worker;
}

function sendNext(): void {
  if (running || !worker) return;
  // An export first: someone is waiting for the file.
  const asker: CutAsker | undefined = waiting.has("export") ? "export" : waiting.has("preview") ? "preview" : undefined;
  if (!asker) return;
  running = waiting.get(asker) as Pending;
  waiting.delete(asker);
  worker.postMessage(running.request);
}

/**
 * The faces of `model` cut along the borders between `groups` (one per face).
 * `settled`: each face's group when the model was last cut (confirmed) — a
 * border then is the line already and is not cut again.  `cutFaces`: 1 for
 * the faces the confirmed cuts made — the cut line itself, final (only teeth
 * a cut left as they were are drawn afresh).
 */
export function cutBorders(
  model: MeshModel,
  groups: Int32Array,
  protectedGroup: Uint8Array,
  span: number,
  settled?: Int32Array,
  asker: CutAsker = "preview",
  cutFaces?: Uint8Array,
): Promise<BorderCut> {
  const w = ensureWorker();
  if (!sentModel || sentModel.triangles.deref() !== model.triangles) {
    const positions = new Float64Array(model.vertices.length * 3);
    model.vertices.forEach((v, i) => positions.set(v, i * 3));
    const corners = new Int32Array(model.triangles.length * 3);
    model.triangles.forEach((t, i) => corners.set(t, i * 3));
    sentModel = { triangles: new WeakRef(model.triangles), id: nextModelId++ };
    w.postMessage({ type: "model", modelId: sentModel.id, positions, corners } satisfies CutRequest, [positions.buffer, corners.buffer]);
  }
  const request: Pending["request"] = { type: "cut", id: nextId++, modelId: sentModel.id, groups: groups.slice(), protectedGroup: protectedGroup.slice(), span, settled, cutFaces };
  return new Promise<BorderCut>((resolve, reject) => {
    waiting.get(asker)?.reject(new CutSuperseded());
    waiting.set(asker, { request, resolve, reject });
    sendNext();
  });
}

/**
 * A new model or a new start: the worker lets go of the last model (its flat copy and edge table, ~186MB on 4.6M
 * faces) and nothing waits on it — the waiting requests are given up; the running one finishes in the worker
 * (stopping it would leave its caller waiting forever) but its answer is not used.
 */
export function forgetCutModel(): void {
  for (const pending of waiting.values()) pending.reject(new CutSuperseded());
  waiting.clear();
  if (running) {
    const given = running;
    given.reject(new CutSuperseded());
    given.resolve = () => {};
    given.reject = () => {};
  }
  sentModel = null;
  worker?.postMessage({ type: "forget" } satisfies CutRequest);
}
