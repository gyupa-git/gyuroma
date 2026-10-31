import { buildCanonicalCycle } from "./virtualExtruders";
import type {
  VirtualBlendComponent,
  VirtualBlendEntry,
  VirtualExtruderPlan,
} from "./virtualExtruders";
import { colourDistance, mixFilamentsRgb, rgbToLab } from "./prusaFdmMixer";
import type {
  ColourDifferenceMetric,
  PaletteEntry,
  PhysicalSlot,
  RGB,
} from "./types";

/**
 * A mixture the user set by hand, as whole layers per physical extruder.
 *
 * The automatic planner chases the closest colour, which sometimes reaches for
 * a filament that jumps out of the figure (a vivid pink inside a muted green).
 * This lets one row be re-mixed — or a filament dropped from it — without
 * touching any other colour.
 */
export interface RecipeOverride {
  /** Layers of each physical extruder in one cycle; zero drops that filament. */
  counts: Record<number, number>;
}

export interface RecipeOverrideOptions {
  colourDifferenceMetric?: ColourDifferenceMetric;
}

function weightedAverageRgb(parts: Array<{ rgb: RGB; weight: number }>): RGB {
  const total = parts.reduce((sum, part) => sum + part.weight, 0) || 1;
  return [0, 1, 2].map((channel) =>
    Math.max(
      0,
      Math.min(
        255,
        Math.round(
          parts.reduce((sum, part) => sum + part.weight * part.rgb[channel], 0) / total,
        ),
      ),
    ),
  ) as RGB;
}

/** Whole-layer counts, with zero and negative entries dropped. */
export function normaliseRecipeCounts(counts: Record<number, number>): Array<{ extruder: number; count: number }> {
  return Object.entries(counts)
    .map(([extruder, count]) => ({ extruder: Number(extruder), count: Math.max(0, Math.round(count)) }))
    .filter((entry) => Number.isFinite(entry.extruder) && entry.count > 0)
    .sort((a, b) => a.extruder - b.extruder);
}

/**
 * Rebuilds one blend from hand-set layer counts: the printed layer order, the
 * predicted colour and the error against the colours that blend stands for.
 */
export function blendFromCounts(
  template: VirtualBlendEntry,
  counts: Record<number, number>,
  physicalSlots: PhysicalSlot[],
  targets: Array<{ rgb: RGB; weight: number }>,
  options: RecipeOverrideOptions = {},
): VirtualBlendEntry | null {
  const active = normaliseRecipeCounts(counts);
  if (active.length === 0) return null;
  const rgbOf = (extruder: number): RGB =>
    physicalSlots.find((slot) => slot.slot === extruder)?.filament.effectiveRgb ?? [120, 120, 120];

  const { sequence } = buildCanonicalCycle(
    active.map((entry) => ({ extruder: entry.extruder, ratio: entry.count, count: entry.count })),
  );
  const cycle = Math.max(1, sequence.length);
  const perExtruder = new Map<number, number>();
  for (const extruder of sequence) perExtruder.set(extruder, (perExtruder.get(extruder) ?? 0) + 1);

  const components: VirtualBlendComponent[] = [...perExtruder.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([extruder, count]) => ({
      extruder,
      ratio: count / cycle,
      count,
      rgb: rgbOf(extruder),
    }));

  const predicted = mixFilamentsRgb(
    components.map((component) => ({ rgb: component.rgb, ratio: component.ratio })),
  );
  const metric = options.colourDifferenceMetric ?? "ciede2000";
  // The row stands for one or more palette colours; report the worst of them,
  // the same way the planner does when colours share a mixture.
  const error = targets.reduce(
    (worst, target) => Math.max(worst, colourDistance(rgbToLab(target.rgb), predicted.lab, metric)),
    0,
  );

  return {
    ...template,
    displayRgb: predicted.rgb,
    layerAverageRgb: weightedAverageRgb(
      components.map((component) => ({ rgb: component.rgb, weight: component.count })),
    ),
    components,
    sequence,
    sequenceKey: `manual:${sequence.join("-")}`,
    linearRgbError: error,
  };
}

/**
 * Applies hand-set mixtures to a plan.  Overrides are keyed by the palette
 * index the row is listed under, which survives re-planning as long as the
 * palette itself does — virtual extruder ids do not.
 *
 * A mixture reduced to a single filament stops being a mixture: those palette
 * colours move to that physical extruder instead of keeping a one-component
 * virtual extruder.
 */
export function applyRecipeOverridesToPlan(
  plan: VirtualExtruderPlan,
  palette: PaletteEntry[],
  physicalSlots: PhysicalSlot[],
  overrides: Record<number, RecipeOverride>,
  options: RecipeOverrideOptions = {},
): VirtualExtruderPlan {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return plan;
  const paletteByIndex = new Map(palette.map((entry) => [entry.index, entry]));
  const paletteToAssignment = new Map(plan.paletteToAssignment);
  const physicalOnly = [...plan.physicalOnly];
  const virtualBlends: VirtualBlendEntry[] = [];

  for (const blend of plan.virtualBlends) {
    const key = blend.targetPaletteIndices.find((index) => overrides[index] !== undefined);
    const override = key === undefined ? undefined : overrides[key];
    if (!override) {
      virtualBlends.push(blend);
      continue;
    }
    const targets = blend.targetPaletteIndices.flatMap((index) => {
      const entry = paletteByIndex.get(index);
      return entry ? [{ rgb: entry.rgb, weight: Math.max(1, entry.count) }] : [];
    });
    const active = normaliseRecipeCounts(override.counts);
    if (active.length === 1) {
      const extruder = active[0].extruder;
      const physicalRgb =
        physicalSlots.find((slot) => slot.slot === extruder)?.filament.effectiveRgb ?? [120, 120, 120];
      const metric = options.colourDifferenceMetric ?? "ciede2000";
      physicalOnly.push({
        paletteIndex: blend.targetPaletteIndices[0],
        targetPaletteIndices: [...blend.targetPaletteIndices],
        targetRgb: targets[0]?.rgb ?? physicalRgb,
        physicalRgb,
        physicalExtruder: extruder,
        triangleCount: blend.triangleCount,
        linearRgbError: targets.reduce(
          (worst, target) => Math.max(worst, colourDistance(rgbToLab(target.rgb), rgbToLab(physicalRgb), metric)),
          0,
        ),
      });
      for (const index of blend.targetPaletteIndices)
        paletteToAssignment.set(index, { kind: "physical", extruder });
      continue;
    }
    const rebuilt = blendFromCounts(blend, override.counts, physicalSlots, targets, options);
    virtualBlends.push(rebuilt ?? blend);
  }

  return {
    virtualBlends,
    physicalOnly: physicalOnly.sort((a, b) => a.paletteIndex - b.paletteIndex),
    paletteToAssignment,
    mappingDiagnostics: plan.mappingDiagnostics,
  };
}
