import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "../meshAdjacency";
import { smoothBorderLines } from "../borderLines";
import { gridMesh } from "./fixtures";

// Two triangles per cell; face (i, j, k) = (j·nx + i)·2 + k.  Face k = 0 has its
// centre a third of the way up its cell, k = 1 two thirds.
const nx = 12;
const ny = 8;
const grid = gridMesh(nx, ny);
const adjacency = buildFaceAdjacency(grid.triangles, grid.vertices.length);
const face = (i: number, j: number, k: number) => (j * nx + i) * 2 + k;
const groupsOf = (of: (i: number, j: number, k: number) => number) => {
  const out: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push(of(i, j, 0), of(i, j, 1));
  return Int32Array.from(out);
};
const run = (groups: Int32Array, span: number, protectedGroups: number[] = []) => {
  const protectedGroup = new Uint8Array(3);
  for (const g of protectedGroups) protectedGroup[g] = 1;
  const changed = smoothBorderLines(adjacency, grid.triangles, grid.vertices, groups, { span, protectedGroup });
  return { groups, changed };
};

describe("smoothBorderLines", () => {
  // Group 0 below, group 1 above; in row 3 every other cell is a tooth of group 0.
  const teeth = () => groupsOf((i, j) => (j < 3 || (j === 3 && i % 2 === 0) ? 0 : 1));

  it("redraws a toothed border along its middle line", () => {
    const { groups, changed } = run(teeth(), 10);
    expect(changed).toBeGreaterThan(0);
    for (let i = 2; i < nx - 2; i++) {
      // The line runs through the middle of row 3: the lower half of each cell below it, the upper half above.
      expect(groups[face(i, 3, 0)]).toBe(0);
      expect(groups[face(i, 3, 1)]).toBe(1);
      expect(groups[face(i, 2, 1)]).toBe(0);
      expect(groups[face(i, 4, 0)]).toBe(1);
    }
  });

  it("straightens stairs shorter than the window into the line through them", () => {
    // Group 0 below a staircase that climbs a row every 4 columns; the line through
    // the middles of its risers is y = 1.5 + x / 4.
    const stairs = groupsOf((i, j) => (j < 2 + Math.floor(i / 4) ? 0 : 1));
    run(stairs, 14);
    let wrong = 0;
    let checked = 0;
    for (let j = 0; j < ny; j++)
      for (let i = 3; i < nx - 3; i++)
        for (let k = 0; k < 2; k++) {
          const cx = i + (k === 0 ? 2 / 3 : 1 / 3);
          const cy = j + (k === 0 ? 1 / 3 : 2 / 3);
          const below = cy < 1.5 + cx / 4;
          if (Math.abs(cy - (1.5 + cx / 4)) < 0.35) continue; // too near the line to call
          checked++;
          if (stairs[face(i, j, k)] !== (below ? 0 : 1)) wrong++;
        }
    expect(checked).toBeGreaterThan(50);
    expect(wrong).toBe(0);
  });

  it("leaves teeth that touch only at corners to the teeth trim", () => {
    // Rows 3 and 4 are a checkerboard of the two groups.  The border turns back on
    // itself around every corner, so the line stays and nothing is taken.
    const checker = groupsOf((i, j) => (j < 3 || (j === 3 && i % 2 === 0) || (j === 4 && i % 2 === 1) ? 0 : 1));
    expect(run(checker, 10).changed).toBe(0);
  });

  it("leaves a straight border, and does nothing at 0", () => {
    const straight = groupsOf((_i, j) => (j < 4 ? 0 : 1));
    const before = straight.slice();
    expect(run(straight, 10).changed).toBe(0);
    expect([...straight]).toEqual([...before]);
    const toothed = teeth();
    const kept = toothed.slice();
    expect(run(toothed, 0).changed).toBe(0);
    expect([...toothed]).toEqual([...kept]);
  });

  it("leaves a protected group's border and a thin line", () => {
    const toothed = teeth();
    const before = toothed.slice();
    run(toothed, 10, [0]);
    expect([...toothed]).toEqual([...before]);
    const line = groupsOf((_i, j) => (j === 3 ? 2 : 1));
    const lineBefore = line.slice();
    run(line, 10);
    for (let i = 1; i < nx - 1; i++) for (let k = 0; k < 2; k++) expect(line[face(i, 3, k)]).toBe(lineBefore[face(i, 3, k)]);
  });

  // A bigger grid for shapes with room around them.
  const big = gridMesh(48, 48);
  const bigAdjacency = buildFaceAdjacency(big.triangles, big.vertices.length);
  const bigRun = (groups: Int32Array, span: number) =>
    smoothBorderLines(bigAdjacency, big.triangles, big.vertices, groups, { span, protectedGroup: new Uint8Array(2) });
  const shape = (inside: (x: number, y: number) => boolean) => {
    const out: number[] = [];
    for (let j = 0; j < 48; j++)
      for (let i = 0; i < 48; i++) {
        out.push(inside(i + 2 / 3, j + 1 / 3) ? 1 : 0, inside(i + 1 / 3, j + 2 / 3) ? 1 : 0);
      }
    return Int32Array.from(out);
  };
  const ones = (g: Int32Array) => g.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);

  it("keeps a round part its size, big or small, run once or twice", () => {
    for (const r of [3, 6, 12]) {
      const disc = shape((x, y) => (x - 24) ** 2 + (y - 24) ** 2 <= r * r);
      const before = ones(disc);
      bigRun(disc, 16);
      expect(Math.abs(ones(disc) - before)).toBeLessThanOrEqual(Math.ceil(before * 0.05));
      const once = ones(disc);
      bigRun(disc, 16);
      expect(Math.abs(ones(disc) - once)).toBeLessThanOrEqual(Math.ceil(once * 0.02));
    }
  });

  it("grows no horns off the closed ends of thin bars or along a chain of corners", () => {
    for (const w of [1, 2, 3]) {
      const bar = shape((x, y) => x >= 14 && x < 34 && y >= 24 - w / 2 && y < 24 + w / 2);
      const before = bar.slice();
      bigRun(bar, 16);
      for (let f = 0; f < bar.length; f++) {
        if (bar[f] === before[f]) continue;
        // Any change stays within a couple of faces of the bar.
        const cell = Math.floor(f / 2);
        const i = cell % 48;
        const j = Math.floor(cell / 48);
        expect(i >= 12 && i < 36 && j >= 24 - w / 2 - 2 && j < 24 + w / 2 + 2).toBe(true);
      }
    }
    // Cells touching only at their corners, along a diagonal.
    const chain = shape((x, y) => Math.floor(x) === Math.floor(y) && x >= 10 && x < 30);
    const before = chain.slice();
    bigRun(chain, 10);
    expect([...chain]).toEqual([...before]);
  });
});
