import { describe, expect, it } from "vitest";
import type { FaceAtlas } from "./atlas";
import { GuideBuilder, guideSegments, guidesOnMap, packGuides, strokeLines, unpackGuides } from "./guides";

const THIRDS: [number, number, number] = [1 / 3, 1 / 3, 1 / 3];

describe("guide lines", () => {
  it("keeps a drag along the surface as one line, and starts another after a jump", () => {
    const builder = new GuideBuilder();
    for (let i = 0; i < 6; i++) builder.add({ faceIndex: i, point: [i * 0.1, 0, 0], bary: THIRDS });
    // Over a silhouette: the next point lies far behind.
    builder.add({ faceIndex: 50, point: [0.6, 0, 3], bary: THIRDS });
    for (let i = 1; i < 4; i++) builder.add({ faceIndex: 50 + i, point: [0.6 + i * 0.1, 0, 3], bary: THIRDS });
    expect(builder.stroke.runs.map((run) => run.length)).toEqual([6, 4]);
    expect(builder.lineCount).toBe(2);
  });

  it("breaks the line where the pointer leaves the model, and takes a lone point as no line", () => {
    const builder = new GuideBuilder();
    builder.add({ faceIndex: 0, point: [0, 0, 0], bary: THIRDS });
    builder.add({ faceIndex: 1, point: [0.1, 0, 0], bary: THIRDS });
    builder.add(null);
    builder.add({ faceIndex: 2, point: [5, 0, 0], bary: THIRDS });
    expect(builder.stroke.runs.map((run) => run.length)).toEqual([2, 1]);
    expect(strokeLines(builder.stroke)).toHaveLength(1);
  });

  it("lays the line on the map, broken at seams and where the map does not show the face", () => {
    // Four faces: 0 and 1 on chart 0, 2 on chart 1, 3 not on the map.
    const faceUv = new Float32Array(4 * 6);
    for (let f = 0; f < 4; f++) faceUv.set([f * 10, 0, f * 10 + 6, 0, f * 10, 6], f * 6);
    const atlas = { chartOf: Int32Array.from([0, 0, 1, -1]), faceUv } as unknown as FaceAtlas;
    const at = (face: number) => ({ face, bary: [1, 0, 0] as [number, number, number] });
    const lines = guidesOnMap([{ runs: [[at(0), at(1), at(2), at(3), at(1), at(0)]] }], atlas);
    // 0→1 on chart 0; 2 alone on chart 1 (no line); 3 off the map; 1→0 again.
    expect(lines.map((line) => Array.from(line))).toEqual([
      [0, 0, 10, 0],
      [10, 0, 0, 0],
    ]);
  });

  it("lifts the line off the surface along the face normal", () => {
    // One face in the z = 0 plane, facing +z.
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const segments = guideSegments([{ runs: [[{ face: 0, bary: [1, 0, 0] }, { face: 0, bary: [0, 1, 0] }]] }], positions, 0.01);
    expect(Array.from(segments).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 0.01, 1, 0, 0.01]);
  });

  it("keeps the lines and takes them back for the same model only", () => {
    const strokes = [
      { runs: [[{ face: 3, bary: [0.2, 0.3, 0.5] as [number, number, number] }, { face: 4, bary: [1 / 3, 1 / 3, 1 / 3] as [number, number, number] }], [{ face: 9, bary: [1, 0, 0] as [number, number, number] }]] },
      // A click: no line, not kept.
      { runs: [[{ face: 1, bary: [1, 0, 0] as [number, number, number] }]] },
    ];
    const kept = JSON.parse(JSON.stringify(packGuides(strokes, 10)));
    expect(kept.strokes).toHaveLength(1);
    const back = unpackGuides(kept, 10);
    expect(back).toHaveLength(1);
    expect(back?.[0].runs).toHaveLength(1);
    expect(back?.[0].runs[0].map((p) => p.face)).toEqual([3, 4]);
    expect(back?.[0].runs[0][1].bary.map((w) => Math.round(w * 1e4) / 1e4)).toEqual([0.3333, 0.3333, 0.3334]);
    // Another face count (another file of that name, the faces cut anew): nothing back.
    expect(unpackGuides(kept, 11)).toBeNull();
    expect(unpackGuides({ faceCount: 10, strokes: [[{ faces: [3, 40], bary: [0, 0, 0, 0] }]] }, 10)).toBeNull();
    expect(unpackGuides("nonsense", 10)).toBeNull();
  });
});
