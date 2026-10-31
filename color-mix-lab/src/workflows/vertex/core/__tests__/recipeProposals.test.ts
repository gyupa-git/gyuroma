import { describe, expect, it } from "vitest";
import type { PhysicalSlot, RGB } from "../types";
import { SEPARATION_DELTA_E, proposeRecipes, recipeCost, recipeScore } from "../recipeProposals";
import { colourDistance, rgbToLab } from "../prusaFdmMixer";

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const filament = (name: string, h: string) => ({
  name,
  type: "PLA",
  rgb: hex(h),
  effectiveRgb: hex(h),
  sourceLine: name,
});
const SLOTS: PhysicalSlot[] = [
  filament("Green", "#4CAF50"),
  filament("Pink", "#E34A93"),
  filament("Yellow", "#EFD006"),
  filament("White", "#E6EAED"),
  filament("Navy", "#14127E"),
].map((f, i) => ({ slot: i + 1, filament: f, role: "" }));
const TARGET = hex("#298452");
const CURRENT = { 1: 4, 5: 1 };

describe("recipe proposals", () => {
  const proposals = proposeRecipes(TARGET, SLOTS, CURRENT, {
    maxComponents: 3,
    recipeResolution: "grid10",
  });

  it("marks the mixture the row prints today", () => {
    const current = proposals.find((p) => p.isCurrent)!;
    expect(current.components.map((c) => c.extruder)).toEqual([1, 5]);
  });

  it("offers dropping each filament the mixture uses", () => {
    const without = proposals.filter((p) => p.kind === "without").map((p) => p.extruder);
    expect(without).toContain(1);
    expect(without).toContain(5);
    for (const proposal of proposals.filter((p) => p.kind === "without")) {
      expect(proposal.components.some((c) => c.extruder === proposal.extruder)).toBe(false);
    }
  });

  it("offers one row per number of filaments mixed, down to none at all", () => {
    const counts = proposals
      .filter((p) => p.kind === "mix")
      .map((p) => p.components.length)
      .sort();
    // One row per filament count, most mixing first, no duplicates.
    expect(counts).toContain(1);
    expect(new Set(counts).size).toBe(counts.length);
    const order = proposals.filter((p) => p.kind === "mix").map((p) => p.components.length);
    expect([...order]).toEqual([...order].sort((a, b) => b - a));
    const single = proposals.find((p) => p.components.length === 1)!;
    expect(single.cycleLayers).toBe(1);
  });

  it("picks the best ratio for each count by itself", () => {
    for (const proposal of proposals.filter((p) => p.kind === "mix")) {
      // Whatever ratio step produced it, the result is a whole-layer cycle.
      const sum = Object.values(proposal.counts).reduce((a, b) => a + b, 0);
      expect(proposal.cycleLayers).toBe(sum);
      expect(proposal.components.every((c) => Number.isInteger(c.count))).toBe(true);
    }
  });

  it("never lists the same mixture twice", () => {
    const keys = proposals.map((p) =>
      Object.entries(p.counts)
        .filter(([, c]) => c > 0)
        .map(([e, c]) => `${e}:${c}`)
        .sort()
        .join(","),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("charges mixing but not a single colour, and never scores below zero", () => {
    expect(recipeCost(5, 1, 1)).toBe(5);
    expect(recipeCost(5, 2, 10)).toBeGreaterThan(recipeCost(5, 2, 2));
    expect(recipeCost(5, 3, 10)).toBeGreaterThan(recipeCost(5, 2, 10));
    expect(recipeScore(80, 3, 20)).toBeGreaterThan(0);
    expect(recipeScore(0, 1, 1)).toBeCloseTo(100, 6);
  });

  it("returns nothing without filaments", () => {
    expect(proposeRecipes(TARGET, [], CURRENT)).toEqual([]);
  });
});

describe("colours that would merge into one", () => {
  const FACE = hex("#C6A88C");
  const CURRENT = { 1: 1, 2: 1, 3: 3 };

  it("will not quietly offer a colour that merges with another part", () => {
    // Tell the search that another part of the model already prints the colour
    // the plain single-filament answer would land on.
    const alone = proposeRecipes(FACE, SLOTS, CURRENT);
    const single = alone.find((p) => p.components.length === 1)!;
    const merged = proposeRecipes(FACE, SLOTS, CURRENT, {
      neighbours: [{ paletteIndex: 2, rgb: single.rgb }],
    });
    for (const proposal of merged) {
      const deltaE = colourDistance(rgbToLab(proposal.rgb), rgbToLab(single.rgb), "ciede2000");
      // Anything that close to the neighbour must say so on the row.
      if (deltaE < SEPARATION_DELTA_E) expect(proposal.collision?.paletteIndex).toBe(2);
    }
    // And the merging option is no longer the one it recommends.
    const best = merged.reduce((a, b) => (b.score > a.score ? b : a));
    expect(best.collision).toBeUndefined();
  });

  it("leaves a proposal alone when the other colours are far away", () => {
    const alone = proposeRecipes(FACE, SLOTS, CURRENT);
    const far = proposeRecipes(FACE, SLOTS, CURRENT, {
      neighbours: [{ paletteIndex: 2, rgb: [0, 0, 0] }],
    });
    expect(far.map((p) => Math.round(p.score))).toEqual(alone.map((p) => Math.round(p.score)));
    expect(far.every((p) => !p.collision)).toBe(true);
  });

  it("charges nothing once the colours are far enough apart", () => {
    expect(recipeCost(5, 1, 1, SEPARATION_DELTA_E + 1)).toBe(recipeCost(5, 1, 1));
    expect(recipeCost(5, 1, 1, 0)).toBeGreaterThan(recipeCost(5, 1, 1) + 25);
    expect(recipeScore(5, 1, 1, 0)).toBeLessThan(recipeScore(5, 1, 1));
  });
});

describe("the way back to automatic", () => {
  it("keeps the planner's own recipe on the list whatever is applied", () => {
    const auto = { 1: 1, 2: 1, 3: 3 };
    const applied = { 1: 1, 2: 1, 3: 2 };
    const list = proposeRecipes(hex("#C6A88C"), SLOTS, applied, { autoCounts: auto });
    const autoRow = list.find((p) => p.isAuto)!;
    expect(autoRow).toBeDefined();
    expect(autoRow.counts).toEqual(auto);
    expect(list.find((p) => p.isCurrent)!.counts).toEqual(applied);
  });

  it("marks one row as both when nothing has been changed", () => {
    const auto = { 1: 1, 2: 1, 3: 3 };
    const list = proposeRecipes(hex("#C6A88C"), SLOTS, auto, { autoCounts: auto });
    const row = list.find((p) => p.isCurrent)!;
    expect(row.isAuto).toBe(true);
    expect(list.filter((p) => p.isAuto).length).toBe(1);
  });
});
