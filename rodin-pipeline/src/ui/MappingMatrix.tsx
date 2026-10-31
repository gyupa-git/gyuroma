import { forwardRef, useEffect, useRef } from "react";
import { rgbToHex } from "@core/colour";
import { MAX_PAINTABLE_EXTRUDER_ID } from "@core/paintCodes";
import { colourDistance, rgbToLab } from "@core/prusaFdmMixer";
import type { PaletteEntry, PhysicalSlot, RGB } from "@core/types";
import type { PhysicalOnlyEntry, VirtualBlendEntry, VirtualExtruderPlan } from "@core/virtualExtruders";
import type { MixSettings } from "../engine/types";
import { useT } from "../i18n";
import { HelpTip } from "./HelpTip";

/** One palette colour and how it prints. */
export interface MatrixRow {
  paletteIndex: number;
  hex: string;
  rgb: RGB;
  area: number;
  kind: "virtual" | "physical";
  /** VE6 or E4. */
  label: string;
  /** Layers per slot in one repeat (a single filament is 1 layer of it). */
  counts: Record<number, number>;
  cycle: number;
  sequence: number[];
  predicted: RGB;
  deltaE: number;
  blend?: VirtualBlendEntry;
  physical?: PhysicalOnlyEntry;
  /** A hand-set mixture or a forced filament is in effect. */
  edited: boolean;
}

/** Every palette colour with its output, largest area first. */
export function buildMatrixRows(
  plan: VirtualExtruderPlan | null,
  palette: PaletteEntry[],
  areaByIndex: Map<number, number>,
  metric: MixSettings["colourDifferenceMetric"],
  recipeOverrides: Record<string, unknown>,
  manualPhysical: Record<string, number>,
): MatrixRow[] {
  if (!plan) return [];
  const blendOf = new Map<number, VirtualBlendEntry>();
  for (const blend of plan.virtualBlends) for (const index of blend.targetPaletteIndices) blendOf.set(index, blend);
  const physicalOf = new Map<number, PhysicalOnlyEntry>();
  for (const entry of plan.physicalOnly) for (const index of entry.targetPaletteIndices) physicalOf.set(index, entry);
  const rows: MatrixRow[] = [];
  for (const entry of palette) {
    const blend = blendOf.get(entry.index);
    const physical = physicalOf.get(entry.index);
    const hex = rgbToHex(entry.rgb);
    const area = areaByIndex.get(entry.index) ?? 0;
    const targetLab = rgbToLab(entry.rgb);
    if (blend) {
      const indices = blend.targetPaletteIndices;
      rows.push({
        paletteIndex: entry.index,
        hex,
        rgb: entry.rgb,
        area,
        kind: "virtual",
        label: `VE${blend.virtualId}`,
        counts: Object.fromEntries(blend.components.map((c) => [c.extruder, c.count])),
        cycle: blend.sequence.length,
        sequence: blend.sequence,
        predicted: blend.displayRgb,
        deltaE: colourDistance(targetLab, rgbToLab(blend.displayRgb), metric),
        blend,
        edited: indices.some((i) => recipeOverrides[String(i)] !== undefined),
      });
    } else if (physical) {
      const indices = physical.targetPaletteIndices;
      rows.push({
        paletteIndex: entry.index,
        hex,
        rgb: entry.rgb,
        area,
        kind: "physical",
        label: `E${physical.physicalExtruder}`,
        counts: { [physical.physicalExtruder]: 1 },
        cycle: 1,
        sequence: [physical.physicalExtruder],
        predicted: physical.physicalRgb,
        deltaE: colourDistance(targetLab, rgbToLab(physical.physicalRgb), metric),
        physical,
        edited: indices.some((i) => manualPhysical[String(i)] !== undefined || recipeOverrides[String(i)] !== undefined),
      });
    }
  }
  return rows.sort((a, b) => b.area - a.area);
}

export function deltaClass(deltaE: number): string {
  return deltaE > 10 ? "de-bad" : deltaE > 5 ? "de-warn" : "";
}

/**
 * How closely a colour comes out, 0-100 %, from its colour difference alone:
 * halves every 10 ΔE (10 is where it starts to read as another colour).
 */
export function colourMatch(deltaE: number): number {
  return 100 * Math.pow(2, -deltaE / 10);
}

/**
 * A cycle's layers left to right.  `repeat` runs the cycle on to the end of
 * the bar, the way the layers stack up in the print (no mark between cycles:
 * a light line would read as a white filament).
 */
export function SequenceBar({ sequence, slotRgb, layerPx = 5, height = 14, repeat = false }: { sequence: number[]; slotRgb: Map<number, RGB>; layerPx?: number; height?: number; repeat?: boolean }) {
  // enough copies to fill any panel; the bar clips the rest
  const copies = repeat ? Math.max(1, Math.ceil(640 / Math.max(1, sequence.length * layerPx))) : 1;
  return (
    <span className={`layer-bar${repeat ? " repeat" : ""}`} style={{ height }} title={sequence.map((e) => `E${e}`).join(" ")} aria-hidden="true">
      {Array.from({ length: copies }, (_, copy) =>
        sequence.map((extruder, i) => (
          <span key={`${copy}-${i}`} style={{ width: layerPx, background: rgbToHex(slotRgb.get(extruder) ?? [120, 120, 120]) }} />
        )),
      )}
    </span>
  );
}

export interface MatrixSummary {
  fidelity: number | null;
  lost: number;
  averageDeltaE: number;
  longestCycle: number;
  worst: MatrixRow | null;
  singles: number;
  mixes: number;
  totalExtruders: number;
}

export function summariseRows(rows: MatrixRow[], fidelity: number | null, lost: number, physicalCount: number, virtualCount: number): MatrixSummary {
  let weighted = 0;
  let area = 0;
  let worst: MatrixRow | null = null;
  for (const row of rows) {
    weighted += row.deltaE * row.area;
    area += row.area;
    if (!worst || row.deltaE > worst.deltaE) worst = row;
  }
  return {
    fidelity,
    lost,
    averageDeltaE: area > 0 ? weighted / area : 0,
    longestCycle: rows.reduce((max, row) => Math.max(max, row.cycle), 1),
    worst,
    singles: rows.filter((row) => row.kind === "physical").length,
    mixes: rows.filter((row) => row.kind === "virtual").length,
    totalExtruders: physicalCount + virtualCount,
  };
}

/**
 * The mapping matrix: one row per palette colour — how many layers of each
 * filament it takes, the colour that comes out next to the one wanted, the
 * difference, the repeat with its layer order, and the extruder it prints as.
 */
export const MappingMatrix = forwardRef<HTMLDivElement, {
  rows: MatrixRow[];
  slots: PhysicalSlot[];
  summary: MatrixSummary;
  selected: number | null;
  onSelect: (paletteIndex: number) => void;
  hoverHex: string | null;
  onHover: (hex: string | null) => void;
  /** The selected row's element, for the line to the detail panel. */
  selectedRowRef?: (element: HTMLDivElement | null) => void;
  onScroll?: () => void;
  /** Colours of the patches picked on the model: marked with the same ring as the pin over them. */
  pointed?: string[];
}>(function MappingMatrix({ rows, slots, summary, selected, onSelect, hoverHex, onHover, selectedRowRef, onScroll, pointed }, ref) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // A colour picked on the model is brought into view.
  const pointedKey = pointed?.join(",") ?? "";
  useEffect(() => {
    if (pointedKey) rootRef.current?.querySelector(".matrix-row .pin-mark")?.closest(".matrix-row")?.scrollIntoView({ block: "nearest" });
  }, [pointedKey]);
  const slotRgb = new Map(slots.map((slot) => [slot.slot, slot.filament.effectiveRgb]));
  // Narrower filament columns as the tool count grows, so 8–16 tools still fit.
  const slotWidth = slots.length <= 5 ? 52 : slots.length <= 8 ? 44 : 38;
  const columns = `30px 168px repeat(${slots.length}, ${slotWidth}px) 64px 48px 56px minmax(120px, 1fr) 56px`;
  return (
    <div className="matrix" ref={rootRef}>
      <div className="matrix-head">
        <span className="pane-title">
          {t("matrix.title")}
          <HelpTip text={t("matrix.help")} />
        </span>
        {summary.fidelity !== null && (
          <span className="fidelity-pill" title={t("glossary.fidelityText")}>
            <span className="name">{t("glossary.fidelityTerm")}</span>
            <b className="mono">{Math.round(summary.fidelity)}</b>
            <span className="mono of">/ 100</span>
          </span>
        )}
        <span className="matrix-facts">
          <span>{t("matrix.factColours", { n: rows.length, s: summary.singles, m: summary.mixes })}</span>
          <span>
            {t("matrix.factAverage")} <b className="mono">{summary.averageDeltaE.toFixed(1)}</b>
          </span>
          <span>
            {t("matrix.factCycle")} <b className="mono">{t("matrix.layers", { n: summary.longestCycle })}</b>
          </span>
          {summary.worst && (
            <span className={summary.worst.deltaE > 5 ? "warn" : undefined}>
              {t("matrix.factWorst")} <b className="mono">{summary.worst.hex}</b> · ΔE <b className="mono">{summary.worst.deltaE.toFixed(1)}</b>
            </span>
          )}
          {summary.lost > 0 && <span className="danger">⚠ {t("fil.lostNow", { n: summary.lost })}</span>}
          {summary.totalExtruders > MAX_PAINTABLE_EXTRUDER_ID && <span className="danger">{t("mix.overLimit", { t: summary.totalExtruders, max: MAX_PAINTABLE_EXTRUDER_ID })}</span>}
        </span>
      </div>
      <div className="matrix-scroll" ref={ref} onScroll={onScroll} onMouseLeave={() => onHover(null)}>
        <div className="matrix-row header" style={{ gridTemplateColumns: columns }} role="row">
          <span className="row-no" title={t("matrix.colNoTitle", { n: rows.length })}>
            #
          </span>
          <span>{t("matrix.colGroup")}</span>
          {slots.map((slot) => (
            <span key={slot.slot} className="slot-head" title={slot.filament.name}>
              <span className="dot" style={{ background: rgbToHex(slot.filament.effectiveRgb) }} />E{slot.slot}
            </span>
          ))}
          <span>{t("matrix.colPredicted")}</span>
          <span className="num">ΔE</span>
          <span className="match-head" title={t("matrix.colMatchTitle")}>
            {t("matrix.colMatch")}
          </span>
          <span className="cycle-head">{t("matrix.colCycle")}</span>
          <span className="num">{t("matrix.colOutput")}</span>
        </div>
        {rows.map((row, order) => {
          const isSelected = row.paletteIndex === selected;
          return (
            <div
              key={row.paletteIndex}
              ref={isSelected ? selectedRowRef : undefined}
              className={`matrix-row${isSelected ? " selected" : ""}${hoverHex === row.hex ? " hover" : ""}`}
              style={{ gridTemplateColumns: columns }}
              role="row"
              tabIndex={0}
              aria-selected={isSelected}
              onClick={() => onSelect(row.paletteIndex)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row.paletteIndex);
                }
              }}
              onMouseEnter={() => onHover(row.hex)}
            >
              <span className="row-no mono">{order + 1}</span>
              <span className="group-cell">
                <span className="sw" style={{ background: row.hex }} />
                <span className="mono">{row.hex}</span>
                <span className="mono area">{(row.area * 100).toFixed(1)}%</span>
                {row.edited && <span className="edited" title={t("matrix.edited")}>✎</span>}
                {pointed?.includes(row.hex) && <span className="pin-mark" title={t("strip.pointed", { hex: row.hex })} aria-label={t("strip.pointed", { hex: row.hex })} />}
              </span>
              {slots.map((slot) => {
                const count = row.counts[slot.slot] ?? 0;
                if (row.kind === "physical" && count > 0)
                  return (
                    <span key={slot.slot} className="count-cell">
                      <span className="single-pill">{t("glossary.singleTerm")}</span>
                    </span>
                  );
                return (
                  <span key={slot.slot} className="count-cell">
                    {count > 0 ? (
                      <>
                        <span className="mono">{count}</span>
                        <span className="share" aria-hidden="true">
                          <span style={{ width: `${(count / Math.max(1, row.cycle)) * 100}%`, background: rgbToHex(slot.filament.effectiveRgb) }} />
                        </span>
                      </>
                    ) : (
                      <span className="none">·</span>
                    )}
                  </span>
                );
              })}
              <span className="predicted" title={t("matrix.predictedTitle", { a: row.hex, b: rgbToHex(row.predicted) })}>
                <span style={{ background: row.hex }} />
                <span style={{ background: rgbToHex(row.predicted) }} />
              </span>
              <span className={`num mono ${deltaClass(row.deltaE)}`}>{row.deltaE.toFixed(1)}</span>
              <span className={`match-cell ${deltaClass(row.deltaE)}`} title={t("matrix.colMatchTitle")}>
                <span className="mono">{Math.round(colourMatch(row.deltaE))}%</span>
                <span className="share" aria-hidden="true">
                  <span style={{ width: `${colourMatch(row.deltaE)}%` }} />
                </span>
              </span>
              <span className="cycle-cell">
                <span className="mono">{row.cycle}</span>
                <SequenceBar sequence={row.sequence} slotRgb={slotRgb} />
              </span>
              <span className="num">
                <span className={`ve-chip${row.kind === "physical" ? " physical" : ""}`}>{row.label}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
