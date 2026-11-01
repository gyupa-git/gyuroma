import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import { cutAlongBorderLines } from "@core/borderCut";
import type { MeshModel, Tri, Vec3 } from "@core/types";
import { highlightGeometry, highlightGeometryCut } from "./mesh";

/** A w×h grid of squares, two triangles each; face (i, j, k) = (j·w + i)·2 + k. */
function grid(w: number, h: number): MeshModel {
  const vertices: Vec3[] = [];
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) vertices.push([i, j, 0]);
  const v = (i: number, j: number) => j * (w + 1) + i;
  const triangles: Tri[] = [];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) triangles.push([v(i, j), v(i + 1, j), v(i + 1, j + 1)], [v(i, j), v(i + 1, j + 1), v(i, j + 1)]);
  return { name: "grid", vertices, triangles, triangleColors: triangles.map(() => [0, 0, 0]), stats: { vertexCount: vertices.length, triangleCount: triangles.length, coloredVertexCount: 0, uniqueFaceColors: 1, objectFaceCounts: {} } };
}

describe("highlightGeometryCut", () => {
  it("outlines a colour along the cut line, as the colours are drawn", () => {
    const w = 24;
    const h = 10;
    const model = grid(w, h);
    // Group 0 below a staircase (a row up every 4 columns): the line is y = 1.5 + x / 4.
    const labels = Int32Array.from(model.triangles, (t) => {
      const [x, y] = [0, 1].map((c) => t.reduce((s, v) => s + model.vertices[v][c], 0) / 3);
      return y < 2 + Math.floor(x / 4) ? 0 : 1;
    });
    const cut = cutAlongBorderLines(buildFaceAdjacency(model.triangles, model.vertices.length), model.triangles, model.vertices, labels, { span: 14, protectedGroup: new Uint8Array(2) });
    expect(cut.replaced.length).toBeGreaterThan(0);
    const mask = Uint8Array.from(labels, (l) => (l === 0 ? 1 : 0));
    const plain = highlightGeometry(model, mask);
    const along = highlightGeometryCut(model, mask, cut, labels);
    // Every outline point inside the grid lies on the line now (the plain outline is the staircase).
    const off = (edges: Float32Array) => {
      let worst = 0;
      for (let o = 0; o < edges.length; o += 3) {
        const [x, y] = [edges[o], edges[o + 1]];
        if (x < 4 || x > w - 4 || y <= 0 || y >= h) continue;
        worst = Math.max(worst, Math.abs(y - (1.5 + x / 4)));
      }
      return worst;
    };
    expect(off(plain.edges)).toBeGreaterThan(0.4);
    expect(off(along.edges)).toBeLessThan(0.35);
    // The region's area: the cut colour's own, not the faces'.
    const area = (fill: Float32Array) => {
      let sum = 0;
      for (let o = 0; o < fill.length; o += 9) sum += Math.abs((fill[o + 3] - fill[o]) * (fill[o + 7] - fill[o + 1]) - (fill[o + 4] - fill[o + 1]) * (fill[o + 6] - fill[o])) / 2;
      return sum;
    };
    let truth = 0;
    for (let x = 0; x < w; x++) truth += Math.min(h, 1.5 + (x + 0.5) / 4); // the area under the line, column by column
    expect(Math.abs(area(along.fill) - truth)).toBeLessThan(Math.abs(area(plain.fill) - truth) + 1);
  });
});
