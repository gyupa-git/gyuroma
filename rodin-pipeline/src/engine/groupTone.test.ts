import { describe, expect, it } from "vitest";
import { buildColourStrip, colourKey, familyOf, groupsFromCuts, initialCuts } from "@core/colourStrip";
import { rgbToLab } from "@core/prusaFdmMixer";
import type { RGB } from "@core/types";
import { NO_TONE, lightTo, toneColours } from "./groupTone";
import { cutsKeepingGroups } from "./stripCuts";

const greens: RGB[] = [
  [46, 136, 87],
  [40, 120, 76],
  [58, 150, 98],
  [34, 104, 66],
];
const shades = buildColourStrip(greens).families[0].colours;
const L = (rgb: RGB) => rgbToLab(rgb).L;
const C = (rgb: RGB) => Math.hypot(rgbToLab(rgb).a, rgbToLab(rgb).b);

describe("toning a group", () => {
  it("leaves every shade as it is at zero", () => {
    const out = toneColours(shades, NO_TONE);
    for (const shade of shades) expect(out.get(shade.key)).toEqual(shade.rgb);
  });

  it("lightens every shade and keeps their order (the shading stays)", () => {
    const out = toneColours(shades, { light: 40, chroma: 0, hue: 0 });
    const before = shades.map((s) => L(s.rgb));
    const after = shades.map((s) => L(out.get(s.key) as RGB));
    after.forEach((l, i) => expect(l).toBeGreaterThan(before[i] + 3));
    for (let i = 1; i < after.length; i++) expect(after[i]).toBeLessThan(after[i - 1]);
  });

  it("eases toward the next group's lightness and never crosses it", () => {
    const wall = { darkest: 35, lightest: 100 }; // the darkest shade is near L 38
    const out = toneColours(shades, { light: -100, chroma: 0, hue: 0 }, undefined, wall);
    const after = shades.map((s) => L(out.get(s.key) as RGB));
    for (const l of after) expect(l).toBeGreaterThan(wall.darkest - 0.6);
    for (let i = 1; i < after.length; i++) expect(after[i]).toBeLessThanOrEqual(after[i - 1] + 0.3);
    // far from any wall it moves almost the whole way, close to one a little
    expect(50 - lightTo(50, -5)).toBeGreaterThan(4.4);
    expect(lightTo(37, -30, wall)).toBeGreaterThan(35);
    expect(lightTo(37, -30, wall)).toBeLessThan(35.1);
    expect(lightTo(34, -10, wall)).toBe(34);
  });

  it("takes saturation down only as far as the family allows", () => {
    const out = toneColours(shades, { light: 0, chroma: -100, hue: 0 });
    for (const shade of shades) {
      const rgb = out.get(shade.key) as RGB;
      expect(C(rgb)).toBeLessThan(C(shade.rgb));
      expect(familyOf(rgbToLab(rgb))).toBe(shade.family);
    }
  });

  it("turns the hue but never out of the family", () => {
    const out = toneColours(shades, { light: 0, chroma: 0, hue: 100 });
    for (const shade of shades) expect(familyOf(rgbToLab(out.get(shade.key) as RGB))).toBe(shade.family);
    expect(out.get(shades[0].key)).not.toEqual(shades[0].rgb);
  });

  it("keeps every shade its own colour, even where two would meet", () => {
    // near white, lightening squeezes the shades together
    const pale: RGB[] = [
      [236, 240, 238],
      [238, 241, 239],
      [240, 243, 241],
    ];
    const palest = buildColourStrip(pale).families[0].colours;
    const plain = toneColours(palest, { light: 100, chroma: 0, hue: 0 });
    expect(new Set([...plain.values()].map(colourKey)).size).toBeLessThan(palest.length);
    const out = toneColours(palest, { light: 100, chroma: 0, hue: 0 }, new Set());
    expect(new Set([...out.values()].map(colourKey)).size).toBe(palest.length);
  });

  it("steps around another group's colour", () => {
    const plain = toneColours(shades, { light: 30, chroma: 0, hue: 0 });
    const landed = colourKey(plain.get(shades[0].key) as RGB);
    const out = toneColours(shades, { light: 30, chroma: 0, hue: 0 }, new Set([landed]));
    expect(colourKey(out.get(shades[0].key) as RGB)).not.toBe(landed);
  });
});

describe("cuts that keep the groups", () => {
  // six colours of one family, light to dark, equal area
  const grey = (v: number): RGB => [v, v, v];
  const colours = [250, 220, 190, 160, 130, 100].map(grey);
  const strip = buildColourStrip(colours);
  const keys = strip.families[0].colours.map((c) => c.key);
  const groupsOf = (names: string[]) => new Map(keys.map((key, i) => [key, names[i]]));

  it("cuts where the groups meet when they do not overlap", () => {
    const cuts = cutsKeepingGroups(strip, groupsOf(["a", "a", "b", "b", "c", "c"]))[0];
    expect(cuts.map((q) => +q.toFixed(4))).toEqual([0.3333, 0.6667]);
  });

  it("gives each group one band when they overlap, losing the least", () => {
    const cuts = cutsKeepingGroups(strip, groupsOf(["a", "a", "b", "a", "b", "b"]))[0];
    expect(cuts).toHaveLength(1);
    expect([0.3333, 0.6667]).toContain(+cuts[0].toFixed(4));
  });

  it("puts a group made lighter than its neighbour above it", () => {
    const cuts = cutsKeepingGroups(strip, groupsOf(["b", "b", "b", "a", "a", "a"]))[0];
    expect(cuts.map((q) => +q.toFixed(4))).toEqual([0.5]);
  });
});

describe("pinned pieces on the strip", () => {
  const grey = (v: number): RGB => [v, v, v];
  // a piece split off at the same lightness as the middle of the greys
  const colours = [...[240, 200, 160, 120, 80].map(grey), grey(161)];
  const pinKey = colourKey(grey(161));

  it("sit at the end of their family and get a band of their own", () => {
    const strip = buildColourStrip(colours, undefined, new Map([[pinKey, 0]]));
    const family = strip.families[0].colours;
    expect(family[family.length - 1].key).toBe(pinKey);
    const groups = groupsFromCuts(strip, initialCuts(strip, 2));
    const last = groups[groups.length - 1];
    expect(last.pinned).toBe(true);
    expect(last.colours.map((c) => c.key)).toEqual([pinKey]);
    expect(groups.filter((g) => !g.pinned).flatMap((g) => g.colours).map((c) => c.key)).not.toContain(pinKey);
  });

  it("without the pin the same colour falls in with its lightness", () => {
    const strip = buildColourStrip(colours);
    const family = strip.families[0].colours.map((c) => c.key);
    expect(family.indexOf(pinKey)).toBe(2);
  });
});
