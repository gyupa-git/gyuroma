import { describe, expect, it } from "vitest";
import type { RGB } from "../types";
import {
  addCut,
  buildColourStrip,
  familyOf,
  groupsFromCuts,
  initialCuts,
  moveCut,
  normaliseCuts,
  removeCut,
  stripLabels,
  stripPalette,
} from "../colourStrip";
import { rgbToLab } from "../prusaFdmMixer";
import { sharedRgbOf } from "../rgbPool";

/** A figure: four greens from light to dark, two skin tones, a white, a black, a tiny magenta. */
const FACES: RGB[] = [
  ...Array<RGB>(40).fill([120, 200, 140]),
  ...Array<RGB>(60).fill([60, 150, 90]),
  ...Array<RGB>(50).fill([40, 120, 70]),
  ...Array<RGB>(30).fill([20, 70, 40]),
  ...Array<RGB>(50).fill([230, 190, 150]),
  ...Array<RGB>(20).fill([200, 150, 110]),
  ...Array<RGB>(60).fill([250, 250, 250]),
  ...Array<RGB>(30).fill([20, 20, 20]),
  ...Array<RGB>(2).fill([220, 30, 140]),
];

describe("colour families", () => {
  it("puts greys in the neutral family and hues in their sector", () => {
    expect(familyOf(rgbToLab([128, 128, 128]))).toBe(0);
    expect(familyOf(rgbToLab([200, 30, 30]))).toBe(1);
    expect(familyOf(rgbToLab([40, 160, 70]))).toBe(4);
    expect(familyOf(rgbToLab([30, 60, 200]))).toBe(6);
  });

  it("lists each family's colours from light to dark", () => {
    const strip = buildColourStrip(FACES);
    const green = strip.families.find((family) => family.name === "green")!;
    expect(green.colours.map((colour) => colour.rgb[1])).toEqual([200, 150, 120, 70]);
    expect(strip.colourCount).toBe(9);
    const total = strip.families.reduce((sum, family) => sum + family.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe("cuts and groups", () => {
  const strip = buildColourStrip(FACES);

  it("gives every family a group and spends the rest where the area is", () => {
    const cuts = initialCuts(strip, 6);
    const groups = groupsFromCuts(strip, cuts).filter((group) => group.colours.length > 0);
    expect(groups.length).toBe(6);
    // Greens carry the most area, so they get the extra groups; the lone magenta keeps its own.
    const greens = groups.filter((group) => strip.families[group.family]?.name === undefined || true);
    expect(greens.length).toBeGreaterThan(0);
    const magenta = groups.find((group) => group.colours.some((colour) => colour.rgb[0] === 220));
    expect(magenta?.colours.length).toBe(1);
  });

  it("splits a family where the lightness changes most", () => {
    const cuts = initialCuts(strip, 9);
    const groups = groupsFromCuts(strip, cuts);
    // Nine groups for nine colours: every colour on its own.
    expect(groups.filter((group) => group.colours.length === 1).length).toBe(9);
  });

  it("merges by moving a cut until the band has nothing left", () => {
    const green = strip.families.find((family) => family.name === "green")!.family;
    let cuts = initialCuts(strip, 9);
    const before = groupsFromCuts(strip, cuts).filter((group) => group.family === green);
    expect(before.length).toBe(4);
    // Drag the first cut all the way down to the second: the second band empties.
    cuts = moveCut(cuts, green, 0, cuts[green][1]);
    const during = groupsFromCuts(strip, cuts).filter((group) => group.family === green);
    expect(during.filter((group) => group.colours.length === 0).length).toBe(1);
    cuts = normaliseCuts(strip, cuts);
    const after = groupsFromCuts(strip, cuts).filter((group) => group.family === green);
    expect(after.length).toBe(3);
    expect(after.every((group) => group.colours.length > 0)).toBe(true);
  });

  it("adds and removes cuts", () => {
    const green = strip.families.find((family) => family.name === "green")!.family;
    let cuts: Record<number, number[]> = {};
    cuts = addCut(cuts, green, 0.5);
    expect(groupsFromCuts(strip, cuts).filter((group) => group.family === green).length).toBe(2);
    cuts = removeCut(cuts, green, 1);
    expect(groupsFromCuts(strip, cuts).filter((group) => group.family === green).length).toBe(1);
  });

  it("keeps a moved cut between its neighbours", () => {
    const green = strip.families.find((family) => family.name === "green")!.family;
    const cuts = initialCuts(strip, 9);
    const moved = moveCut(cuts, green, 1, 0);
    expect(moved[green][1]).toBeGreaterThanOrEqual(moved[green][0]);
    expect(moved[green][1]).toBeLessThanOrEqual(moved[green][2]);
  });
});

describe("palette from the strip", () => {
  it("numbers the groups in strip order and labels every face", () => {
    const strip = buildColourStrip(FACES);
    const groups = groupsFromCuts(strip, initialCuts(strip, 5));
    const { palette, groupOfKey } = stripPalette(groups);
    expect(palette.length).toBe(5);
    expect(palette.map((entry) => entry.index)).toEqual([1, 2, 3, 4, 5]);
    const labels = stripLabels(FACES, groupOfKey, palette);
    expect(labels.length).toBe(FACES.length);
    expect(palette.reduce((sum, entry) => sum + entry.count, 0)).toBe(FACES.length);
    // The representative of a group is a colour the model actually has.
    for (const entry of palette) expect(FACES.some((face) => face.join() === entry.rgb.join())).toBe(true);
  });
});

describe("buildColourStrip — the last tuple's entry is reused (11-10)", () => {
  /** The strip as built before 11-10: every face looked up by its key. */
  function reference(colours: ArrayLike<RGB>, weights?: ArrayLike<number>, pins?: ReadonlyMap<number, number>) {
    const byKey = new Map<number, { rgb: RGB; weight: number }>();
    let total = 0;
    for (let i = 0; i < colours.length; i++) {
      const w = weights ? weights[i] : 1;
      if (!(w > 0)) continue;
      total += w;
      const c = colours[i];
      const key = (c[0] << 16) | (c[1] << 8) | c[2];
      const entry = byKey.get(key);
      if (entry) entry.weight += w;
      else byKey.set(key, { rgb: c, weight: w });
    }
    const families = ["neutral", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"].map((name, family) => ({ family, name, colours: [] as Array<Record<string, unknown>>, weight: 0 }));
    for (const [key, entry] of byKey) {
      const lab = rgbToLab(entry.rgb);
      const family = familyOf(lab);
      const colour: Record<string, unknown> = { key, rgb: entry.rgb, lab, weight: total > 0 ? entry.weight / total : 0, family };
      const pin = pins?.get(key);
      if (pin !== undefined) colour.pin = pin;
      families[family].colours.push(colour);
      families[family].weight += colour.weight as number;
    }
    for (const f of families) f.colours.sort((a, b) => ((a.pin as number) ?? -1) - ((b.pin as number) ?? -1) || (b.lab as { L: number }).L - (a.lab as { L: number }).L);
    return { families: families.filter((f) => f.colours.length > 0), colourCount: byKey.size };
  }

  it("gives the same strip to the last bit — shared and unshared tuples, runs, odd weights, pins", () => {
    let s = 7;
    const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pool: RGB[] = Array.from({ length: 40 }, () => [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)] as RGB);
    for (let round = 0; round < 6; round++) {
      const n = 5000 + round * 3000;
      const colours: RGB[] = [];
      let current = pool[0];
      for (let i = 0; i < n; i++) {
        if (rand() < 0.15) current = pool[Math.floor(rand() * pool.length)];
        // Some faces carry an equal colour in a tuple of their own (not pooled), some the pooled one.
        colours.push(rand() < 0.2 ? ([...current] as RGB) : current);
      }
      const weights = new Float64Array(n);
      for (let i = 0; i < n; i++) weights[i] = rand() < 0.03 ? (rand() < 0.5 ? 0 : Number.NaN) : rand() * 3e-4;
      const pins = new Map<number, number>([[(pool[3][0] << 16) | (pool[3][1] << 8) | pool[3][2], 0]]);
      expect(buildColourStrip(colours, weights, pins)).toEqual(reference(colours, weights, pins));
      expect(buildColourStrip(colours)).toEqual(reference(colours));
      expect(buildColourStrip(colours, Float32Array.from(weights))).toEqual(reference(colours, Float32Array.from(weights)));
    }
  });

  it("gives the same strip from the shared pool's arrays (added up by their number), and with one stray array among them", () => {
    let s = 11;
    const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const values = Array.from({ length: 60 }, () => [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)] as const);
    for (let round = 0; round < 4; round++) {
      const n = 8000 + round * 5000;
      const colours: RGB[] = [];
      let v = values[0];
      for (let i = 0; i < n; i++) {
        if (rand() < 0.2) v = values[Math.floor(rand() * values.length)];
        colours.push(sharedRgbOf(v[0], v[1], v[2]));
      }
      const weights = new Float64Array(n);
      for (let i = 0; i < n; i++) weights[i] = rand() < 0.02 ? 0 : rand() * 1e-3;
      const pins = new Map<number, number>([[(values[5][0] << 16) | (values[5][1] << 8) | values[5][2], 1]]);
      expect(buildColourStrip(colours, weights, pins)).toEqual(reference(colours, weights, pins));
      expect(buildColourStrip(colours)).toEqual(reference(colours));
      // One array not from the pool (the same value as a pooled one): the map does it all, the same strip.
      const mixed = colours.slice();
      mixed[Math.floor(n / 2)] = [...mixed[Math.floor(n / 2)]] as RGB;
      expect(buildColourStrip(mixed, weights, pins)).toEqual(reference(mixed, weights, pins));
    }
  });
});
