import { describe, expect, it } from "vitest";
import type { Filament, PaletteEntry, PhysicalSlot, RGB } from "../types";
import {
  accentPaletteIndices,
  wantedSpoolColours,
  bestSwapFor,
  fidelityScore,
  recommendSpools,
  scoreSlotSet,
  slotSetCost,
} from "../spoolAdvice";
import { makeSlots } from "./fixtures";

function filament(name: string, rgb: RGB): Filament {
  return { name, type: "PLA", rgb, effectiveRgb: rgb, sourceLine: `${name}; PLA` };
}

function slotsOf(filaments: Filament[]): PhysicalSlot[] {
  return filaments.map((f, i) => ({ slot: i + 1, filament: f, role: "" }));
}

/** A model that is mostly green and navy, with a little white. */
const PALETTE: PaletteEntry[] = [
  { index: 1, rgb: [41, 132, 82], count: 500 },
  { index: 2, rgb: [8, 58, 99], count: 400 },
  { index: 3, rgb: [247, 247, 239], count: 100 },
];

const GREEN = filament("Green", [41, 132, 82]);
const NAVY = filament("Navy", [8, 58, 99]);
const WHITE = filament("White", [247, 247, 239]);
const SHELF = [
  GREEN,
  NAVY,
  WHITE,
  filament("Azure", [6, 130, 172]),
  filament("Yellow", [239, 208, 6]),
  filament("Pink", [227, 74, 147]),
  filament("Black", [36, 41, 42]),
];

describe("spool advice", () => {
  it("counts how much of the model prints without mixing", () => {
    const score = scoreSlotSet(PALETTE, slotsOf([GREEN, NAVY, WHITE]));
    expect(score.pureShare).toBeCloseTo(1, 2);
    expect(score.threeShare).toBe(0);
    expect(score.meanError).toBeLessThan(1);
  });

  it("charges mixing on top of the colour error", () => {
    const mixed = { pureShare: 0, twoShare: 0, threeShare: 1, meanError: 5, mixedColours: 3, lost: [] };
    const pure = { pureShare: 1, twoShare: 0, threeShare: 0, meanError: 12, mixedColours: 0, lost: [] };
    // A fully three-way-mixed plan loses to a slightly less exact pure one.
    expect(slotSetCost(mixed)).toBeGreaterThan(slotSetCost(pure));
  });

  it("picks the spools the model actually needs out of the shelf", () => {
    const current = makeSlots(["#0682AC", "#E34A93", "#EFD006", "#E6EAED", "#24292A"]);
    const advice = recommendSpools(PALETTE, SHELF, current, 3);
    expect(advice).not.toBeNull();
    const names = advice!.slots.map((slot) => slot.filament.name).sort();
    expect(names).toEqual(["Green", "Navy", "White"]);
    // The spools that stay on the shelf are reported, so nothing vanishes silently.
    expect(advice!.unused.map((f) => f.name).sort()).toEqual(["Azure", "Black", "Pink", "Yellow"]);
    expect(advice!.score.pureShare).toBeGreaterThan(advice!.current.pureShare);
    expect(advice!.score.meanError).toBeLessThan(advice!.current.meanError);
  });

  it("returns nothing when there is no palette or no inventory", () => {
    expect(recommendSpools([], SHELF, [], 5)).toBeNull();
    expect(recommendSpools(PALETTE, [], [], 5)).toBeNull();
  });
});

describe("swap comparison", () => {
  const LOADED = slotsOf([
    filament("Azure", [6, 130, 172]),
    filament("Pink", [227, 74, 147]),
    filament("Yellow", [239, 208, 6]),
    filament("White", [247, 247, 239]),
    filament("Black", [36, 41, 42]),
  ]);

  it("names the slot a spool would take and what it displaces", () => {
    const outcome = bestSwapFor(PALETTE, LOADED, GREEN);
    expect(outcome).not.toBeNull();
    expect(outcome!.slot).toBeGreaterThanOrEqual(1);
    expect(LOADED.some((slot) => slot.filament.name === outcome!.replaced)).toBe(true);
    // Printing the green straight removes mixing from a fifth of the model.
    expect(outcome!.pureDelta).toBeGreaterThan(0);
    expect(outcome!.costDelta).toBeLessThan(0);
  });

  it("counts the displaced colour, so a useless spool scores badly", () => {
    const useless = filament("Lilac", [123, 79, 160]);
    const good = bestSwapFor(PALETTE, LOADED, NAVY)!;
    const bad = bestSwapFor(PALETTE, LOADED, useless)!;
    expect(bad.costDelta).toBeGreaterThan(good.costDelta);
  });

  it("says nothing for a spool already loaded", () => {
    expect(bestSwapFor(PALETTE, LOADED, filament("Azure again", [6, 130, 172]))).toBeNull();
  });
});

describe("fidelity score", () => {
  it("is 100 for a set that prints every colour straight and exact", () => {
    const score = scoreSlotSet(PALETTE, slotsOf([GREEN, NAVY, WHITE]));
    expect(fidelityScore(score)).toBeGreaterThan(97);
  });

  it("falls as mixing and colour error rise, and never goes negative", () => {
    const striped = { pureShare: 0, twoShare: 0, threeShare: 1, meanError: 30, mixedColours: 5, lost: [] };
    expect(fidelityScore(striped)).toBeLessThan(15);
    expect(fidelityScore(striped)).toBeGreaterThan(0);
  });

  it("moves in step with the swap it describes", () => {
    const loaded = slotsOf([
      filament("Azure", [6, 130, 172]),
      filament("Pink", [227, 74, 147]),
      filament("Yellow", [239, 208, 6]),
      filament("White", [247, 247, 239]),
      filament("Black", [36, 41, 42]),
    ]);
    const outcome = bestSwapFor(PALETTE, loaded, GREEN)!;
    expect(outcome.fidelityAfter).toBeGreaterThan(outcome.fidelityBefore);
    expect(outcome.fidelityBefore).toBeCloseTo(fidelityScore(outcome.before), 6);
  });
});

describe("colours the set cannot make", () => {
  /** Mostly green and navy, with a tiny vivid pink highlight. */
  const WITH_ACCENT: PaletteEntry[] = [
    { index: 1, rgb: [41, 132, 82], count: 500 },
    { index: 2, rgb: [8, 58, 99], count: 400 },
    { index: 3, rgb: [247, 247, 239], count: 90 },
    { index: 4, rgb: [230, 41, 99], count: 10 },
  ];
  const PINK = filament("Pink", [230, 41, 99]);

  it("flags a palette colour that comes out as a different colour", () => {
    const without = scoreSlotSet(WITH_ACCENT, slotsOf([GREEN, NAVY, WHITE]));
    expect(without.lost.map((entry) => entry.paletteIndex)).toContain(4);
    const with_ = scoreSlotSet(WITH_ACCENT, slotsOf([GREEN, NAVY, WHITE, PINK]));
    expect(with_.lost).toEqual([]);
  });

  it("scores losing a colour below any averaging gain", () => {
    const keepsPink = scoreSlotSet(WITH_ACCENT, slotsOf([GREEN, NAVY, WHITE, PINK]));
    const dropsPink = scoreSlotSet(WITH_ACCENT, slotsOf([GREEN, NAVY, WHITE, filament("Grey", [128, 128, 128])]));
    expect(fidelityScore(keepsPink)).toBeGreaterThan(fidelityScore(dropsPink));
    expect(slotSetCost(dropsPink) - slotSetCost(keepsPink)).toBeGreaterThan(15);
  });

  it("treats a small vivid colour as an accent, not as 1% of the model", () => {
    expect(accentPaletteIndices(WITH_ACCENT)).toEqual([4]);
    const options = { accentIndices: accentPaletteIndices(WITH_ACCENT) };
    const dropsPink = scoreSlotSet(WITH_ACCENT, slotsOf([GREEN, NAVY, WHITE, filament("Grey", [128, 128, 128])]), options);
    // Without the accent floor the pink would be 1% of the weight and invisible.
    expect(dropsPink.pureShare).toBeLessThan(0.95);
  });
});

describe("buying order", () => {
  const LOADED = slotsOf([
    filament("Azure", [6, 130, 172]),
    filament("Pink", [227, 74, 147]),
    filament("Yellow", [239, 208, 6]),
    filament("White", [247, 247, 239]),
    filament("Black", [36, 41, 42]),
  ]);

  it("orders the wanted colours so that every step is an improvement", () => {
    const wishlist = wantedSpoolColours(PALETTE, LOADED, 3, []);
    expect(wishlist).not.toBeNull();
    const steps = wishlist!.colours
      .map((colour) => colour.step)
      .filter((step): step is NonNullable<typeof step> => step !== null)
      .sort((a, b) => a.order - b.order);
    expect(steps.length).toBeGreaterThan(0);
    // Each step starts where the previous one ended: a path, not five guesses.
    steps.forEach((step, index) => {
      expect(step.order).toBe(index + 1);
      if (index > 0) expect(step.before).toBeCloseTo(steps[index - 1].after, 6);
    });
    expect(steps[0].after).toBeGreaterThan(steps[0].before);
  });
});
