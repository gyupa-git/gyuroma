import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import type { Tri, Vec3 } from "@core/types";
import { cellParts, faceCentroids, facePartsOf, shapeCells, summariseParts, tidyByParts } from "./shapeParts";

/** A grid of w×h cells, two triangles each, on the plane; `gap` columns are left out (two pieces). */
function grid(w: number, h: number, gapAt = -1) {
  const vertices: Vec3[] = [];
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) vertices.push([x, y, 0]);
  const triangles: Tri[] = [];
  const cellXY: Array<[number, number]> = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x === gapAt) continue;
      const a = y * (w + 1) + x;
      triangles.push([a, a + 1, a + w + 1], [a + 1, a + w + 2, a + w + 1]);
      cellXY.push([x, y], [x, y]);
    }
  return { vertices, triangles, cellXY, adjacency: buildFaceAdjacency(triangles, vertices.length), area: new Float32Array(triangles.length).fill(1) };
}

describe("shapeCells", () => {
  it("cuts the surface into the cells asked for, each joined, and the same every time", () => {
    const g = grid(30, 30);
    const centroids = faceCentroids(g.vertices, g.triangles);
    const a = shapeCells(centroids, g.adjacency, g.area, 9);
    const b = shapeCells(centroids, g.adjacency, g.area, 9);
    expect(a.count).toBe(9);
    expect(Array.from(a.cellOf)).toEqual(Array.from(b.cellOf));
    // Every cell holds faces, about a ninth of the surface each.
    for (let c = 0; c < 9; c++) expect(a.areaPct[c]).toBeGreaterThan(4);
    // A cell is one piece: walking over the faces of one cell reaches all of them.
    for (let c = 0; c < 9; c++) {
      const faces = [...a.cellOf.keys()].filter((f) => a.cellOf[f] === c);
      const seen = new Set([faces[0]]);
      const stack = [faces[0]];
      while (stack.length) {
        const f = stack.pop() as number;
        for (let i = g.adjacency.offsets[f]; i < g.adjacency.offsets[f + 1]; i++) {
          const n = g.adjacency.neighbours[i];
          if (a.cellOf[n] === c && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      expect(seen.size).toBe(faces.length);
    }
    expect([...a.touching[0].keys()].length).toBeGreaterThan(0);
  });

  it("does not let a cell jump a gap: two pieces side by side keep cells of their own", () => {
    const g = grid(21, 10, 10);
    const a = shapeCells(faceCentroids(g.vertices, g.triangles), g.adjacency, g.area, 6);
    const left = new Set<number>();
    const right = new Set<number>();
    g.cellXY.forEach(([x], f) => (x < 10 ? left : right).add(a.cellOf[f]));
    for (const c of left) expect(right.has(c)).toBe(false);
  });
});

describe("parts", () => {
  // Left half the face (cells named), right half the arm; a cell not named goes to the part it touches.
  const g = grid(20, 10);
  const cells = shapeCells(faceCentroids(g.vertices, g.triangles), g.adjacency, g.area, 8);
  const sideOf = (c: number) => {
    let left = 0;
    let all = 0;
    g.cellXY.forEach(([x], f) => {
      if (cells.cellOf[f] !== c) return;
      all++;
      if (x < 10) left++;
    });
    return left * 2 > all ? "face" : "arm";
  };
  const faceCells = [...Array(cells.count).keys()].filter((c) => sideOf(c) === "face");
  const armCells = [...Array(cells.count).keys()].filter((c) => sideOf(c) === "arm");

  it("fills in the cells not named from their neighbours", () => {
    const named = [
      { name: "얼굴", cells: faceCells },
      { name: "팔", cells: armCells.slice(0, 1) },
    ];
    const partOfCell = cellParts(cells, named);
    for (const c of faceCells) expect(partOfCell[c]).toBe(0);
    for (let c = 0; c < cells.count; c++) expect(partOfCell[c]).toBeGreaterThanOrEqual(0);
  });

  it("one colour per part: shading goes to the main colour, details stay, a neighbour's colour on the edge stays", () => {
    const SKIN = 0, SHADE = 1, EYE = 2, SLEEVE = 3;
    const labels = new Int32Array(g.triangles.length);
    g.cellXY.forEach(([x, y], f) => {
      labels[f] = x < 10 ? (x === 3 && y === 3 ? EYE : x >= 5 && x <= 6 ? SHADE : SKIN) : SLEEVE;
    });
    // A little of the sleeve colour reaches into the face side, along the edge.
    g.cellXY.forEach(([x], f) => {
      if (x === 9) labels[f] = SLEEVE;
    });
    const partOfCell = cellParts(cells, [
      { name: "얼굴", cells: faceCells },
      { name: "팔", cells: armCells },
    ]);
    const partOfFace = facePartsOf(cells, partOfCell);
    const summary = summariseParts(partOfFace, 2, labels, 4, g.area);
    expect(summary[0].colours[0].label).toBe(SKIN);
    expect(summary[1].colours[0].label).toBe(SLEEVE);
    const out = tidyByParts(partOfFace, cells, partOfCell, labels, [
      { part: 0, main: SKIN, keep: [EYE] },
      { part: 1, main: SLEEVE, keep: [] },
    ], { protectedLabels: null, near: () => null });
    const changed = new Map<number, number>();
    out.faces.forEach((f, i) => changed.set(f, out.to[i]));
    g.cellXY.forEach(([x, y], f) => {
      if (labels[f] === SHADE) expect(changed.get(f)).toBe(SKIN);
      if (x === 3 && y === 3) expect(changed.has(f)).toBe(false);
      // The sleeve colour on the face's edge (cells touching the arm) is left alone.
      if (x === 9 && partOfFace[f] === 0) expect(changed.has(f)).toBe(false);
    });
  });
});

describe("tidyByParts: a detail inside a detail", () => {
  it("keeps dark eye holes inside a white button, takes the brown shading round it", () => {
    const BODY = 0, WHITE = 1, DARK = 2, SHADE = 3;
    const g = grid(20, 20);
    const cells = shapeCells(faceCentroids(g.vertices, g.triangles), g.adjacency, g.area, 4);
    const labels = new Int32Array(g.triangles.length);
    g.cellXY.forEach(([x, y], f) => {
      // A white 5×5 button with a dark 1×1 eye hole, and a shade patch in the body.
      labels[f] = x >= 8 && x <= 12 && y >= 8 && y <= 12 ? (x === 10 && y === 10 ? DARK : WHITE) : x === 3 && y === 3 ? SHADE : BODY;
    });
    const partOfCell = cellParts(cells, [{ name: "몸통", cells: [...Array(cells.count).keys()] }]);
    const partOfFace = facePartsOf(cells, partOfCell);
    const out = tidyByParts(partOfFace, cells, partOfCell, labels, [{ part: 0, main: BODY, keep: [WHITE] }], {
      protectedLabels: null,
      near: () => null,
      adjacency: g.adjacency,
      distinct: (label, around) => label === DARK && around === WHITE,
    });
    const changed = new Set(out.faces);
    g.cellXY.forEach(([x, y], f) => {
      if (x === 10 && y === 10) expect(changed.has(f)).toBe(false);
      if (x === 3 && y === 3) expect(changed.has(f)).toBe(true);
    });
  });
});
