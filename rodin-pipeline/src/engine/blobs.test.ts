import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import type { RGB, Tri, Vec3 } from "@core/types";
import { regionBlobs } from "./blobs";
import { creaseGeometry, faceConcavity } from "./creases";

function grid(w: number, h: number, colourOf: (x: number, y: number) => RGB) {
  const vertices: Vec3[] = [];
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) vertices.push([x, y, 0]);
  const triangles: Tri[] = [];
  const own: RGB[] = [];
  const cellXY: Array<[number, number]> = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = y * (w + 1) + x;
      triangles.push([a, a + 1, a + w + 1], [a + 1, a + w + 2, a + w + 1]);
      own.push(colourOf(x, y), colourOf(x, y));
      cellXY.push([x, y], [x, y]);
    }
  return { own, cellXY, adjacency: buildFaceAdjacency(triangles, vertices.length), area: new Float32Array(triangles.length).fill(1) };
}

describe("regionBlobs", () => {
  it("a ring and a lens of one family stay apart only where they differ; shading inside the ring is one blob", () => {
    // A dark-brown field; a tan disc (the rim) shaded from light to dark across x; a different, cooler disc in it (the lens).
    const g = grid(40, 40, (x, y) => {
      const d = Math.hypot(x - 20, y - 20);
      if (d < 6) return [70, 110, 190]; // the lens: blue, another family
      if (d < 14) {
        const t = (x - 6) / 28;
        return [Math.round(200 - 60 * t), Math.round(160 - 50 * t), Math.round(90 - 30 * t)]; // the rim, shaded
      }
      return [40, 22, 10];
    });
    const faces = Int32Array.from(g.own.keys());
    const map = regionBlobs(faces, g.own, g.area, g.adjacency, new Float32Array(g.own.length), { coarse: 3, fine: 12, max: 10 });
    const blobAt = (x: number, y: number) => map.blobOf[g.cellXY.findIndex(([cx, cy]) => cx === x && cy === y)];
    // Light and dark side of the rim: one blob; the lens and the field: blobs of their own.
    expect(blobAt(8, 20)).toBe(blobAt(32, 20));
    expect(blobAt(20, 20)).not.toBe(blobAt(8, 20));
    expect(blobAt(1, 1)).not.toBe(blobAt(8, 20));
    expect(map.blobs.length).toBeLessThanOrEqual(10);
    expect(map.blobs[0].id).toBe(1);
  });

  it("does not creep across a soft texture edge (white collar into skin)", () => {
    const white: RGB = [228, 226, 220];
    const skin: RGB = [166, 135, 102];
    const g = grid(40, 10, (x) => {
      const t = Math.max(0, Math.min(1, (x - 16) / 8)); // an 8-cell blur between them
      return [0, 1, 2].map((k) => Math.round(white[k] + (skin[k] - white[k]) * t)) as RGB;
    });
    const faces = Int32Array.from(g.own.keys());
    const map = regionBlobs(faces, g.own, g.area, g.adjacency, new Float32Array(g.own.length), { coarse: 4, fine: 24, max: 12 });
    const blobAt = (x: number, y: number) => map.blobOf[g.cellXY.findIndex(([cx, cy]) => cx === x && cy === y)];
    expect(blobAt(2, 5)).not.toBe(blobAt(37, 5));
  });

  it("keeps a gold trim apart from the grey-white plate it fades into (same lightness, more colour)", () => {
    const plate: RGB = [171, 161, 153];
    const trim: RGB = [183, 155, 111];
    const g = grid(40, 10, (x) => {
      const t = Math.max(0, Math.min(1, (x - 26) / 4)); // a 4-cell blur from the plate into the trim
      return [0, 1, 2].map((k) => Math.round(plate[k] + (trim[k] - plate[k]) * t)) as RGB;
    });
    const faces = Int32Array.from(g.own.keys());
    const map = regionBlobs(faces, g.own, g.area, g.adjacency, new Float32Array(g.own.length), { coarse: 4, fine: 24, max: 12 });
    const blobAt = (x: number, y: number) => map.blobOf[g.cellXY.findIndex(([cx, cy]) => cx === x && cy === y)];
    expect(blobAt(5, 5)).not.toBe(blobAt(37, 5));
  });

  it("cuts one colour at an inward fold (a lens sunk in its rim), not on a flat one", () => {
    // Rim at z = 0 up to x = 10, a steep wall down to the lens at z = -3 from x = 11; one tan all over.
    const w = 24, h = 8;
    const vertices: Vec3[] = [];
    for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) vertices.push([x, y, x <= 10 ? 0 : -3]);
    const triangles: Tri[] = [];
    const xs: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const a = y * (w + 1) + x;
        triangles.push([a, a + 1, a + w + 1], [a + 1, a + w + 2, a + w + 1]);
        xs.push(x, x);
      }
    const adjacency = buildFaceAdjacency(triangles, vertices.length);
    const geometry = creaseGeometry(vertices, triangles);
    const own: RGB[] = triangles.map(() => [186, 151, 97]);
    const area = new Float32Array(triangles.length).fill(1);
    const faces = Int32Array.from(own.keys());
    const at = (map: ReturnType<typeof regionBlobs>, x: number) => map.blobOf[xs.indexOf(x)];
    const cut = regionBlobs(faces, own, area, adjacency, faceConcavity(adjacency, geometry), { coarse: 3, fine: 6, max: 8, geometry });
    expect(at(cut, 3)).not.toBe(at(cut, 18));
    const flat = regionBlobs(faces, own, area, adjacency, new Float32Array(triangles.length), { coarse: 3, fine: 6, max: 8 });
    expect(at(flat, 3)).toBe(at(flat, 18));
  });
});
