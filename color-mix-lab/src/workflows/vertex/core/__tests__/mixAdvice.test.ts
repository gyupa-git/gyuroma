import { describe, expect, it } from "vitest";
import type { PaletteEntry, PhysicalSlot, RGB } from "../types";
import { MIX_RESOLUTIONS, recommendMixOption, scoreMixOptions } from "../mixAdvice";

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
/** Saint Lily's palette and the spools in the printer, with measured shares. */
const PALETTE: PaletteEntry[] = [
  { index: 1, rgb: hex("#F7F7EF"), count: 266 },
  { index: 2, rgb: hex("#F7DEBD"), count: 126 },
  { index: 3, rgb: hex("#6BAD94"), count: 4 },
  { index: 4, rgb: hex("#BD8C5A"), count: 53 },
  { index: 5, rgb: hex("#298452"), count: 223 },
  { index: 6, rgb: hex("#E62963"), count: 13 },
  { index: 7, rgb: hex("#083A63"), count: 315 },
];
const SLOTS: PhysicalSlot[] = [
  filament("Azure", "#0682AC"),
  filament("Pink", "#E34A93"),
  filament("Yellow", "#EFD006"),
  filament("White", "#E6EAED"),
  filament("Navy", "#14127E"),
].map((f, i) => ({ slot: i + 1, filament: f, role: "" }));

describe("mix setting advice", () => {
  const scores = scoreMixOptions(PALETTE, SLOTS);

  it("rates every combination of mix width and ratio step", () => {
    expect(scores.length).toBe(2 * MIX_RESOLUTIONS.length);
    for (const score of scores) {
      expect(score.maxCycleLayers).toBeGreaterThan(0);
      expect(score.fidelity).toBeGreaterThanOrEqual(0);
    }
  });

  it("finds the coarse ratio steps that cannot reproduce a colour", () => {
    const thirds = scores.find((s) => s.recipeResolution === "thirds" && s.maxComponents === 2);
    expect(thirds!.lost).toBeGreaterThan(0);
    const grid10 = scores.find((s) => s.recipeResolution === "grid10" && s.maxComponents === 2);
    expect(grid10!.lost).toBe(0);
  });

  it("never picks a setting that loses a colour, or the widest stripes", () => {
    const pick = recommendMixOption(scores)!;
    expect(pick.lost).toBe(0);
    const finest = Math.min(...scores.filter((s) => s.lost === 0).map((s) => s.maxCycleLayers));
    const widest = Math.max(...scores.map((s) => s.maxCycleLayers));
    expect(pick.maxCycleLayers).toBeLessThan(widest);
    expect(pick.maxCycleLayers).toBeGreaterThanOrEqual(finest);
  });

  it("returns nothing without a palette or spools", () => {
    expect(scoreMixOptions([], SLOTS)).toEqual([]);
    expect(recommendMixOption([])).toBeNull();
  });
});
