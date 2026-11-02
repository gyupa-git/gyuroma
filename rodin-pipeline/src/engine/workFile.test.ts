import { describe, expect, it } from "vitest";
import { packRuns, type StoredWorkColours, type StoredWorkCuts, type StoredWorkFile } from "./storage";
import { packWorkFile, readWorkFile, WorkFileError, workFileName } from "./workFile";

const obj = new TextEncoder().encode("# Exported from Nomad Sculpt\nv 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 0 1 0 0 0 1\nf 1 2 3\n".repeat(200));
const file: StoredWorkFile = { name: "Slc_p.obj", kind: "obj", buffer: obj.slice().buffer, savedAt: 1793543570580 };
const colours: StoredWorkColours = { faceCount: 3, colours: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), savedAt: 1793586128078, cuts: 1 };
const cuts: StoredWorkCuts = {
  fileName: "Slc_p.obj",
  savedAt: 1793572180455,
  cuts: [
    {
      faces: 2,
      vertices: 4,
      addedVertices: Float64Array.from([0.5, 0.25, 0.30000000000000004]),
      pieces: Int32Array.from([0, 4, 2, 4, 1, 2]),
      pieceGroups: Int32Array.from([0, 1]),
      pieceFaces: Int32Array.from([1, 1]),
      replaced: Int32Array.from([1]),
      settled: packRuns(Uint8Array.from([9, 9, 9, 1, 2, 3, 1, 2, 3])),
    },
  ],
};
const settings = { stripByModel: { "Slc_p.obj": { target: 24, cuts: { 4: [0.0492, 0.985] } } }, manualPhysical: { 5: 1 } };

describe("work file", () => {
  it("brings back the model file, the colours, the cuts and the settings exactly", async () => {
    const blob = await packWorkFile({ file, colours, cuts, settings, app: "GYUROMA test", savedAt: 42 });
    // gzipped: the repeated OBJ text packs small
    expect(blob.size).toBeLessThan(obj.length / 4);
    const back = await readWorkFile(blob);
    expect(back.file.name).toBe("Slc_p.obj");
    expect(back.file.kind).toBe("obj");
    expect([...new Uint8Array(back.file.buffer)]).toEqual([...obj]);
    expect(back.colours?.faceCount).toBe(3);
    expect(back.colours?.cuts).toBe(1);
    expect([...(back.colours?.colours ?? [])]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(back.cuts?.cuts.length).toBe(1);
    const cut = back.cuts!.cuts[0];
    for (const key of ["addedVertices", "pieces", "pieceGroups", "pieceFaces", "replaced", "settled"] as const) expect([...(cut[key] ?? [])]).toEqual([...(cuts.cuts[0][key] ?? [])]);
    expect(back.settings).toEqual(settings);
    expect(back.savedAt).toBe(42);
    expect(back.app).toBe("GYUROMA test");
  });

  it("keeps a model with its own colours and no cuts", async () => {
    const back = await readWorkFile(await packWorkFile({ file, colours: null, cuts: null, settings: {}, app: "x" }));
    expect(back.colours).toBeNull();
    expect(back.cuts).toBeNull();
    expect(new Uint8Array(back.file.buffer).length).toBe(obj.length);
  });

  it("refuses what is not a work file, or is cut short", async () => {
    await expect(readWorkFile(new Blob([obj]))).rejects.toBeInstanceOf(WorkFileError);
    const blob = await packWorkFile({ file, colours, cuts, settings, app: "x" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await expect(readWorkFile(new Blob([bytes.slice(0, bytes.length - 20)]))).rejects.toMatchObject({ code: "broken" });
  });

  it("names the file after the model and the time", () => {
    expect(workFileName("Slc_p.obj", new Date(2026, 10, 2, 16, 5))).toBe("Slc_p 2026-11-02 1605.gyuroma");
    expect(workFileName("typhoeus.3mf", new Date(2026, 0, 9, 8, 30))).toBe("typhoeus 2026-01-09 0830.gyuroma");
  });
});
