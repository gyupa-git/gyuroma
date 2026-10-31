import { describe, expect, it } from "vitest";
import type { PaletteEntry, PhysicalSlot, RGB } from "../types";
import { buildVirtualExtruderPlan } from "../virtualExtruders";
import { applyRecipeOverridesToPlan, blendFromCounts, normaliseRecipeCounts } from "../recipeOverrides";

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
  filament("Azure", "#0682AC"),
  filament("Pink", "#E34A93"),
  filament("Yellow", "#EFD006"),
  filament("White", "#E6EAED"),
  filament("Navy", "#14127E"),
].map((f, i) => ({ slot: i + 1, filament: f, role: "" }));
const PALETTE: PaletteEntry[] = [
  { index: 1, rgb: hex("#298452"), count: 200 },
  { index: 2, rgb: hex("#C6A88C"), count: 100 },
];

function plan() {
  return buildVirtualExtruderPlan(PALETTE, SLOTS, { virtualStartId: 6, previewLightnessOffset: 0 });
}

describe("hand-set mixtures", () => {
  it("drops the filaments set to zero and keeps whole layers", () => {
    expect(normaliseRecipeCounts({ 1: 3, 2: 0, 3: 1.4, 4: -2 })).toEqual([
      { extruder: 1, count: 3 },
      { extruder: 3, count: 1 },
    ]);
  });

  it("rebuilds one row's layer order, colour and error", () => {
    const base = plan();
    const blend = base.virtualBlends[0];
    const rebuilt = blendFromCounts(
      blend,
      { 1: 3, 5: 1 },
      SLOTS,
      [{ rgb: hex("#298452"), weight: 1 }],
    )!;
    expect(rebuilt.sequence.length).toBe(4);
    expect(rebuilt.components.map((c) => c.extruder)).toEqual([1, 5]);
    expect(rebuilt.components[0].ratio).toBeCloseTo(0.75, 6);
    expect(rebuilt.displayRgb).not.toEqual(blend.displayRgb);
    expect(rebuilt.linearRgbError).toBeGreaterThan(0);
  });

  it("changes only the row it is given", () => {
    const base = plan();
    const target = base.virtualBlends[0];
    const others = base.virtualBlends.slice(1);
    const next = applyRecipeOverridesToPlan(base, PALETTE, SLOTS, {
      [target.targetPaletteIndices[0]]: { counts: { 1: 1, 4: 1 } },
    });
    const changed = next.virtualBlends.find((b) => b.virtualId === target.virtualId)!;
    expect(changed.components.map((c) => c.extruder)).toEqual([1, 4]);
    for (const other of others) {
      const after = next.virtualBlends.find((b) => b.virtualId === other.virtualId)!;
      expect(after.components).toEqual(other.components);
      expect(after.displayRgb).toEqual(other.displayRgb);
    }
  });

  it("turns a mixture reduced to one filament into a plain physical colour", () => {
    const base = plan();
    const target = base.virtualBlends[0];
    const paletteIndex = target.targetPaletteIndices[0];
    const next = applyRecipeOverridesToPlan(base, PALETTE, SLOTS, {
      [paletteIndex]: { counts: { 1: 1 } },
    });
    expect(next.virtualBlends.some((b) => b.virtualId === target.virtualId)).toBe(false);
    const physical = next.physicalOnly.find((p) => p.targetPaletteIndices.includes(paletteIndex))!;
    expect(physical.physicalExtruder).toBe(1);
    expect(next.paletteToAssignment.get(paletteIndex)).toEqual({ kind: "physical", extruder: 1 });
  });

  it("leaves the plan untouched when there is no override", () => {
    const base = plan();
    expect(applyRecipeOverridesToPlan(base, PALETTE, SLOTS, {})).toBe(base);
  });
});
