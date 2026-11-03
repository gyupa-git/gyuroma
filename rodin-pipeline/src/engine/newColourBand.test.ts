import { describe, expect, it } from "vitest";
import { buildColourStrip, groupsFromCuts, initialCuts, colourKey, type StripGroup } from "@core/colourStrip";
import type { RGB } from "@core/types";
import { cutsKeepingGroups } from "./stripCuts";

/** Each colour key's group, as `family:index`. */
function groupOf(groups: StripGroup[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const group of groups) for (const colour of group.colours) out.set(colour.key, `${group.family}:${group.index}`);
  return out;
}

/**
 * A colour the model does not have, put down by a fill: pinned and under a group
 * name of its own it gets a band of its own — in the family where its lightness
 * would otherwise land it inside an existing band (11-03: a new tan went in as VE8).
 */
describe("a new fill colour's own band", () => {
  const blue: RGB = [60, 120, 200], tan: RGB = [220, 160, 90], white: RGB = [245, 245, 245], dark: RGB = [40, 40, 40];
  const faces: RGB[] = [];
  for (const [rgb, n] of [[blue, 300], [tan, 300], [white, 100], [dark, 100]] as [RGB, number][]) for (let i = 0; i < n; i++) faces.push(rgb);

  it.each([
    ["a blue inside the blue band's lightness", [42, 91, 215] as RGB],
    ["a tan between tan and dark", [137, 110, 86] as RGB],
  ])("%s gets a band of its own", (_name, fresh) => {
    const strip0 = buildColourStrip(faces);
    const cuts0 = initialCuts(strip0, 8);
    const groups0 = groupsFromCuts(strip0, cuts0).filter((g) => g.colours.length > 0);
    const groupOfKey = groupOf(groups0);
    const key = colourKey(fresh);
    expect(groupOfKey.has(key)).toBe(false);
    // The fill: 60 faces of blue take the new colour.
    let moved = 0;
    const next = faces.map((rgb) => (moved < 60 && rgb === blue ? (moved++, fresh) : rgb));
    groupOfKey.set(key, `new:${key}`);
    const pins = new Map([[key, 0]]);
    const strip = buildColourStrip(next, undefined, pins);
    const cuts = cutsKeepingGroups(strip, groupOfKey);
    const groups = groupsFromCuts(strip, cuts).filter((g) => g.colours.length > 0);
    expect(groups.length).toBe(groups0.length + 1);
    const own = groups.find((g) => g.colours.some((c) => c.key === key));
    expect(own).toBeDefined();
    expect(own!.colours.length).toBe(1);
    expect(own!.rep).toEqual(fresh);
    // Every other colour stays where it was.
    const after = groupOf(groups);
    for (const g of groups0) {
      const names = new Set(g.colours.map((c) => after.get(c.key)));
      expect(names.size).toBe(1);
    }
  });
});
