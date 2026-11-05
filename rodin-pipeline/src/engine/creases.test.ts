import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import type { Tri, Vec3 } from "@core/types";
import { creaseGeometry, fillUnlabelled, snapToCreases } from "./creases";

/** A w×h grid of cells (two triangles each) with height z = h(x), faces wound to face +z. */
function surface(w: number, h: number, height: (x: number) => number) {
  const vertices: Vec3[] = [];
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) vertices.push([x, y, height(x)]);
  const triangles: Tri[] = [];
  const cellX: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = y * (w + 1) + x;
      triangles.push([a, a + 1, a + w + 1], [a + 1, a + w + 2, a + w + 1]);
      cellX.push(x, x);
    }
  return { triangles, cellX, adjacency: buildFaceAdjacency(triangles, vertices.length), geometry: creaseGeometry(vertices, triangles) };
}

describe("snapToCreases", () => {
  it("moves a border a few faces off a groove into the groove", () => {
    // A valley along x = 10 (both sides slope down into it); the colour border drawn at x = 13.
    const s = surface(24, 6, (x) => Math.abs(x - 10) * 0.8);
    const labels = Int32Array.from(s.cellX.map((x) => (x < 13 ? 0 : 1)));
    const out = snapToCreases(labels, s.adjacency, s.geometry, { band: 5 });
    s.cellX.forEach((x, f) => {
      if (x <= 8) expect(out[f]).toBe(0);
      if (x >= 11) expect(out[f]).toBe(1);
    });
  });

  it("on a flat surface with no colour told, leaves the border where it is (within a face)", () => {
    const s = surface(24, 6, () => 0);
    const labels = Int32Array.from(s.cellX.map((x) => (x < 12 ? 0 : 1)));
    const out = snapToCreases(labels, s.adjacency, s.geometry, { band: 4 });
    s.cellX.forEach((x, f) => {
      if (x <= 10) expect(out[f]).toBe(0);
      if (x >= 13) expect(out[f]).toBe(1);
    });
  });

  it("keeps a line thinner than the band, and a frozen colour as it is", () => {
    const s = surface(24, 6, () => 0);
    const labels = Int32Array.from(s.cellX.map((x) => (x === 12 ? 2 : x === 5 ? 3 : 0)));
    const frozen = new Uint8Array(4);
    frozen[3] = 1;
    const out = snapToCreases(labels, s.adjacency, s.geometry, { band: 4, frozen });
    let line = 0;
    s.cellX.forEach((x, f) => {
      if (out[f] === 2) line++;
      if (x === 5) expect(out[f]).toBe(3);
    });
    expect(line).toBeGreaterThan(0);
  });
});

describe("fillUnlabelled", () => {
  it("an unplaced strip between two sides is split at the groove in it", () => {
    // Side 0 up to x = 5, side 1 from x = 18; between them nothing, with a valley at x = 9.
    const s = surface(24, 6, (x) => Math.abs(x - 9) * 0.8);
    const labels = Int32Array.from(s.cellX.map((x) => (x <= 5 ? 0 : x >= 18 ? 1 : -1)));
    const out = fillUnlabelled(labels, s.adjacency, s.geometry);
    s.cellX.forEach((x, f) => {
      expect(out[f]).toBeGreaterThanOrEqual(0);
      if (x <= 7) expect(out[f]).toBe(0);
      if (x >= 10) expect(out[f]).toBe(1);
    });
  });
});
