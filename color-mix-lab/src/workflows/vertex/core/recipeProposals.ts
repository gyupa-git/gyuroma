import { buildCanonicalCycle } from "./virtualExtruders";
import { colourDistance, mixFilamentsRgb, rgbToLab } from "./prusaFdmMixer";
import type { ColourDifferenceMetric, MixingRecipeResolution, PhysicalSlot, RGB } from "./types";

/**
 * Why a proposal is on the list.  The ratios are the planner's job; the choice
 * worth offering is how many filaments to mix — three, two, or one — plus
 * dropping a particular filament that jumps out of the figure.
 */
export type RecipeProposalKind = "mix" | "without";

export interface RecipeProposal {
  kind: RecipeProposalKind;
  /** True for the mixture the row prints today. */
  isCurrent: boolean;
  /** True for what the planner chose before any hand edit — always offered. */
  isAuto: boolean;
  /** Filament dropped (kind "without") or used alone (kind "single"). */
  extruder?: number;
  counts: Record<number, number>;
  components: Array<{ extruder: number; count: number; ratio: number }>;
  /** Layers in one repeat; 1 means no mixing at all. */
  cycleLayers: number;
  /** The printed layer order of one repeat, as extruder numbers. */
  sequence: number[];
  deltaE: number;
  /** Predicted printed colour. */
  rgb: RGB;
  /** 0-100, colour accuracy, banding and separation together: for ordering only. */
  score: number;
  /**
   * How hard this mixture is to print, 1 (one filament, no stripes) to 5
   * (three filaments over a long repeat).  Kept apart from the colour error so
   * the trade is the user's to make, not a weighting hidden in one number.
   */
  difficulty: number;
  /**
   * Another of the model's colours this one would become indistinguishable
   * from.  A face printed in the flower's filament is a worse outcome than any
   * colour error, because the shape stops reading at all.
   */
  collision?: { paletteIndex: number; rgb: RGB; deltaE: number };
}

/**
 * What the banding costs, in the same units as the colour error.
 *
 * Two filaments alternating read as a tint; three or more read as stripes, and
 * a long repeat spreads those stripes wide enough to see on a shallow surface.
 * A single filament has no repeat at all, so it is charged nothing — which is
 * why a plain colour can beat a mixture that matches better.
 */
const TWO_MIX_COST = 8;
const MANY_MIX_COST = 25;
const FULL_STRIPE_CYCLE = 10;
const SCORE_FALLOFF = 24;
/** Below this the two colours read as the same colour on the print. */
export const SEPARATION_DELTA_E = 9;
/** What losing the line between two of the model's colours costs. */
const COLLISION_COST = 30;

export function recipeCost(
  deltaE: number,
  componentCount: number,
  cycleLayers: number,
  collisionDeltaE: number | null = null,
): number {
  const mixing =
    componentCount <= 1
      ? 0
      : (componentCount === 2 ? TWO_MIX_COST : MANY_MIX_COST) *
        Math.min(1, cycleLayers / FULL_STRIPE_CYCLE);
  // The closer it lands to another of the model's colours, the more of the
  // charge applies: at the threshold nothing, at zero distance all of it.
  const collision =
    collisionDeltaE === null || collisionDeltaE >= SEPARATION_DELTA_E
      ? 0
      : COLLISION_COST * (1 - collisionDeltaE / SEPARATION_DELTA_E);
  return deltaE + mixing + collision;
}

export function recipeScore(
  deltaE: number,
  componentCount: number,
  cycleLayers: number,
  collisionDeltaE: number | null = null,
): number {
  return 100 * Math.exp(-recipeCost(deltaE, componentCount, cycleLayers, collisionDeltaE) / SCORE_FALLOFF);
}

export interface NeighbourColour {
  paletteIndex: number;
  /** The colour that palette entry will actually print as. */
  rgb: RGB;
}

export interface ProposalOptions {
  /** The model's other colours, so a proposal that collides with one is caught. */
  neighbours?: NeighbourColour[];
  /**
   * What the planner chose for this colour before any hand edit.  It stays on
   * the list whatever is applied, so there is always a way back to automatic.
   */
  autoCounts?: Record<number, number>;
  maxComponents?: 1 | 2 | 3;
  recipeResolution?: MixingRecipeResolution;
  colourDifferenceMetric?: ColourDifferenceMetric;
  purePhysicalThreshold?: number;
}

function countsKey(counts: Record<number, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([extruder, count]) => `${extruder}:${count}`)
    .sort()
    .join(",");
}

/**
 * A short list of mixtures for one colour, each scored, so the choice is made
 * by picking rather than by typing layer counts.
 *
 * `currentCounts` is whatever the row prints today — it is always first, so the
 * others can be read as "versus what I have".
 */
export function proposeRecipes(
  targetRgb: RGB,
  slots: PhysicalSlot[],
  currentCounts: Record<number, number>,
  options: ProposalOptions = {},
): RecipeProposal[] {
  if (slots.length === 0) return [];
  const metric = options.colourDifferenceMetric ?? "ciede2000";
  const proposals: RecipeProposal[] = [];

  const current = currentProposal(targetRgb, slots, currentCounts, metric, options.neighbours ?? []);
  if (current) proposals.push(current);

  if (options.autoCounts) {
    const auto = currentProposal(targetRgb, slots, options.autoCounts, metric, options.neighbours ?? []);
    if (auto) proposals.push({ ...auto, isCurrent: false, isAuto: true });
  }

  // One row per "how many filaments", each at its own best ratio: the planner
  // is asked for every ratio step and the highest scoring answer is kept, so
  // the only decision left is how much mixing to accept.
  for (const count of [3, 2, 1] as const) {
    if (count > slots.length) continue;
    const best = bestWithComponentCount(targetRgb, slots, count, metric, options.neighbours ?? []);
    if (best) proposals.push(best);
  }

  // What is left when a filament in the current mixture is dropped — the way
  // out when one colour is the problem rather than the amount of mixing.
  for (const extruder of Object.keys(currentCounts).map(Number)) {
    if (!(currentCounts[extruder] > 0)) continue;
    const without = slots.filter((slot) => slot.slot !== extruder);
    if (without.length === 0) continue;
    const cap = Math.min(options.maxComponents ?? 3, without.length) as 1 | 2 | 3;
    const proposal = bestWithComponentCount(targetRgb, without, cap, metric, options.neighbours ?? []);
    if (proposal) proposals.push({ ...proposal, kind: "without", extruder });
  }

  // One entry per distinct mixture.  When a generated option turns out to be
  // what the row already prints, the two are the same row — it keeps the
  // "this is what you have" mark rather than being listed twice.
  const byKey = new Map<string, RecipeProposal>();
  for (const proposal of proposals) {
    const key = countsKey(proposal.counts);
    if (key === "") continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, proposal);
      continue;
    }
    if (proposal.isCurrent) existing.isCurrent = true;
    if (proposal.isAuto) existing.isAuto = true;
  }
  // Most mixing first (3 → 2 → 1), then the "without" alternatives.
  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "mix" ? -1 : 1;
    if (a.components.length !== b.components.length) return b.components.length - a.components.length;
    return b.score - a.score;
  });
}

/** Longest repeat worth offering: beyond this the stripes are wider than the detail. */
const MAX_CYCLE_LAYERS = 12;

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const out: T[][] = [];
  const walk = (start: number, current: T[]) => {
    if (current.length === size) {
      out.push([...current]);
      return;
    }
    for (let i = start; i <= items.length - (size - current.length); i++) {
      current.push(items[i]);
      walk(i + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return out;
}

/** Every way to split `total` layers between `parts` filaments, each at least one. */
function compositions(total: number, parts: number): number[][] {
  if (parts === 1) return [[total]];
  const out: number[][] = [];
  for (let first = 1; first <= total - (parts - 1); first++) {
    for (const rest of compositions(total - first, parts - 1)) out.push([first, ...rest]);
  }
  return out;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The best recipe that mixes exactly `count` filaments.
 *
 * The ratio is not the user's decision — this searches every whole-layer split
 * up to a twelve layer repeat and keeps the one that scores best, so the only
 * thing left to choose is how many filaments to involve.
 */
function nearestNeighbour(
  rgb: RGB,
  neighbours: NeighbourColour[],
  metric: ColourDifferenceMetric,
): { paletteIndex: number; rgb: RGB; deltaE: number } | null {
  const lab = rgbToLab(rgb);
  let best: { paletteIndex: number; rgb: RGB; deltaE: number } | null = null;
  for (const neighbour of neighbours) {
    const deltaE = colourDistance(lab, rgbToLab(neighbour.rgb), metric);
    if (!best || deltaE < best.deltaE) best = { paletteIndex: neighbour.paletteIndex, rgb: neighbour.rgb, deltaE };
  }
  return best;
}

export function bestWithComponentCount(
  targetRgb: RGB,
  slots: PhysicalSlot[],
  count: 1 | 2 | 3,
  metric: ColourDifferenceMetric = "ciede2000",
  neighbours: NeighbourColour[] = [],
): RecipeProposal | null {
  const targetLab = rgbToLab(targetRgb);
  let best: RecipeProposal | null = null;
  for (const subset of combinations(slots, count)) {
    const rgbs = subset.map((slot) => slot.filament.effectiveRgb);
    for (let cycle = count; cycle <= (count === 1 ? 1 : MAX_CYCLE_LAYERS); cycle++) {
      for (const split of compositions(cycle, count)) {
        // 2:2 prints the same as 1:1; keep the short form only.
        if (split.reduce((g, value) => gcd(g, value)) !== 1) continue;
        const mixed = mixFilamentsRgb(
          split.map((layers, index) => ({ rgb: rgbs[index], ratio: layers / cycle })),
        );
        const deltaE = colourDistance(targetLab, mixed.lab, metric);
        const collision = nearestNeighbour(mixed.rgb, neighbours, metric);
        const score = recipeScore(deltaE, count, cycle, collision?.deltaE ?? null);
        if (best && score <= best.score) continue;
        const { sequence } = buildCanonicalCycle(
          subset.map((slot, index) => ({
            extruder: slot.slot,
            ratio: split[index],
            count: split[index],
          })),
        );
        best = {
          kind: "mix",
          isCurrent: false,
          isAuto: false,
          sequence,
          extruder: count === 1 ? subset[0].slot : undefined,
          counts: Object.fromEntries(subset.map((slot, index) => [slot.slot, split[index]])),
          components: subset.map((slot, index) => ({
            extruder: slot.slot,
            count: split[index],
            ratio: split[index] / cycle,
          })),
          cycleLayers: cycle,
          deltaE,
          rgb: mixed.rgb,
          score,
          difficulty: recipeDifficulty(count, cycle),
          collision:
            collision && collision.deltaE < SEPARATION_DELTA_E ? collision : undefined,
        };
      }
    }
  }
  return best;
}

function currentProposal(
  targetRgb: RGB,
  slots: PhysicalSlot[],
  counts: Record<number, number>,
  metric: ColourDifferenceMetric,
  neighbours: NeighbourColour[] = [],
): RecipeProposal | null {
  const active = Object.entries(counts)
    .map(([extruder, count]) => ({ extruder: Number(extruder), count: Math.max(0, Math.round(count)) }))
    .filter((entry) => entry.count > 0);
  if (active.length === 0) return null;
  const cycle = active.reduce((sum, entry) => sum + entry.count, 0);
  const rgbOf = (extruder: number): RGB =>
    slots.find((slot) => slot.slot === extruder)?.filament.effectiveRgb ?? [120, 120, 120];
  // Predict with the same mixer the plan uses by asking it for this exact recipe.
  const mixed = mixFilamentsRgb(
    active.map((entry) => ({ rgb: rgbOf(entry.extruder), ratio: entry.count / cycle })),
  ).rgb;
  const deltaE = colourDistance(rgbToLab(targetRgb), rgbToLab(mixed), metric);
  const collision = nearestNeighbour(mixed, neighbours, metric);
  const { sequence } = buildCanonicalCycle(
    active.map((entry) => ({ extruder: entry.extruder, ratio: entry.count, count: entry.count })),
  );
  return {
    kind: "mix",
    isCurrent: true,
    sequence,
    isAuto: false,
    collision: collision && collision.deltaE < SEPARATION_DELTA_E ? collision : undefined,
    counts: Object.fromEntries(active.map((entry) => [entry.extruder, entry.count])),
    components: active.map((entry) => ({ ...entry, ratio: entry.count / cycle })),
    cycleLayers: cycle,
    deltaE,
    rgb: mixed,
    score: recipeScore(deltaE, active.length, cycle, collision?.deltaE ?? null),
    difficulty: recipeDifficulty(active.length, cycle),
  };
}

/** 1 (plain colour) to 5 (three filaments, long repeat). */
export function recipeDifficulty(componentCount: number, cycleLayers: number): number {
  if (componentCount <= 1) return 1;
  if (componentCount === 2) return cycleLayers <= 4 ? 2 : 3;
  return cycleLayers <= 5 ? 4 : 5;
}
