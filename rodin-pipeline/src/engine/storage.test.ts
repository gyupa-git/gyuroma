import { describe, expect, it } from "vitest";
import { deserialiseRecord, expectsLocalServer, packRuns, sameWorkFile, serialiseRecord, unpackRuns, workFileBody, type StoredWorkColours, type StoredWorkCuts } from "./storage";

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

describe("records that are broken or belong to another file (11-10)", () => {
  const header = (bytes: Uint8Array, change: (h: Record<string, unknown>) => Record<string, unknown>): ArrayBuffer => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = view.getUint32(4, true);
    const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length))) as Record<string, unknown>;
    const hb = new TextEncoder().encode(JSON.stringify(change(h)));
    const out = new Uint8Array(8 + hb.length + bytes.length - 8 - length);
    out.set(bytes.subarray(0, 4), 0);
    new DataView(out.buffer).setUint32(4, hb.length, true);
    out.set(hb, 8);
    out.set(bytes.subarray(8 + length), 8 + hb.length);
    return out.buffer;
  };

  it("a header that is not JSON reads as broken (null), not as an exception", () => {
    const bytes = serialiseRecord({ faceCount: 1, colours: Uint8Array.from([1, 2, 3]), savedAt: 1 } as StoredWorkColours) as Uint8Array;
    const garbled = bytes.slice();
    garbled[9] = 0x7b; // "{" where a quote was
    garbled[10] = 0x7b;
    expect(() => deserialiseRecord(garbled.buffer)).not.toThrow();
    expect(deserialiseRecord(garbled.buffer)).toBeNull();
    expect(deserialiseRecord(new Uint8Array(3).buffer)).toBeNull();
  });

  it("cuts cut short read as broken (null), not as a RangeError", () => {
    const record: StoredWorkCuts = {
      fileName: "a.3mf",
      savedAt: 1,
      cuts: [{ faces: 4, vertices: 4, addedVertices: Float64Array.from([1, 2, 3]), pieces: Int32Array.from([0, 1, 2]), pieceGroups: Int32Array.from([1]), pieceFaces: Int32Array.from([2]), replaced: Int32Array.from([2]) }],
    };
    const bytes = serialiseRecord(record) as Uint8Array;
    expect(deserialiseRecord(bytes.slice().buffer)).not.toBeNull();
    for (const cut of [1, 8, 20]) {
      const short = bytes.slice(0, bytes.length - cut);
      expect(() => deserialiseRecord(short.buffer)).not.toThrow();
      expect(deserialiseRecord(short.buffer)).toBeNull();
    }
  });

  it("colours that do not make their face count read as broken", () => {
    const bytes = serialiseRecord({ faceCount: 2, colours: Uint8Array.from([1, 2, 3, 4, 5, 6]), savedAt: 1 } as StoredWorkColours) as Uint8Array;
    expect(deserialiseRecord(bytes.slice(0, bytes.length - 1).buffer)).toBeNull();
    expect(deserialiseRecord(header(bytes, (h) => ({ ...h, faceCount: 3 })))).toBeNull();
  });

  it("names the file a colour or cut record was made on, and reads records saved before without one", () => {
    const colours: StoredWorkColours = { faceCount: 1, colours: Uint8Array.from([9, 8, 7]), savedAt: 2, cuts: 0, file: { name: "Bvc.3mf", size: 4242 } };
    const back = deserialiseRecord((serialiseRecord(colours) as Uint8Array).slice().buffer) as StoredWorkColours;
    expect(back.file).toEqual({ name: "Bvc.3mf", size: 4242 });
    const old = deserialiseRecord((serialiseRecord({ ...colours, file: undefined }) as Uint8Array).slice().buffer) as StoredWorkColours;
    expect(old.file).toBeUndefined();
    const cuts = deserialiseRecord((serialiseRecord({ fileName: "Bvc.3mf", fileSize: 4242, savedAt: 3, cuts: [] } as StoredWorkCuts) as Uint8Array).slice().buffer) as StoredWorkCuts;
    expect(cuts.fileSize).toBe(4242);
    expect(sameWorkFile(back.file, { name: "Bvc.3mf", size: 4242 })).toBe(true);
    expect(sameWorkFile(back.file, { name: "Bvc.3mf", size: 4243 })).toBe(false);
    expect(sameWorkFile(back.file, { name: "Other.3mf", size: 4242 })).toBe(false);
    expect(sameWorkFile(undefined, { name: "Any.3mf", size: 1 })).toBe(true);
  });

  it("takes a Korean name composed or decomposed as the same file (a Mac hands out either)", () => {
    const made = { name: "무대 커튼.3mf".normalize("NFD"), size: 11566349 };
    expect(made.name).not.toBe("무대 커튼.3mf");
    expect(sameWorkFile(made, { name: "무대 커튼.3mf", size: 11566349 })).toBe(true);
    expect(sameWorkFile({ name: "무대 커튼.3mf", size: 11566349 }, { name: made.name, size: 11566349 })).toBe(true);
    expect(sameWorkFile(made, { name: "무대 커튼 2.3mf", size: 11566349 })).toBe(false);
  });

  it("knows a page from this computer or its network from the public site", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "192.168.0.12", "10.1.2.3", "172.20.0.5", "gyupa-mac.local"]) expect(expectsLocalServer(host)).toBe(true);
    for (const host of ["gyupa-git.github.io", "gyuroma.app", "172.32.0.1", "8.8.8.8", ""]) expect(expectsLocalServer(host)).toBe(false);
  });
});

describe("the model file's record sent in pieces (11-10, Q7)", () => {
  it("is the same bytes as the record in one array, and reads back to the same file", async () => {
    for (const palette of [undefined, Uint8Array.from([1, 2, 3, 4, 5, 6])]) {
      const file = new Uint8Array(4099).map((_v, i) => (i * 37) & 255);
      const record = { name: "모델 ✨.obj", kind: "nomad" as const, buffer: file.buffer, palette, savedAt: 1731200000000 };
      const whole = serialiseRecord(record) as Uint8Array;
      const pieces = new Uint8Array(await workFileBody(record).arrayBuffer());
      expect(pieces.length).toBe(whole.length);
      expect(Buffer.from(pieces).equals(Buffer.from(whole))).toBe(true);
      const back = deserialiseRecord(pieces.slice().buffer) as { name: string; kind: string; buffer: ArrayBuffer; palette?: Uint8Array };
      expect(back.name).toBe(record.name);
      expect(back.kind).toBe("nomad");
      expect(Buffer.from(new Uint8Array(back.buffer)).equals(Buffer.from(file))).toBe(true);
      expect(back.palette ? [...back.palette] : undefined).toEqual(palette ? [...palette] : undefined);
    }
  });
});
