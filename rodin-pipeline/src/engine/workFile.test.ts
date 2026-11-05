import { describe, expect, it } from "vitest";
import { deserialiseRecord, packRuns, serialiseJson, serialiseRecord, type StoredWorkColours, type StoredWorkCuts, type StoredWorkFile } from "./storage";
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

describe("plain records", () => {
  it("keep a part map and a conversation through the server's file (a reload lost them)", () => {
    const maps = { "Tkc_p.obj": { faces: 4619786, cells: 90, subject: "톱니 쿠키", parts: [{ name: "얼굴", cells: [1, 2, 3] }], at: "2026-11-05" } };
    const chat = [{ id: "u1", role: "user", text: "눈알 둘레에 흰 테두리", images: ["data:image/jpeg;base64,AAAA"] }];
    for (const value of [maps, chat]) expect(deserialiseRecord(serialiseJson(value).slice().buffer)).toEqual(value);
    // Anything else still is not JSON (a big record that fails its check must not become one).
    expect(serialiseRecord({ faceCount: 3, colours: [1, 2, 3] })).toBeNull();
  });
});

describe("work file", () => {
  it("carries the AI's part map and the consult with the work", async () => {
    const ai = { partMap: { faces: 3, cells: 2, subject: "x", parts: [{ name: "얼굴", cells: [0] }], at: "t" }, chat: [{ id: "a1", role: "ai", text: "네" }] };
    const back = await readWorkFile(await packWorkFile({ file, colours: null, cuts: null, settings, ai, app: "GYUROMA test", savedAt: 1 }));
    expect(back.ai).toEqual(ai);
    const before = await readWorkFile(await packWorkFile({ file, colours: null, cuts: null, settings, app: "GYUROMA test", savedAt: 1 }));
    expect(before.ai).toBeNull();
  });

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
