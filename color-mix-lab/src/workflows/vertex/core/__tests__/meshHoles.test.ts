import { describe, expect, it } from "vitest";
import { fillSmallHoles } from "../meshHoles";
import type { Tri, Vec3 } from "../types";

/** A unit cube, outward-facing, optionally without its top two triangles. */
function cube(openTop: boolean): { vertices: Vec3[]; triangles: Tri[] } {
  const vertices: Vec3[] = [];
  for (const z of [0, 1]) for (const y of [0, 1]) for (const x of [0, 1]) vertices.push([x, y, z]);
  const all: Tri[] = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];
  return { vertices, triangles: openTop ? all.filter((_t, i) => i !== 2 && i !== 3) : all };
}

function openEdges(triangles: Tri[]): number {
  const count = new Map<string, number>();
  for (const t of triangles) for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...count.values()].filter((n) => n === 1).length;
}

function signedVolume(vertices: Vec3[], triangles: Tri[]): number {
  let v = 0;
  for (const [a, b, c] of triangles) {
    const A = vertices[a], B = vertices[b], C = vertices[c];
    v += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
  }
  return v;
}

describe("fillSmallHoles", () => {
  it("closes a small hole with faces wound like their neighbours", () => {
    const { vertices, triangles } = cube(true);
    expect(openEdges(triangles)).toBe(4);
    const fill = fillSmallHoles(vertices, triangles, { maxPerimeterRatio: 5 });
    expect(fill.filled).toBe(1);
    expect(fill.vertices.length).toBe(1);
    expect(fill.triangles.length).toBe(4);
    const allV = [...vertices, ...fill.vertices];
    const allT = [...triangles, ...fill.triangles];
    expect(openEdges(allT)).toBe(0);
    // The same way out as the rest of the cube: the whole volume, positive.
    expect(signedVolume(allV, allT)).toBeCloseTo(1, 6);
    // Each new face borders an existing face of the rim.
    for (const f of fill.borders) expect(f).toBeGreaterThanOrEqual(0);
  });

  it("leaves an opening bigger than the limit, and a closed mesh, alone", () => {
    const open = cube(true);
    const big = fillSmallHoles(open.vertices, open.triangles, { maxPerimeterRatio: 0.5 });
    expect(big.filled).toBe(0);
    expect(big.left).toBe(1);
    const closed = cube(false);
    const none = fillSmallHoles(closed.vertices, closed.triangles);
    expect(none.filled + none.left).toBe(0);
    expect(none.triangles.length).toBe(0);
  });
});
