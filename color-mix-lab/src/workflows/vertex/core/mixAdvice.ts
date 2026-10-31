import { buildVirtualExtruderPlan, type VirtualExtruderPlanOptions } from "./virtualExtruders";
import { fidelityScore, scoreSlotSet, type SlotScoreOptions } from "./spoolAdvice";
import type { MixingRecipeResolution, PaletteEntry, PhysicalSlot } from "./types";

export const MIX_RESOLUTIONS: MixingRecipeResolution[] = [
  "thirds",
  "half-thirds",
  "grid25",
  "grid20",
  "grid10",
  "grid5",
];

export interface MixOptionScore {
  maxComponents: 1 | 2 | 3;
  recipeResolution: MixingRecipeResolution;
  /** 0-100, the same scale as the spool advice. */
  fidelity: number;
  meanError: number;
  /**
   * Longest layer period among the mixed colours.  A mix repeats every N
   * layers, and on a shallow surface that period is what shows up as contour
   * banding: the flatter the surface, the wider each ring.
   */
  maxCycleLayers: number;
  /** Palette colours this setting cannot reproduce at all. */
  lost: number;
  mixedColours: number;
}

/**
 * How much fidelity is worth giving up to halve the banding.  The pick is
 * "tightest stripes among the settings that stay within this much of the best
 * colour accuracy", which is a rule that can be read off the table rather than
 * a weighting nobody can check.
 */
export const MIX_FIDELITY_TOLERANCE = 0.2;

export function scoreMixOptions(
  palette: PaletteEntry[],
  slots: PhysicalSlot[],
  options: SlotScoreOptions = {},
  maxComponentsChoices: Array<2 | 3> = [2, 3],
): MixOptionScore[] {
  if (palette.length === 0 || slots.length === 0) return [];
  const out: MixOptionScore[] = [];
  for (const maxComponents of maxComponentsChoices) {
    for (const recipeResolution of MIX_RESOLUTIONS) {
      const scoreOptions: SlotScoreOptions = { ...options, maxComponents, recipeResolution };
      const score = scoreSlotSet(palette, slots, scoreOptions);
      const planOptions: Partial<VirtualExtruderPlanOptions> = {
        ...scoreOptions,
        virtualStartId: slots.length + 1,
        previewLightnessOffset: 0,
      };
      const plan = buildVirtualExtruderPlan(palette, slots, planOptions);
      const cycles = plan.virtualBlends
        .filter((blend) => blend.components.length > 1)
        .map((blend) => blend.sequence.length);
      out.push({
        maxComponents,
        recipeResolution,
        fidelity: fidelityScore(score),
        meanError: score.meanError,
        maxCycleLayers: cycles.length > 0 ? Math.max(...cycles) : 1,
        lost: score.lost.length,
        mixedColours: cycles.length,
      });
    }
  }
  return out;
}

/**
 * The setting to use: of those that can still print every colour, the one with
 * the tightest layer period that stays within MIX_FIDELITY_TOLERANCE of the
 * best fidelity on offer.
 */
export function recommendMixOption(scores: MixOptionScore[]): MixOptionScore | null {
  if (scores.length === 0) return null;
  const printable = scores.filter((score) => score.lost === 0);
  const pool = printable.length > 0 ? printable : scores;
  const best = Math.max(...pool.map((score) => score.fidelity));
  const threshold = best * (1 - MIX_FIDELITY_TOLERANCE);
  const candidates = pool.filter((score) => score.fidelity >= threshold);
  return candidates.reduce((winner, score) => {
    if (score.maxCycleLayers !== winner.maxCycleLayers) {
      return score.maxCycleLayers < winner.maxCycleLayers ? score : winner;
    }
    if (score.fidelity !== winner.fidelity) return score.fidelity > winner.fidelity ? score : winner;
    // Fewer filaments per mix is the simpler print: fewer tool changes.
    return score.maxComponents < winner.maxComponents ? score : winner;
  }, candidates[0]);
}
