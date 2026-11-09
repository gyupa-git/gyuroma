import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import type { Tri, Vec3 } from "@core/types";
import { facesAround } from "./surround";

/** A flat w×w grid of unit squares, two triangles each, and the faces' centres. */
function grid(w: number) {
  const vertices: Vec3[] = [];
  for (let j = 0; j <= w; j++) for (let i = 0; i <= w; i++) vertices.push([i, j, 0]);
  const triangles: Tri[] = [];
  for (let j = 0; j < w; j++)
    for (let i = 0; i < w; i++) {
      const a = j * (w + 1) + i;
      triangles.push([a, a + 1, a + w + 2], [a, a + w + 2, a + w + 1]);
    }
  const centroids = new Float32Array(triangles.length * 3);
  triangles.forEach((tri, f) => {
    for (let d = 0; d < 3; d++) centroids[f * 3 + d] = (vertices[tri[0]][d] + vertices[tri[1]][d] + vertices[tri[2]][d]) / 3;
  });
  return { adjacency: buildFaceAdjacency(triangles, vertices.length), centroids, at: (i: number, j: number) => (j * w + i) * 2 };
}

describe("facesAround", () => {
  it("brings the pick and a band round it, out to the reach over the surface", () => {
    const { adjacency, centroids, at } = grid(20);
    const picked = [at(10, 10), at(10, 10) + 1];
    const out = facesAround(adjacency, centroids, picked, 3, Infinity);
    expect([...out.slice(0, 2)]).toEqual(picked);
    const got = new Set(out);
    // Two squares away comes, six away does not.
    expect(got.has(at(12, 10))).toBe(true);
    expect(got.has(at(16, 10))).toBe(false);
    for (const f of out) expect(Math.hypot(centroids[f * 3] - 10.5, centroids[f * 3 + 1] - 10.5)).toBeLessThan(4.5);
  });

  it("keeps the nearest when there are more than it may bring", () => {
    const { adjacency, centroids, at } = grid(20);
    const picked = [at(10, 10)];
    const out = facesAround(adjacency, centroids, picked, 100, 30);
    expect(out.length).toBe(30);
    expect(out[0]).toBe(picked[0]);
    for (const f of out) expect(Math.hypot(centroids[f * 3] - 10.67, centroids[f * 3 + 1] - 10.33)).toBeLessThan(4);
  });
});
