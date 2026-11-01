import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import type { RGB, Tri, Vec3 } from "@core/types";
import { cleanGaps, type GapCleanInput } from "./gapClean";

const WHITE = 0;
const MINT = 1;
const GREEN = 2;
const RGBS: RGB[] = [
  [240, 240, 238],
  [144, 198, 176],
  [62, 114, 74],
];

/** A w×h grid of squares, each cut into two triangles; face (i, j, k) = (j·w + i)·2 + k. */
function grid(w: number, h: number, colourOf: (i: number, j: number, k: number) => number, protectedLabels: number[] = []): GapCleanInput {
  const vertices: Vec3[] = [];
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) vertices.push([i, j, 0]);
  const v = (i: number, j: number) => j * (w + 1) + i;
  const triangles: Tri[] = [];
  const labels: number[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      triangles.push([v(i, j), v(i + 1, j), v(i + 1, j + 1)]);
      labels.push(colourOf(i, j, 0));
      triangles.push([v(i, j), v(i + 1, j + 1), v(i, j + 1)]);
      labels.push(colourOf(i, j, 1));
    }
  }
  const prot = new Uint8Array(RGBS.length);
  for (const l of protectedLabels) prot[l] = 1;
  return {
    adjacency: buildFaceAdjacency(triangles, vertices.length),
    triangles,
    vertices,
    labels: Int32Array.from(labels),
    colours: labels.map((l) => RGBS[l]),
    protectedLabels: prot,
  };
}

const face = (w: number, i: number, j: number, k: number) => (j * w + i) * 2 + k;
const facesOf = (input: GapCleanInput, label: number) => Int32Array.from([...input.labels.keys()].filter((f) => input.labels[f] === label));
const labelOf = (colour: RGB) => RGBS.findIndex((c) => c === colour);

describe("cleanGaps — between the picked patches", () => {
  // White on the left, mint on the right, a green column (one square wide)
  // wedged between them in rows 0..5; rows 6..9 are a wide green region.
  const W = 9;
  const build = (prot: number[] = []) =>
    grid(W, 10, (i, j) => (j >= 6 ? GREEN : i < 4 ? WHITE : i === 4 ? GREEN : MINT), prot);

  it("takes the colour wedged between the two, and not the wide region the gap opens into", () => {
    const input = build();
    const result = cleanGaps(input, { kind: "between", patches: [facesOf(input, WHITE), facesOf(input, MINT)] });
    for (let j = 0; j < 6; j++)
      for (let k = 0; k < 2; k++) expect(labelOf(result.colours[face(W, 4, j, k)])).not.toBe(GREEN);
    // The wide green region keeps all but a face or two at the mouth of the gap.
    let green = 0;
    for (let j = 6; j < 10; j++) for (let i = 0; i < W; i++) for (let k = 0; k < 2; k++) if (labelOf(result.colours[face(W, i, j, k)]) === GREEN) green++;
    expect(green).toBeGreaterThanOrEqual(4 * W * 2 - 2);
    // Only green changed, and only into the picked colours.
    for (const f of result.changed) {
      expect(input.labels[f]).toBe(GREEN);
      expect([WHITE, MINT]).toContain(labelOf(result.colours[f]));
    }
  });

  it("needs two colours picked", () => {
    const input = build();
    const result = cleanGaps(input, { kind: "between", patches: [facesOf(input, WHITE)] });
    expect(result.changed.length).toBe(0);
  });

  it("leaves a protected colour alone", () => {
    const input = build([GREEN]);
    const result = cleanGaps(input, { kind: "between", patches: [facesOf(input, WHITE), facesOf(input, MINT)] });
    expect(result.changed.length).toBe(0);
  });
});

describe("cleanGaps — the whole model", () => {
  it("keeps the middle of a line one face wide, takes the teeth", () => {
    // Mint below, white above, a green line (one square) between them in row 5.
    const W = 10;
    const input = grid(W, 10, (i, j) => (j < 5 ? MINT : j === 5 ? GREEN : WHITE));
    const result = cleanGaps(input, { kind: "all" });
    for (let i = 2; i < W - 2; i++)
      for (let k = 0; k < 2; k++) expect(labelOf(result.colours[face(W, i, 5, k)])).toBe(GREEN);
  });

  it("sends a wedged face to the colour it borders most", () => {
    // Mint below row 5, white from row 5 up; one green triangle in the mint
    // touching the white only at a corner: its three sides are mint.
    const W = 10;
    const input = grid(W, 10, (i, j, k) => (i === 4 && j === 4 && k === 0 ? GREEN : j < 5 ? MINT : WHITE));
    const result = cleanGaps(input, { kind: "all" });
    expect(labelOf(result.colours[face(W, 4, 4, 0)])).toBe(MINT);
    expect(result.changed.length).toBe(1);
  });

  it("does not touch a plain border between two colours", () => {
    const W = 10;
    const input = grid(W, 10, (i, j) => (j < 5 ? MINT : WHITE));
    expect(cleanGaps(input, { kind: "all" }).changed.length).toBe(0);
  });
});
