import { useMemo } from "react";
import { rgbToHex } from "@core/colour";
import { normaliseRecipeCounts } from "@core/recipeOverrides";
import { proposeRecipes } from "@core/recipeProposals";
import type { PhysicalSlot, RGB } from "@core/types";
import type { MixSettings } from "../engine/types";
import { useT } from "../i18n";
import { HelpTip } from "./HelpTip";
import { deltaClass, SequenceBar, type MatrixRow } from "./MappingMatrix";
import { RecipeUndoBar, type RecipeUndo } from "./RecipeDetail";

/** One output (VE or E) and the palette colours that print with it. */
export interface BandingOutput {
  label: string;
  kind: "virtual" | "physical";
  rows: MatrixRow[];
  area: number;
  cycle: number;
  sequence: number[];
  counts: Record<number, number>;
  predicted: RGB;
}

export function outputsFromRows(rows: MatrixRow[]): BandingOutput[] {
  const byLabel = new Map<string, BandingOutput>();
  for (const row of rows) {
    const existing = byLabel.get(row.label);
    if (existing) {
      existing.rows.push(row);
      existing.area += row.area;
    } else {
      byLabel.set(row.label, { label: row.label, kind: row.kind, rows: [row], area: row.area, cycle: row.cycle, sequence: row.sequence, counts: row.counts, predicted: row.predicted });
    }
  }
  // Longest repeat first: that is where the stripes show; then by area.
  return [...byLabel.values()].sort((a, b) => b.cycle - a.cycle || b.area - a.area);
}

/**
 * Step 04's right panel: for every output, which filaments show up as lines
 * and how far apart the repeat lands at the chosen layer height, and for the
 * picked one, shorter mixes that trade some colour for narrower stripes.
 */
export function BandingPanel({
  outputs,
  slots,
  layerHeight,
  selected,
  onSelect,
  settings,
  onRecipeOverride,
  onRemember,
  undo,
}: {
  outputs: BandingOutput[];
  slots: PhysicalSlot[];
  layerHeight: number;
  selected: string | null;
  onSelect: (output: BandingOutput) => void;
  settings: MixSettings;
  onRecipeOverride: (paletteIndex: number, counts: Record<number, number> | null) => void;
  /** Called once before each change made here: the colour it is made on and the colours it touches (for this panel's own undo). */
  onRemember: (row: number, indices: number[]) => void;
  /** This panel's undo, or null when nothing was changed here. */
  undo: RecipeUndo | null;
}) {
  const t = useT();
  const slotRgb = useMemo(() => new Map(slots.map((slot) => [slot.slot, slot.filament.effectiveRgb])), [slots]);
  const focus = outputs.find((output) => output.label === selected) ?? outputs.find((output) => output.kind === "virtual") ?? null;

  // Shorter repeats for the picked output, judged on its largest colour.
  const shorter = useMemo(() => {
    if (!focus || focus.kind !== "virtual") return [];
    const main = [...focus.rows].sort((a, b) => b.area - a.area)[0];
    if (!main) return [];
    const neighbours = outputs.filter((o) => o !== focus).flatMap((o) => o.rows.map((row) => ({ paletteIndex: row.paletteIndex, rgb: o.predicted })));
    return proposeRecipes(main.rgb, slots, focus.counts, {
      neighbours,
      maxComponents: settings.assignmentMode === "physical-only" ? 1 : settings.maxComponents,
      recipeResolution: settings.recipeResolution,
      colourDifferenceMetric: settings.colourDifferenceMetric,
      purePhysicalThreshold: settings.purePhysicalThreshold,
    })
      .filter((proposal) => !proposal.isCurrent && proposal.cycleLayers > 1 && proposal.cycleLayers < focus.cycle)
      .sort((a, b) => a.deltaE - b.deltaE)
      .slice(0, 3)
      .map((proposal) => ({
        proposal,
        from: main.deltaE,
        key: main.blend?.targetPaletteIndices[0] ?? main.paletteIndex,
        row: main.paletteIndex,
        indices: main.blend?.targetPaletteIndices ?? [main.paletteIndex],
      }));
  }, [focus, outputs, slots, settings]);

  const stripeText = (output: BandingOutput): string => {
    if (output.kind === "physical" || output.cycle <= 1) return t("band.none");
    const parts = normaliseRecipeCounts(output.counts).sort((a, b) => a.count - b.count);
    // The filament with the most layers is the ground; the others are the lines on it.
    const lines = parts.slice(0, -1).map((part) => t("band.lines", { e: part.extruder, n: part.count }));
    return `${lines.join(" · ")} / ${t("matrix.layers", { n: output.cycle })}`;
  };

  return (
    <>
      <section className="pane-section" style={{ paddingBottom: 6 }}>
        <div className="pane-head">
          <span className="pane-title">
            {t("band.title")}
            <HelpTip text={t("band.help")} />
          </span>
          <span className="pane-aside">{t("band.aside")}</span>
        </div>
        {undo && <RecipeUndoBar key={undo.count} undo={undo} />}
      </section>
      <div className="band-table" role="table" aria-label={t("band.title")}>
        <div className="band-row head" role="row">
          <span role="columnheader">{t("matrix.colOutput")}</span>
          <span role="columnheader">{t("band.colLines")}</span>
          <span role="columnheader" className="num">
            {t("band.colRepeat")}
          </span>
        </div>
        {outputs.map((output) => {
          const isSelected = output.label === focus?.label;
          return (
            <button key={output.label} type="button" role="row" className={`band-row${isSelected ? " selected" : ""}`} onClick={() => onSelect(output)}>
              <span role="cell" className="band-output">
                <span className="sw" style={{ background: rgbToHex(output.rows[0]?.rgb ?? output.predicted) }} />
                <span className={`ve-chip${output.kind === "physical" ? " physical" : ""}`}>{output.label}</span>
              </span>
              <span role="cell" className="band-lines">
                <span>{stripeText(output)}</span>
                {output.kind === "virtual" && <SequenceBar sequence={output.sequence} slotRgb={slotRgb} layerPx={3} height={5} />}
              </span>
              <span role="cell" className="num mono">
                {output.cycle > 1 ? `${(output.cycle * layerHeight).toFixed(1)}mm` : "—"}
              </span>
            </button>
          );
        })}
      </div>
      {focus && focus.kind === "virtual" && (
        <section className="pane-section">
          <span className="pane-label">{t("band.shorterTitle", { label: focus.label })}</span>
          {shorter.length > 0 ? (
            <div className="proposal-list">
              {shorter.map(({ proposal, from, key, row, indices }) => (
                <button
                  key={normaliseRecipeCounts(proposal.counts).map((c) => `${c.extruder}:${c.count}`).join(",")}
                  type="button"
                  className="proposal"
                  onClick={() => {
                    onRemember(row, indices);
                    onRecipeOverride(key, proposal.isAuto ? null : { ...proposal.counts });
                  }}
                >
                  <span className="sw" style={{ background: rgbToHex(proposal.rgb) }} />
                  <span className="proposal-main">
                    <span className="proposal-title">
                      <b>{t("band.shorterMix", { c: proposal.components.length })}</b>
                      <span className="mono muted">{proposal.components.map((c) => `E${c.extruder} ${c.count}`).join(" · ")}</span>
                    </span>
                    <span className="mono muted">
                      {t("band.shorterRepeat", { n: proposal.cycleLayers, mm: (proposal.cycleLayers * layerHeight).toFixed(1) })}
                    </span>
                  </span>
                  <span className="proposal-nums">
                    <span className="mono">
                      ΔE {from.toFixed(1)} → <span className={deltaClass(proposal.deltaE)}>{proposal.deltaE.toFixed(1)}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-note">{t("band.shorterNone")}</p>
          )}
          <p className="muted">{t("band.trade")}</p>
        </section>
      )}
    </>
  );
}
