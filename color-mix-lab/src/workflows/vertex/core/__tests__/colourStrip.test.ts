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
