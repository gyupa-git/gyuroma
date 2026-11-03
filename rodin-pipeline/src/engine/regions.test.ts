import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import { findRegions, regionFaces } from "./regions";

/** A square grid of cells, two triangles each, labelled by a function of the cell. */
function grid(n: number, labelOf: (x: number, y: number) => number) {
  const vertices: [number, number, number][] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) vertices.push([x, y, 0]);
  const triangles: [number, number, number][] = [];
  const labels: number[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x;
      triangles.push([a, a + 1, a + n + 1], [a + 1, a + n + 2, a + n + 1]);
      labels.push(labelOf(x, y), labelOf(x, y));
    }
  }
  return { adjacency: buildFaceAdjacency(triangles, vertices.length), labels: Int32Array.from(labels), area: new Float32Array(triangles.length).fill(1) };
}

const BODY = 0, EYE = 1, DOT = 2;

describe("findRegions", () => {
  // A 20×20 body, two 3×3 eyes, and specks of another colour: one cell each.
  const labelOf = (x: number, y: number): number => {
    if ((x >= 4 && x <= 6 && y >= 4 && y <= 6) || (x >= 13 && x <= 15 && y >= 4 && y <= 6)) return EYE;
    if ((x === 2 && y === 15) || (x === 17 && y === 17) || (x === 10 && y === 12)) return DOT;
    return BODY;
  };
  const g = grid(20, labelOf);

  it("numbers the patches biggest first, lists only those from the share asked, and counts the rest by colour", () => {
    // One cell = 2 of 800 faces = 0.25 % of the surface; an eye (9 cells) = 2.25 %.
    const map = findRegions(g.labels, g.adjacency, g.area, { minPct: 1 });
    expect(map.regions.map((r) => r.label)).toEqual([BODY, EYE, EYE]);
    expect(map.regions.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(map.regions[1].faces).toBe(18);
    expect(map.regions[1].areaPct).toBeCloseTo(2.25, 5);
    expect(map.patchCount).toBe(6);
    expect(map.unlisted).toEqual([{ label: DOT, patches: 3, faces: 6, tiny: 3 }]);
    // An eye is all body around; the body borders eyes and dots.
    expect(map.regions[1].borders).toEqual([{ label: BODY, share: 1 }]);
    expect(map.regions[0].borders.map((b) => b.label).sort()).toEqual([EYE, DOT]);
  });

  it("caps the list and maps the faces back", () => {
    const map = findRegions(g.labels, g.adjacency, g.area, { minPct: 0, max: 2 });
    expect(map.regions.length).toBe(2);
    const eye = regionFaces(map, [2]);
    expect(eye.length).toBe(18);
    for (const f of eye) expect(g.labels[f]).toBe(EYE);
    expect(regionFaces(map, [9, 0]).length).toBe(0);
    let unlisted = 0;
    for (const r of map.regionOf) if (r < 0) unlisted++;
    expect(unlisted).toBe(18 + 6);
  });
});
