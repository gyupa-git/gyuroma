import { describe, expect, it } from "vitest";
import type { FaceAdjacency } from "@core/meshAdjacency";
import type { RGB } from "@core/types";
import { edgeChanges, edgeRings, measurePatchEdge } from "./patchEdge";

/** Faces in a row, each touching the one before and after. */
function row(count: number): FaceAdjacency {
  const offsets = new Int32Array(count + 1);
  const list: number[] = [];
  for (let f = 0; f < count; f++) {
    offsets[f] = list.length;
    if (f > 0) list.push(f - 1);
    if (f < count - 1) list.push(f + 1);
  }
  offsets[count] = list.length;
  return { faceCount: count, offsets, neighbours: Int32Array.from(list) };
}

const MOUTH: RGB = [14, 72, 70];
const SKIN: RGB = [176, 128, 84];
const mix = (t: number): RGB => [0, 1, 2].map((k) => Math.round(MOUTH[k] * (1 - t) + SKIN[k] * t)) as RGB;

// 0-7 mouth, 8-15 blending into skin, 16-39 skin, with one mouth-coloured face at 20 inside the band.
const colours: RGB[] = Array.from({ length: 40 }, (_, f) => (f < 8 ? MOUTH : f < 16 ? mix((f - 7) / 9) : SKIN));
colours[20] = MOUTH;
const adjacency = row(40);
const patch = Array.from({ length: 10 }, (_, f) => f); // the mouth patch reaches into the blend up to face 9

describe("moving a patch's edge through the blend", () => {
  const edge = measurePatchEdge(adjacency, patch, colours);

  it("changes nothing in the middle", () => {
    expect(edge).not.toBeNull();
    if (!edge) return;
    expect(edgeChanges(edge, adjacency, 50)).toEqual({ join: [], leave: [] });
  });

  it("grows into the blend, nearest faces first, and never jumps across", () => {
    if (!edge) return;
    const some = edgeChanges(edge, adjacency, 75).join.sort((a, b) => a - b);
    expect(some[0]).toBe(10);
    expect(some).toEqual(some.map((_, i) => 10 + i));
    const most = edgeChanges(edge, adjacency, 100).join;
    expect(most).not.toContain(20); // as dark as the mouth, but cut off by skin
    expect(Math.max(...most)).toBeLessThan(16);
  });

  it("reaches a little way first, the whole band only at the end", () => {
    if (!edge) return;
    expect(edgeRings(50)).toBe(0);
    expect(edgeRings(55)).toBe(1);
    expect(edgeRings(100)).toBe(14);
    expect(edgeChanges(edge, adjacency, 53).join).toEqual([10]);
  });

  it("thins by taking the palest faces first, from the edge in, and keeps its heart", () => {
    if (!edge) return;
    const first = edgeChanges(edge, adjacency, 40).leave;
    expect(first).toEqual([9]); // the palest face of the patch
    const leave = edgeChanges(edge, adjacency, 0).leave.sort((a, b) => b - a);
    expect(leave).toEqual(leave.map((_, i) => 9 - i)); // from the edge inwards
    expect(leave.length).toBeLessThanOrEqual(7); // no more than 70 % of the patch
    expect(leave).not.toContain(0);
    expect(edgeChanges(edge, adjacency, 30).join).toEqual([]);
  });

  it("peels a line with no blend around it by its own palest shades", () => {
    // a dark line in skin: its ends a little paler than its middle
    const line: RGB[] = Array.from({ length: 40 }, () => SKIN);
    [mix(0.3), mix(0.1), MOUTH, mix(0.1), mix(0.3)].forEach((rgb, i) => (line[10 + i] = rgb));
    const core = measurePatchEdge(adjacency, [10, 11, 12, 13, 14], line);
    expect(core).not.toBeNull();
    if (!core) return;
    expect(edgeChanges(core, adjacency, 50).leave).toEqual([]);
    expect(edgeChanges(core, adjacency, 20).leave.sort((a, b) => a - b)).toEqual([10, 14]);
    const most = edgeChanges(core, adjacency, 0).leave;
    expect(most.length).toBe(3); // 70 % of the five, the middle never
    expect(most).toContain(10);
    expect(most).toContain(14);
    expect(most).not.toContain(12);
  });
});
