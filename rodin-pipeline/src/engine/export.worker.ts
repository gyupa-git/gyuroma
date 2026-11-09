/// <reference lib="webworker" />
/**
 * The 3MF written off the main thread (11-09): on 4.6M faces writing and compressing took 17–20 s, the window frozen
 * all along. The model comes as flat arrays (moved, not copied) and is stood up again here as the core writer wants
 * it; the colours as three bytes a face, the same colour arrays shared again. What comes out is the writer's own
 * output: buildPrusa3mfBlob is the same function the main thread ran.
 */
import { buildPrusa3mfBlob } from "@core/export3mf";
import type { MeshModel, RGB, Tri, Vec3 } from "@core/types";
import type { ExportReply, ExportRequest } from "./exportClient";

const post = (reply: ExportReply) => (self as DedicatedWorkerGlobalScope).postMessage(reply);

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  const { id, name, positions, corners, colours, options } = event.data;
  try {
    const vertexCount = positions.length / 3;
    const vertices: Vec3[] = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) vertices[i] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const faceCount = corners.length / 3;
    const triangles: Tri[] = new Array(faceCount);
    for (let f = 0; f < faceCount; f++) triangles[f] = [corners[f * 3], corners[f * 3 + 1], corners[f * 3 + 2]];
    // One array per colour, as on the main thread (rgbPool): millions of faces, a few hundred colours.
    const shared = new Map<number, RGB>();
    const adjusted: RGB[] = new Array(faceCount);
    for (let f = 0; f < faceCount; f++) {
      const r = colours[f * 3];
      const g = colours[f * 3 + 1];
      const b = colours[f * 3 + 2];
      const key = (r << 16) | (g << 8) | b;
      let rgb = shared.get(key);
      if (!rgb) {
        rgb = [r, g, b];
        shared.set(key, rgb);
      }
      adjusted[f] = rgb;
    }
    const model: MeshModel = {
      name,
      vertices,
      triangles,
      // The writer reads the face colours only as a fallback after `adjustedColors` (and checks the two lengths).
      triangleColors: adjusted,
      stats: { vertexCount, triangleCount: faceCount, coloredVertexCount: 0, uniqueFaceColors: shared.size, objectFaceCounts: {} },
    };
    let last = 0;
    const result = await buildPrusa3mfBlob({
      ...options,
      model,
      adjustedColors: adjusted,
      onProgress: (fraction) => {
        const now = Date.now();
        if (now - last < 120 && fraction < 1) return;
        last = now;
        post({ id, kind: "progress", fraction });
      },
    });
    post({ id, kind: "done", blob: result.blob, fileName: result.fileName, summary: result.summary });
  } catch (error) {
    post({ id, kind: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
