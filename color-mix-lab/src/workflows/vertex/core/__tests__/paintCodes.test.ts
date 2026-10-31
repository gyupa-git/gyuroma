import { describe, expect, it } from "vitest";
import { decodePaintCode, encodePaintCode, MAX_PAINTABLE_EXTRUDER_ID, paintCodeStates, remapPaintCode, tryDecodePaintCode } from "../paintCodes";

describe("paint codes", () => {
  it("uses the PrusaSlicer/Bambu encoding table", () => {
    expect(encodePaintCode(1)).toBe("4");
    expect(encodePaintCode(2)).toBe("8");
    expect(encodePaintCode(3)).toBe("0C");
    expect(encodePaintCode(4)).toBe("1C");
    expect(encodePaintCode(13)).toBe("AC");
    expect(encodePaintCode(14)).toBe("BC");
    expect(encodePaintCode(15)).toBe("CC");
    expect(encodePaintCode(17)).toBe("00EC");
  });

  it("round-trips every id the encoder can produce", () => {
    for (let id = 1; id <= MAX_PAINTABLE_EXTRUDER_ID; id++) expect(decodePaintCode(encodePaintCode(id))).toBe(id);
  });

  it("decodes the unpainted state and rejects garbage", () => {
    expect(decodePaintCode("")).toBe(0);
    expect(decodePaintCode("cc")).toBe(15);
    expect(tryDecodePaintCode("ZZ")).toBeNull();
    expect(() => decodePaintCode("EC")).toThrow();
    expect(() => encodePaintCode(0)).toThrow();
  });

  it("matches the PrusaSlicer 2.9.6 paint state limit (256 states, ids 1..255)", () => {
    expect(MAX_PAINTABLE_EXTRUDER_ID).toBe(255);
    expect(encodePaintCode(16)).toBe("DC");
    expect(encodePaintCode(MAX_PAINTABLE_EXTRUDER_ID)).toBe("EEEC");
    expect(decodePaintCode("EEEC")).toBe(255);
    expect(() => encodePaintCode(MAX_PAINTABLE_EXTRUDER_ID + 1)).toThrow(/limit/);
  });

  it("changes the states of whole triangles the way the encoder writes them", () => {
    for (let id = 1; id <= MAX_PAINTABLE_EXTRUDER_ID; id++) {
      expect(remapPaintCode(encodePaintCode(id), (state) => state)).toBe(encodePaintCode(id));
      const to = ((id * 7) % MAX_PAINTABLE_EXTRUDER_ID) + 1;
      expect(remapPaintCode(encodePaintCode(id), () => to)).toBe(encodePaintCode(to));
    }
  });

  it("changes every leaf of a triangle split by the brush, keeping the split", () => {
    // two children, special side 0: a leaf in state 1, a leaf in state 3
    const split = "0C41";
    expect(paintCodeStates(split)).toEqual([1, 3]);
    const moved = remapPaintCode(split, (state) => (state === 3 ? 20 : state === 1 ? 2 : state));
    expect(paintCodeStates(moved as string)).toEqual([2, 20]);
    expect(remapPaintCode(moved as string, (state) => (state === 20 ? 3 : state === 2 ? 1 : state))).toBe(split);
    // the unpainted state inside a split stays unpainted
    expect(paintCodeStates(remapPaintCode("0C01", (s) => s) as string)).toEqual([0, 3]);
  });

  it("reads version 1 codes, where four bits never mean the long form", () => {
    expect(paintCodeStates("EC", "prusa1")).toEqual([17]);
    expect(paintCodeStates("EC", "prusa")).toBeNull();
    expect(remapPaintCode("EC", (s) => s, "prusa1")).toBe(encodePaintCode(17));
  });

  it("writes and reads Bambu Studio's long states (measured with Bambu Studio 2.8.4)", () => {
    // 1..16 are the same in both
    for (let id = 1; id <= 16; id++) expect(encodePaintCode(id, "bambu")).toBe(encodePaintCode(id));
    expect(encodePaintCode(17, "bambu")).toBe("EC");
    expect(encodePaintCode(18, "bambu")).toBe("0FC");
    expect(encodePaintCode(19, "bambu")).toBe("1FC");
    expect(encodePaintCode(32, "bambu")).toBe("EFC");
    expect(() => encodePaintCode(34, "bambu")).toThrow();
    for (let id = 1; id <= 33; id++) expect(decodePaintCode(encodePaintCode(id, "bambu"), "bambu")).toBe(id);
    // what Bambu Studio does with PrusaSlicer's long form: every one of them is 17
    expect(paintCodeStates("05EC", "bambu")).toBeNull();
    expect(tryDecodePaintCode("00EC", "bambu")).toBeNull();
    // a PrusaSlicer file's code turned into Bambu's and back
    expect(remapPaintCode("05EC", (s) => s, "prusa", "bambu")).toBe("4FC");
    expect(remapPaintCode("4FC", (s) => s, "bambu", "prusa")).toBe("05EC");
    expect(remapPaintCode("4C", () => 40, "prusa", "bambu")).toBeNull();
  });

  it("refuses codes that are not a whole tree", () => {
    expect(remapPaintCode("", (s) => s)).toBeNull();
    expect(remapPaintCode("1", (s) => s)).toBeNull();
    expect(remapPaintCode("Z4", (s) => s)).toBeNull();
    expect(remapPaintCode("44", (s) => s)).toBeNull();
  });
});
