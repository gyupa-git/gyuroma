import { suggestPhysicalSlots, type SuggestionOptions } from "./filaments";
import {
  buildVirtualExtruderPlan,
  type VirtualExtruderPlanOptions,
} from "./virtualExtruders";
import { rgbToHex } from "./colour";
import { deltaE2000, rgbToLab } from "./prusaFdmMixer";
import type { Filament, PaletteEntry, PhysicalSlot, RGB } from "./types";

/**
 * How well one set of spools prints a model's palette.
 *
 * Every share is a fraction of the model's colour weight (triangle counts), so
 * "pureShare 0.6" means 60% of the model comes straight off one spool with no
 * layer mixing at all.  Mixing is what produces the striping that shows on a
 * figure, so a set with a higher pureShare usually looks cleaner even when its
 * colour error is marginally worse.
 */
export interface SlotSetScore {
  pureShare: number;
  twoShare: number;
  threeShare: number;
  /** Weight-averaged colour error the plan reports (linear RGB distance). */
  meanError: number;
  /** Number of mixed (virtual) colours the plan needs. */
  mixedColours: number;
  /**
   * Palette colours this set cannot reproduce at all.  The whole point is to
   * print the model's own colours, so a set that loses one is wrong however
   * good its averages look.
   */
  lost: LostColour[];
}

export interface LostColour {
  paletteIndex: number;
  /** The colour the model asks for. */
  rgb: RGB;
  /** The colour this set would actually print there. */
  achievedRgb: RGB;
  deltaE: number;
  /** Area share of the model, for reporting. */
  share: number;
}

/** Past this the printed colour is a different colour, not a near miss. */
export const LOST_COLOUR_DELTA_E = 15;
/** What losing one of the model's colours costs, in fidelity cost units. */
const LOST_COLOUR_COST = 22;

export interface SlotScoreOptions extends Partial<VirtualExtruderPlanOptions> {
  /**
   * Palette colours that matter more than their area — a flower's red centre is
   * 1% of the surface and the first thing anyone looks at.  They are scored as
   * if each covered `accentFloorShare` of the model.
   */
  accentIndices?: number[];
  accentFloorShare?: number;
}

export const DEFAULT_ACCENT_FLOOR_SHARE = 0.1;
/** An accent is small and vivid: a highlight, not a background. */
export const ACCENT_MAX_SHARE = 0.03;
export const ACCENT_MIN_SATURATION = 0.45;

/** Palette colours small enough and vivid enough to read as highlights. */
export function accentPaletteIndices(
  palette: PaletteEntry[],
  maxShare = ACCENT_MAX_SHARE,
  minSaturation = ACCENT_MIN_SATURATION,
): number[] {
  const total = palette.reduce((sum, entry) => sum + Math.max(0, entry.count), 0);
  if (total <= 0) return [];
  return palette
    .filter((entry) => {
      if (Math.max(0, entry.count) / total > maxShare) return false;
      const max = Math.max(...entry.rgb);
      const min = Math.min(...entry.rgb);
      return max > 0 && (max - min) / max >= minSaturation;
    })
    .map((entry) => entry.index);
}

export function scoreSlotSet(
  palette: PaletteEntry[],
  slots: PhysicalSlot[],
  options: SlotScoreOptions = {},
): SlotSetScore {
  const empty: SlotSetScore = {
    pureShare: 0,
    twoShare: 0,
    threeShare: 0,
    meanError: 0,
    mixedColours: 0,
    lost: [],
  };
  if (palette.length === 0 || slots.length === 0) return empty;

  // Accents are lifted to a floor weight before anything is measured, so a
  // flower's red centre is not averaged away by a cloak that covers a third of
  // the model.
  const rawTotal = palette.reduce((sum, entry) => sum + Math.max(0, entry.count), 0) || 1;
  const floor = (options.accentFloorShare ?? DEFAULT_ACCENT_FLOOR_SHARE) * rawTotal;
  const accents = new Set(options.accentIndices ?? []);
  const weightOf = new Map(
    palette.map((entry) => [
      entry.index,
      accents.has(entry.index) ? Math.max(Math.max(0, entry.count), floor) : Math.max(0, entry.count),
    ]),
  );
  const weightFor = (indices: number[]): number =>
    indices.reduce((sum, index) => sum + (weightOf.get(index) ?? 0), 0);
  const rgbOfIndex = new Map(palette.map((entry) => [entry.index, entry.rgb]));
  const shareOfIndex = new Map(
    palette.map((entry) => [entry.index, Math.max(0, entry.count) / rawTotal]),
  );
  const lost: LostColour[] = [];
  const checkLost = (indices: number[], achieved: RGB) => {
    for (const index of indices) {
      const target = rgbOfIndex.get(index);
      if (!target) continue;
      const deltaE = deltaE2000(rgbToLab(target), rgbToLab(achieved));
      if (deltaE > LOST_COLOUR_DELTA_E) {
        lost.push({
          paletteIndex: index,
          rgb: target,
          achievedRgb: achieved,
          deltaE,
          share: shareOfIndex.get(index) ?? 0,
        });
      }
    }
  };

  const plan = buildVirtualExtruderPlan(palette, slots, {
    ...options,
    virtualStartId: slots.length + 1,
    // The plan normally darkens its colours to preview how printed PLA looks.
    // Scoring compares them against the model's own colours, so that cosmetic
    // offset has to be off or every colour looks "lost".
    previewLightnessOffset: 0,
  });

  let pure = 0;
  let two = 0;
  let three = 0;
  let errorSum = 0;
  let total = 0;
  for (const entry of plan.physicalOnly) {
    const weight = weightFor(entry.targetPaletteIndices);
    pure += weight;
    total += weight;
    errorSum += entry.linearRgbError * weight;
    checkLost(entry.targetPaletteIndices, entry.physicalRgb);
  }
  for (const blend of plan.virtualBlends) {
    const weight = weightFor(blend.targetPaletteIndices);
    checkLost(blend.targetPaletteIndices, blend.displayRgb);
    if (blend.components.length <= 1) pure += weight;
    else if (blend.components.length === 2) two += weight;
    else three += weight;
    total += weight;
    errorSum += blend.linearRgbError * weight;
  }
  if (total <= 0) return empty;
  lost.sort((a, b) => b.deltaE - a.deltaE);
  return {
    pureShare: pure / total,
    twoShare: two / total,
    threeShare: three / total,
    meanError: errorSum / total,
    mixedColours: plan.virtualBlends.filter((blend) => blend.components.length > 1).length,
    lost,
  };
}

/**
 * Striping cost, in the same units as the plan's colour error.
 *
 * A colour that needs three filaments cycles over ten or more layers before it
 * repeats, so it reads as stripes on a figure; two filaments alternate quickly
 * and mostly read as a tint.  Charging a whole-model three-way mix 25 error
 * units (and a two-way mix 8) is what makes the search prefer "slightly less
 * exact but printed straight" over "exact but striped".
 */
const THREE_MIX_COST = 25;
const TWO_MIX_COST = 8;

export function slotSetCost(score: SlotSetScore): number {
  return (
    score.meanError +
    THREE_MIX_COST * score.threeShare +
    TWO_MIX_COST * score.twoShare +
    LOST_COLOUR_COST * score.lost.length
  );
}

/**
 * One number for "how faithfully this set of spools prints this model", 0-100.
 *
 * It folds the plan's colour error and its mixing cost (slotSetCost) into a
 * score that saturates: a perfect set is 100, and the curve flattens at the bad
 * end instead of going negative, so a hopeless set still compares with another
 * hopeless one.  Measured on the Saint Lily model: the spools in the printer
 * score 31, a shelf matched to the model's own palette 85, and the model's own
 * colours 98.
 */
const FIDELITY_FALLOFF = 24;

export function fidelityScore(score: SlotSetScore): number {
  return 100 * Math.exp(-slotSetCost(score) / FIDELITY_FALLOFF);
}

export interface SpoolRecommendation {
  slots: PhysicalSlot[];
  score: SlotSetScore;
  current: SlotSetScore;
  /** Inventory spools the recommendation leaves on the shelf. */
  unused: Filament[];
}

/**
 * Pick the best `count` spools out of what the user actually owns, and say how
 * that compares with the spools currently in the printer.
 */
export function recommendSpools(
  palette: PaletteEntry[],
  inventory: Filament[],
  currentSlots: PhysicalSlot[],
  count: number,
  options: {
    suggestion?: Partial<SuggestionOptions>;
    score?: SlotScoreOptions;
    /** Maximum plan evaluations spent refining the picker's answer. */
    searchBudget?: number;
  } = {},
): SpoolRecommendation | null {
  if (palette.length === 0 || inventory.length === 0) return null;
  const slotCount = Math.max(1, Math.round(count));
  const suggestionOptions: SuggestionOptions = {
    saturationPenalty: 0.3,
    diversityPenalty: 0.25,
    balance: 0.4,
    weightExponent: 0.4,
    neutralWeight: 0.5,
    maxComponents: 2,
    recipeResolution: "thirds",
    ...options.suggestion,
  };
  const seed = suggestPhysicalSlots(palette, inventory, slotCount, suggestionOptions);
  if (seed.length === 0) return null;

  // The filament picker scores mixes on its own; refine its answer against the
  // real plan, so the set is judged by what will actually be printed.
  const asSlots = (filaments: Filament[]): PhysicalSlot[] =>
    filaments.map((filament, index) => ({
      slot: index + 1,
      filament,
      role: index === 0 ? "lightest / base" : index === filaments.length - 1 ? "darkest / shadow" : "mixing colour",
    }));
  const cache = new Map<string, SlotSetScore>();
  const scoreOf = (filaments: Filament[]): SlotSetScore => {
    const key = filaments.map((f) => f.sourceLine || f.name).join("|");
    const cached = cache.get(key);
    if (cached) return cached;
    const score = scoreSlotSet(palette, asSlots(filaments), options.score);
    cache.set(key, score);
    return score;
  };

  let chosen = seed.map((slot) => slot.filament);
  let bestScore = scoreOf(chosen);
  let budget = options.searchBudget ?? 300;
  let improved = true;
  while (improved && budget > 0) {
    improved = false;
    const shelf = inventory.filter((filament) => !chosen.includes(filament));
    for (let index = 0; index < chosen.length && budget > 0; index++) {
      for (const candidate of shelf) {
        if (budget-- <= 0) break;
        const trial = [...chosen];
        trial[index] = candidate;
        const score = scoreOf(trial);
        if (slotSetCost(score) < slotSetCost(bestScore) - 1e-9) {
          chosen = trial;
          bestScore = score;
          improved = true;
          break;
        }
      }
    }
  }

  const slots = asSlots(chosen);
  const picked = new Set(chosen);
  return {
    slots,
    score: bestScore,
    current: scoreSlotSet(palette, currentSlots, options.score),
    unused: inventory.filter((filament) => !picked.has(filament)),
  };
}

export interface WantedColour {
  rgb: RGB;
  hex: string;
  /** Share of the model's colour weight this spool would carry. */
  share: number;
  /**
   * Closest spool on the shelf, however far off it is, so the panel can say
   * "you have this" / "you have something close" / "do you have this?".
   */
  nearest: { name: string; hex: string; deltaE: number } | null;
  /**
   * The concrete offer: which spool in the printer this colour would replace,
   * and what the fidelity does.  Null when this colour is already loaded.
   */
  swap: SwapOutcome | null;
  /**
   * Where this colour falls in the buy-one-at-a-time order, and the fidelity
   * before and after that step.  A colour can be worth having as part of the
   * set and still be a loss on its own (taking black out before the colours
   * that replace its shading arrive), so the order is what to act on.
   */
  step: { order: number; slot: number; replaced: string; before: number; after: number } | null;
}

export interface MixedColour {
  rgb: RGB;
  hex: string;
  /** Share of the model's colour weight that still has to be mixed. */
  share: number;
  /** How many spools this colour is layered from (2 or 3). */
  components: number;
}

export interface ColourWishlist {
  colours: WantedColour[];
  /**
   * What the proposed five do NOT cover: every palette colour that still has to
   * be layered together.  Only five spools fit, so each colour taken in pushes
   * another one into the mixer, and this is that cost.
   */
  mixed: MixedColour[];
  /** What the wishlist set would print like, against the spools in the printer now. */
  score: SlotSetScore;
  current: SlotSetScore;
}

/** A spool this close to the wanted colour prints the same thing. */
export const OWNED_COLOUR_DELTA_E = 6;
/** Further than this and the shelf has nothing that stands in for the colour. */
export const SIMILAR_COLOUR_DELTA_E = 16;

/**
 * The colours this model would like to be printed with, whether or not the user
 * owns them — the "do you have this green?" question.
 *
 * Candidates are the model's own palette colours: a spool of exactly that
 * colour prints that part of the model straight, with no layer mixing at all.
 * The search then keeps the `count` of them that serve the whole palette best,
 * because the leftover colours still have to be mixed from whatever is chosen.
 */
export function wantedSpoolColours(
  palette: PaletteEntry[],
  currentSlots: PhysicalSlot[],
  count: number,
  inventory: Filament[] = [],
  options: { score?: SlotScoreOptions; searchBudget?: number } = {},
): ColourWishlist | null {
  if (palette.length === 0) return null;
  const candidates: Filament[] = palette.map((entry) => ({
    name: rgbToHex(entry.rgb),
    type: "",
    rgb: entry.rgb,
    effectiveRgb: entry.rgb,
    sourceLine: rgbToHex(entry.rgb),
  }));
  const advice = recommendSpools(palette, candidates, currentSlots, count, {
    score: options.score,
    searchBudget: options.searchBudget,
  });
  if (!advice) return null;

  const totalWeight = palette.reduce((sum, entry) => sum + Math.max(0, entry.count), 0) || 1;
  const weightOf = new Map(palette.map((entry) => [entry.index, Math.max(0, entry.count)]));
  const plan = buildVirtualExtruderPlan(palette, advice.slots, {
    ...options.score,
    virtualStartId: advice.slots.length + 1,
  });
  // A mixed colour spreads its weight over the spools it is mixed from, so the
  // share reads as "how much of the model this spool is responsible for".
  const shareByExtruder = new Map<number, number>();
  const add = (extruder: number, weight: number) =>
    shareByExtruder.set(extruder, (shareByExtruder.get(extruder) ?? 0) + weight);
  for (const entry of plan.physicalOnly) {
    const weight = entry.targetPaletteIndices.reduce((sum, i) => sum + (weightOf.get(i) ?? 0), 0);
    add(entry.physicalExtruder, weight);
  }
  for (const blend of plan.virtualBlends) {
    const weight = blend.targetPaletteIndices.reduce((sum, i) => sum + (weightOf.get(i) ?? 0), 0);
    for (const component of blend.components) add(component.extruder, weight * component.ratio);
  }

  const owners = inventory.map((filament) => ({
    filament,
    lab: rgbToLab(filament.effectiveRgb),
  }));
  const colours: WantedColour[] = advice.slots.map((slot) => {
    const rgb = slot.filament.effectiveRgb;
    const lab = rgbToLab(rgb);
    let nearest: WantedColour["nearest"] = null;
    for (const candidate of owners) {
      const difference = deltaE2000(lab, candidate.lab);
      if (!nearest || difference < nearest.deltaE) {
        nearest = {
          name: candidate.filament.name,
          hex: rgbToHex(candidate.filament.effectiveRgb),
          deltaE: difference,
        };
      }
    }
    return {
      rgb,
      hex: rgbToHex(rgb),
      share: (shareByExtruder.get(slot.slot) ?? 0) / totalWeight,
      nearest,
      swap: bestSwapFor(palette, currentSlots, slot.filament, options.score),
      step: null,
    };
  });
  // Buying order: at every step take the colour that helps most right now, load
  // it, and judge the next one against the printer as it then stands.  A set is
  // only worth what it is worth together, so this is the path to it.
  const byHex = new Map(colours.map((colour) => [colour.hex, colour]));
  let working = currentSlots;
  const remaining = advice.slots.filter((slot) => byHex.has(rgbToHex(slot.filament.effectiveRgb)));
  for (let order = 1; remaining.length > 0; order++) {
    let best: { index: number; outcome: SwapOutcome } | null = null;
    remaining.forEach((slot, index) => {
      const outcome = bestSwapFor(palette, working, slot.filament, options.score);
      if (!outcome) return;
      if (!best || outcome.fidelityAfter - outcome.fidelityBefore > best.outcome.fidelityAfter - best.outcome.fidelityBefore) {
        best = { index, outcome };
      }
    });
    if (!best) break;
    const { index, outcome } = best as { index: number; outcome: SwapOutcome };
    const colour = byHex.get(rgbToHex(remaining[index].filament.effectiveRgb));
    if (colour) {
      colour.step = {
        order,
        slot: outcome.slot,
        replaced: outcome.replaced,
        before: outcome.fidelityBefore,
        after: outcome.fidelityAfter,
      };
    }
    working = working.map((slot) =>
      slot.slot === outcome.slot ? { ...slot, filament: remaining[index].filament } : slot,
    );
    remaining.splice(index, 1);
  }
  // Already-loaded colours last; otherwise follow the buying order.
  colours.sort((a, b) => (a.step?.order ?? Infinity) - (b.step?.order ?? Infinity) || b.share - a.share);

  const rgbOf = new Map(palette.map((entry) => [entry.index, entry.rgb]));
  const mixed: MixedColour[] = [];
  for (const blend of plan.virtualBlends) {
    if (blend.components.length < 2) continue;
    for (const index of blend.targetPaletteIndices) {
      const rgb = rgbOf.get(index);
      if (!rgb) continue;
      mixed.push({
        rgb,
        hex: rgbToHex(rgb),
        share: (weightOf.get(index) ?? 0) / totalWeight,
        components: blend.components.length,
      });
    }
  }
  mixed.sort((a, b) => b.share - a.share);
  return { colours, mixed, score: advice.score, current: advice.current };
}

export interface SwapOutcome {
  /** 1-based slot this spool would take. */
  slot: number;
  /** Name of the spool it pushes out of the printer. */
  replaced: string;
  before: SlotSetScore;
  after: SlotSetScore;
  /** Positive = more of the model prints without mixing. */
  pureDelta: number;
  /** Positive = more three-filament mixing, which is the striping. */
  threeDelta: number;
  /** Negative = colours come out closer to the model. */
  errorDelta: number;
  /** Negative = better overall by the same measure the recommender uses. */
  costDelta: number;
  /** Fidelity (0-100) now, and with this spool loaded. */
  fidelityBefore: number;
  fidelityAfter: number;
}

/**
 * What putting this spool in would do — and what it would cost, because the
 * spool it displaces still has to be mixed from what remains.  The slot that
 * loses the least is the one reported.
 */
export function bestSwapFor(
  palette: PaletteEntry[],
  slots: PhysicalSlot[],
  filament: Filament,
  options: SlotScoreOptions = {},
): SwapOutcome | null {
  if (palette.length === 0 || slots.length === 0) return null;
  const before = scoreSlotSet(palette, slots, options);
  let best: SwapOutcome | null = null;
  for (let index = 0; index < slots.length; index++) {
    const current = slots[index].filament;
    if (sameColour(current.effectiveRgb, filament.effectiveRgb)) return null;
    const trial = slots.map((slot, i) =>
      i === index ? { ...slot, filament } : slot,
    );
    const after = scoreSlotSet(palette, trial, options);
    const costDelta = slotSetCost(after) - slotSetCost(before);
    if (best && costDelta >= best.costDelta) continue;
    best = {
      slot: slots[index].slot,
      replaced: current.name,
      before,
      after,
      pureDelta: after.pureShare - before.pureShare,
      threeDelta: after.threeShare - before.threeShare,
      errorDelta: after.meanError - before.meanError,
      costDelta,
      fidelityBefore: fidelityScore(before),
      fidelityAfter: fidelityScore(after),
    };
  }
  return best;
}

function sameColour(a: RGB, b: RGB): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
