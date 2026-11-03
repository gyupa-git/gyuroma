import { describe, expect, it } from "vitest";
import { buildEdgeAdjacency } from "../meshAdjacency";
import { flatCorners } from "../borderLines";
import { cutAlongBorderLines, meshWithCut } from "../borderCut";
import { paintedGrid } from "./fixtures";
import type { Tri, Vec3 } from "../types";

/**
 * A confirmed cut line is final: with the same colours, the next cuts only trim
 * teeth the cut left as they were (said so: `trim`), and soon find nothing —
 * confirm after confirm (11-03: on a sculpt the count grew every time, measured
 * against the cut line's own shorter edges, and "확정할 삼각형 N개" never went
 * away).  A ragged painted surface, where the line the first cut drew is not
 * perfectly even.
 */
describe("cutAlongBorderLines — a confirmed cut stays confirmed", () => {
  it("after a confirm only trims teeth, and finds nothing by the third confirm", () => {
    const options = { span: 16, protectedGroup: new Uint8Array(3) };
    const rounds: Record<number, number[]> = {};
    for (let seed = 1; seed <= 12; seed++) {
      const painted = paintedGrid(seed);
      let vertices: Vec3[] = painted.vertices;
      let triangles: Tri[] = painted.triangles;
      let groups = painted.groups;
      let cutFaces: Uint8Array | undefined;
      let sides = buildEdgeAdjacency(flatCorners(triangles), vertices.length);
      let cut = cutAlongBorderLines(sides, triangles, vertices, groups, options);
      expect(cut.replaced.length).toBeGreaterThan(0);
      expect(cut.trim).toBeUndefined();
      const first = cut.replaced.length;
      const counts: number[] = [];
      for (let round = 0; round < 3; round++) {
        // Confirmed: the cut mesh, every face's group as cut, and which faces a cut made.
        const after = meshWithCut(vertices, triangles, cut);
        const settled = Int32Array.from(after.originalFace, (f, i) => (after.piece[i] >= 0 ? cut.pieceGroups[after.piece[i]] : groups[f]));
        const cutNext = Uint8Array.from(after.originalFace, (f, i) => (after.piece[i] >= 0 ? 1 : (cutFaces?.[f] ?? 0)));
        vertices = after.vertices;
        triangles = after.triangles;
        groups = settled;
        cutFaces = cutNext;
        sides = buildEdgeAdjacency(flatCorners(triangles), vertices.length);
        cut = cutAlongBorderLines(sides, triangles, vertices, groups, { ...options, settled, cutFaces });
        counts.push(cut.replaced.length);
        // Nothing repainted: whatever is cut is a trim of leftover teeth, and the cut says so.
        expect(cut.trim ?? false).toBe(cut.replaced.length > 0);
        // A trim takes fewer faces than the cut itself did, by far.
        expect(cut.replaced.length).toBeLessThan(first / 4);
      }
      rounds[seed] = counts;
    }
    // eslint-disable-next-line no-console
    console.log("replaced per round after each confirm:", JSON.stringify(rounds));
    for (const seed of Object.keys(rounds)) expect(rounds[Number(seed)][2]).toBe(0);
  });
});
