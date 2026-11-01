import { describe, expect, it } from "vitest";
import { deserialiseRecord, packRuns, serialiseRecord, unpackRuns, type StoredWorkColours, type StoredWorkCuts } from "./storage";

describe("work cuts on disk", () => {
  it("come back exactly, cut by cut, with the settled colours", () => {
    const record: StoredWorkCuts = {
      fileName: "Slc_p.obj",
      savedAt: 1730500000000,
      cuts: [
        {
          faces: 10,
          vertices: 8,
          addedVertices: Float64Array.from([0.1, 0.2, 0.30000000000000004, -1e-9, 2.5, 3]),
          pieces: Int32Array.from([0, 8, 2, 8, 9, 3, 9, 1, 3]),
          pieceGroups: Int32Array.from([0, 1, 1]),
          pieceFaces: Int32Array.from([4, 4, 4]),
          replaced: Int32Array.from([4]),
          settled: packRuns(Uint8Array.from([9, 9, 9, 9, 9, 9, 1, 2, 3])),
        },
        {
          faces: 12,
          vertices: 10,
          addedVertices: Float64Array.from([5, 6, 7]),
          pieces: Int32Array.from([1, 2, 10]),
          pieceGroups: Int32Array.from([2]),
          pieceFaces: Int32Array.from([11]),
          replaced: Int32Array.from([11]),
        },
      ],
    };
    const bytes = serialiseRecord(record);
    expect(bytes).not.toBeNull();
    const back = deserialiseRecord((bytes as Uint8Array).slice().buffer) as StoredWorkCuts;
    expect(back.fileName).toBe("Slc_p.obj");
    expect(back.savedAt).toBe(record.savedAt);
    expect([...(unpackRuns(back.cuts[0].settled as Uint8Array, 3) ?? [])]).toEqual([9, 9, 9, 9, 9, 9, 1, 2, 3]);
    expect(back.cuts[1].settled).toBeUndefined();
    expect(back.cuts.length).toBe(2);
    back.cuts.forEach((cut, i) => {
      const want = record.cuts[i];
      expect(cut.faces).toBe(want.faces);
      expect(cut.vertices).toBe(want.vertices);
      for (const key of ["addedVertices", "pieces", "pieceGroups", "pieceFaces", "replaced"] as const) expect([...cut[key]]).toEqual([...want[key]]);
    });
  });

  it("keeps the number of cuts the colours belong to", () => {
    const colours: StoredWorkColours = { faceCount: 2, colours: Uint8Array.from([1, 2, 3, 4, 5, 6]), savedAt: 5, cuts: 3 };
    const back = deserialiseRecord((serialiseRecord(colours) as Uint8Array).slice().buffer) as StoredWorkColours;
    expect(back.cuts).toBe(3);
    expect([...back.colours]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("packs a face colour per face as runs, and only unpacks to the right count", () => {
    const rgb = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 6, 7, 5, 6, 7, 1, 1, 1]);
    const runs = packRuns(rgb);
    expect(runs.length).toBe(3 * 7);
    expect([...(unpackRuns(runs, 6) ?? [])]).toEqual([...rgb]);
    expect(unpackRuns(runs, 5)).toBeNull();
    expect(unpackRuns(runs, 7)).toBeNull();
  });
});
