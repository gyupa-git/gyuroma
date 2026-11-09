import type { Export3mfOptions, Export3mfSummary } from "@core/export3mf";
import type { MeshModel, RGB } from "@core/types";

/**
 * Talks to the 3MF export worker (export.worker.ts): the model goes over as flat arrays (moved, so the main thread
 * only spends the time to lay them out — a fraction of a second on 4.6M faces), the writing and compressing happen
 * there, and the file comes back as a Blob. One export at a time; a new worker each time, ended when it is done
 * (an export is rare and holds a lot of memory while it runs).
 */
export type ExportOptions = Omit<Export3mfOptions, "model" | "adjustedColors" | "onProgress" | "thumbnailEncoder">;
export type ExportRequest = { id: number; name: string; positions: Float64Array; corners: Int32Array; colours: Uint8Array; options: ExportOptions };
export type ExportReply =
  | { id: number; kind: "progress"; fraction: number }
  | { id: number; kind: "done"; blob: Blob; fileName: string; summary: Export3mfSummary }
  | { id: number; kind: "error"; message: string };

let nextId = 1;

/** The worker could not run the export at all (not started, or something could not be sent): write it here instead. */
export class ExportWorkerUnavailable extends Error {}

/** Whether this browser can run the export in a worker (module workers). */
export function canExportInWorker(): boolean {
  return typeof Worker !== "undefined";
}

export function exportInWorker(
  model: MeshModel,
  adjustedColors: RGB[],
  options: ExportOptions,
  onProgress: (fraction: number) => void,
): Promise<{ blob: Blob; fileName: string; summary: Export3mfSummary }> {
  const positions = new Float64Array(model.vertices.length * 3);
  for (let i = 0; i < model.vertices.length; i++) {
    const v = model.vertices[i];
    positions[i * 3] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
  }
  const corners = new Int32Array(model.triangles.length * 3);
  for (let f = 0; f < model.triangles.length; f++) {
    const t = model.triangles[f];
    corners[f * 3] = t[0];
    corners[f * 3 + 1] = t[1];
    corners[f * 3 + 2] = t[2];
  }
  const colours = new Uint8Array(adjustedColors.length * 3);
  for (let f = 0; f < adjustedColors.length; f++) {
    const c = adjustedColors[f];
    colours[f * 3] = c[0];
    colours[f * 3 + 1] = c[1];
    colours[f * 3 + 2] = c[2];
  }
  const worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const end = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<ExportReply>) => {
      const reply = event.data;
      if (reply.id !== id) return;
      if (reply.kind === "progress") {
        onProgress(reply.fraction);
        return;
      }
      end();
      if (reply.kind === "done") resolve({ blob: reply.blob, fileName: reply.fileName, summary: reply.summary });
      else reject(new Error(reply.message));
    };
    worker.onerror = (event) => {
      end();
      reject(new ExportWorkerUnavailable(event.message || "export worker failed"));
    };
    try {
      worker.postMessage({ id, name: model.name, positions, corners, colours, options } satisfies ExportRequest, [positions.buffer, corners.buffer, colours.buffer]);
    } catch (error) {
      // Something in the options could not be sent (it would be a function or the like): the caller writes it here.
      end();
      reject(new ExportWorkerUnavailable(error instanceof Error ? error.message : String(error)));
    }
  });
}
