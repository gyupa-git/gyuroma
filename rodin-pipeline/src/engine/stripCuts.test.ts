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

describe("cuts that keep the groups", () => {
  // One family of greens, light to dark, many shades with uneven areas: like a
  // model straight from an AI 3D generator, before any tidy.
  const shades: RGB[] = [];
  for (let i = 0; i < 60; i++) shades.push([20 + i, 120 + Math.round(i * 1.5), 40 + i]);
  const faces: RGB[] = [];
  shades.forEach((rgb, i) => {
    for (let n = 0; n < 5 + ((i * 7) % 23); n++) faces.push(rgb);
  });

  it("a fill moves faces, not colours: no other group gains or loses a shade", () => {
    const strip = buildColourStrip(faces);
    const cuts = initialCuts(strip, 4);
    const groups = groupsFromCuts(strip, cuts).filter((g) => g.colours.length > 0);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    const before = groupOf(groups);
    // Fill many faces of the lightest group with the darkest group's colour (a big patch picked + Enter).
    const lightest = groups[0];
    const darkest = groups[groups.length - 1];
    const lightKeys = new Set(lightest.colours.map((c) => c.key));
    let moved = 0;
    const next = faces.map((rgb) => {
      if (moved < 120 && lightKeys.has(colourKey(rgb))) {
        moved++;
        return darkest.rep;
      }
      return rgb;
    });
    const after = buildColourStrip(next);

    // The old cuts are shares of the family's area: with the areas changed they fall on other shades.
    const stale = groupOf(groupsFromCuts(after, cuts));
    const shifted = [...stale].filter(([key, group]) => before.has(key) && before.get(key) !== group);
    expect(shifted.length).toBeGreaterThan(0);

    // Cuts made to keep the groups: every shade still there stays where it was.
    const kept = groupOf(groupsFromCuts(after, cutsKeepingGroups(after, before)));
    for (const [key, group] of kept) if (before.has(key)) expect(group).toBe(before.get(key));
  });
});
