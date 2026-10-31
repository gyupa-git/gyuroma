import { useMemo, useState, type Ref } from "react";
import { rgbToHex } from "@core/colour";
import { colourDistance, rgbToLab } from "@core/prusaFdmMixer";
import { normaliseRecipeCounts } from "@core/recipeOverrides";
import { proposeRecipes, type RecipeProposal } from "@core/recipeProposals";
import type { PhysicalSlot, RGB } from "@core/types";
import type { VirtualExtruderPlan } from "@core/virtualExtruders";
import type { MixSettings } from "../engine/types";
import { useT } from "../i18n";
import { HelpTip } from "./HelpTip";
import { deltaClass, SequenceBar, type MatrixRow } from "./MappingMatrix";
import { Icon } from "./Shell";

const MAX_LAYERS = 20;

/** A recipe panel's own undo: the newest change made in it, in words, and how many it keeps. */
export interface RecipeUndo {
  before: string;
  now: string;
  count: number;
  onUndo: () => void;
}

/**
 * "방금 바꿈: 자동 → E1 단색 [↶ 되돌리기]" — shown in the panel where the change
 * was made (⌘Z undoes the work, not recipe choices).  It flashes like a
 * highlighter each time a change is made (the caller keys it by the count).
 */
export function RecipeUndoBar({ undo }: { undo: RecipeUndo }) {
  const t = useT();
  return (
    <div className="recipe-undo" role="status">
      <span className="what">
        {t("recipe.justChanged")} <b className="mono">{undo.before}</b> → <b className="mono">{undo.now}</b>
      </span>
      <button type="button" className="btn small" onClick={undo.onUndo}>
        <Icon name="undo" size={12} /> {t("recipe.undo")}
        {undo.count > 1 ? ` (${undo.count})` : ""}
      </button>
    </div>
  );
}

/**
 * The right panel of step 03: the selected matrix row's recipe.  Layer counts
 * change with the arrows and the predicted colour and its difference follow at
 * once; the other mixtures the planner would consider are one click each, and
 * any row can be printed with a single filament instead.
 */
export function RecipeDetail({
  row,
  plan,
  basePlan,
  slots,
  settings,
  layerHeight,
  recipeOverrides,
  onRecipeOverride,
  manualPhysical,
  onManualPhysical,
  onLayerPreview,
  onRemember,
  undo,
  headerRef,
}: {
  row: MatrixRow | null;
  plan: VirtualExtruderPlan | null;
  basePlan: VirtualExtruderPlan | null;
  slots: PhysicalSlot[];
  settings: MixSettings;
  layerHeight: number | null;
  recipeOverrides: Record<string, { counts: Record<string, number> }>;
  onRecipeOverride: (paletteIndex: number, counts: Record<number, number> | null) => void;
  manualPhysical: Record<string, number>;
  onManualPhysical: (paletteIndex: number, extruder: number | null) => void;
  onLayerPreview: () => void;
  /** Called once before each change made here, with the colours it touches (for this panel's own undo). */
  onRemember: (indices: number[]) => void;
  /** This panel's undo for the colour shown, or null when nothing was changed here. */
  undo: RecipeUndo | null;
  headerRef?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  const slotRgb = useMemo(() => new Map(slots.map((slot) => [slot.slot, slot.filament.effectiveRgb])), [slots]);
  // "다른 조합": show each cycle repeated to the end of its bar (remembered in this browser)
  const [repeatCycles, setRepeatCycles] = useState(() => {
    try {
      return window.localStorage.getItem("rodin-pipeline-repeat-cycles") === "1";
    } catch {
      return false;
    }
  });
  const toggleRepeatCycles = (next: boolean) => {
    setRepeatCycles(next);
    try {
      window.localStorage.setItem("rodin-pipeline-repeat-cycles", next ? "1" : "0");
    } catch {
      // ignore
    }
  };
  const indices = row ? (row.blend?.targetPaletteIndices ?? row.physical?.targetPaletteIndices ?? [row.paletteIndex]) : [];
  /** Overrides are keyed by the first palette colour of the row's blend. */
  const overrideKey = indices.find((i) => recipeOverrides[String(i)] !== undefined) ?? indices[0];
  const hasOverride = indices.some((i) => recipeOverrides[String(i)] !== undefined);
  const hasManual = indices.some((i) => manualPhysical[String(i)] !== undefined);
  // A row the planner put on one filament (or that was forced onto one) takes
  // no mixture override; it can only be switched to another filament.
  const mixable = Boolean(row && (row.kind === "virtual" || hasOverride));

  const autoCounts = useMemo(() => {
    if (!row || !basePlan) return undefined;
    const autoBlend = basePlan.virtualBlends.find((b) => b.targetPaletteIndices.includes(row.paletteIndex));
    if (autoBlend) return Object.fromEntries(autoBlend.components.map((c) => [c.extruder, c.count]));
    const autoPhysical = basePlan.physicalOnly.find((p) => p.targetPaletteIndices.includes(row.paletteIndex));
    return autoPhysical ? { [autoPhysical.physicalExtruder]: 1 } : undefined;
  }, [row, basePlan]);

  const neighbours = useMemo(() => {
    const out: Array<{ paletteIndex: number; rgb: RGB }> = [];
    if (!plan || !row) return out;
    const mine = new Set(indices);
    for (const other of plan.virtualBlends) for (const index of other.targetPaletteIndices) if (!mine.has(index)) out.push({ paletteIndex: index, rgb: other.displayRgb });
    for (const other of plan.physicalOnly) for (const index of other.targetPaletteIndices) if (!mine.has(index)) out.push({ paletteIndex: index, rgb: other.physicalRgb });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, row]);

  const proposals = useMemo<RecipeProposal[]>(() => {
    if (!row || !mixable) return [];
    return proposeRecipes(row.rgb, slots, row.counts, {
      neighbours,
      autoCounts,
      maxComponents: settings.assignmentMode === "physical-only" ? 1 : settings.maxComponents,
      recipeResolution: settings.recipeResolution,
      colourDifferenceMetric: settings.colourDifferenceMetric,
      purePhysicalThreshold: settings.purePhysicalThreshold,
    }).sort((a, b) => a.deltaE - b.deltaE || a.difficulty - b.difficulty);
  }, [row, mixable, slots, neighbours, autoCounts, settings]);

  if (!row) {
    return (
      <div className="pane-section">
        <p className="empty-note">{t("recipe.none")}</p>
      </div>
    );
  }

  const metric = settings.colourDifferenceMetric;
  const same = (a: Record<number, number>, b?: Record<number, number>) =>
    Boolean(b) && JSON.stringify(normaliseRecipeCounts(a)) === JSON.stringify(normaliseRecipeCounts(b ?? {}));
  const setCounts = (next: Record<number, number>) => {
    if (normaliseRecipeCounts(next).length === 0) return;
    onRemember(indices);
    onRecipeOverride(overrideKey, same(next, autoCounts) ? null : next);
  };
  const step = (extruder: number, delta: number) => {
    const current = Math.max(0, Math.round(row.counts[extruder] ?? 0));
    setCounts({ ...row.counts, [extruder]: Math.max(0, Math.min(MAX_LAYERS, current + delta)) });
  };
  const used = normaliseRecipeCounts(row.counts);
  const unused = slots.filter((slot) => !used.some((entry) => entry.extruder === slot.slot));
  const meaning = row.deltaE <= 2 ? t("recipe.deSame") : row.deltaE <= 5 ? t("recipe.deClose") : row.deltaE <= 10 ? t("recipe.deVisible") : t("recipe.deOther");
  const repeatMm = layerHeight ? row.cycle * layerHeight : null;

  const proposalLabel = (proposal: RecipeProposal): string => {
    const n = proposal.components.length;
    if (proposal.kind === "without")
      return t("mix.proposalWithout", { n: proposal.extruder ?? 0, c: n <= 1 ? t("mix.proposalSingleShort") : t("mix.proposalMix", { c: n }) });
    if (n <= 1) return t("mix.proposalSingle", { n: proposal.components[0]?.extruder ?? 0 });
    return t("mix.proposalMix", { c: n });
  };

  return (
    <>
      <div className="row-card" ref={headerRef}>
        <span className="sw" style={{ background: row.hex }} />
        <span className="row-card-text">
          <span className="pane-label">{t("recipe.selectedRow")}</span>
          <span>
            <b className="mono">{row.hex}</b> <span className="mono muted">{(row.area * 100).toFixed(1)}%</span>
          </span>
        </span>
        <span className={`ve-chip${row.kind === "physical" ? " physical" : ""}`}>{row.label}</span>
      </div>

      <section className="pane-section">
        <span className="pane-title">
          {row.kind === "virtual" ? t("recipe.title", { label: row.label }) : t("recipe.titleSingle", { label: row.label })}
          <HelpTip text={t("recipe.help")} />
        </span>
        <div className="recipe-head">
          <span className="recipe-swatch" title={t("matrix.predictedTitle", { a: row.hex, b: rgbToHex(row.predicted) })}>
            <span style={{ background: row.hex }} />
            <span style={{ background: rgbToHex(row.predicted) }} />
          </span>
          <span className="recipe-numbers">
            <span className="muted">
              {t("recipe.target")} <span className="mono">{row.hex}</span> → {t("recipe.predicted")} <span className="mono">{rgbToHex(row.predicted)}</span>
            </span>
            <span className={`recipe-de mono ${deltaClass(row.deltaE)}`}>ΔE {row.deltaE.toFixed(1)}</span>
            <span className="muted">{meaning}</span>
          </span>
        </div>
        <div className="pane-head" style={{ marginTop: 4 }}>
          <span className="pane-label">{t("recipe.order")}</span>
          <span className="mono pane-aside">{t("matrix.layers", { n: row.cycle })}</span>
        </div>
        <div className="recipe-sequence">
          <SequenceBar sequence={row.sequence} slotRgb={slotRgb} layerPx={Math.max(4, Math.min(14, Math.floor(296 / Math.max(1, row.sequence.length))))} height={22} />
        </div>
        <div className="pane-head">
          <span className="muted">
            {repeatMm !== null && layerHeight
              ? row.cycle > 1
                ? t("recipe.repeat", { h: layerHeight.toFixed(2), mm: repeatMm.toFixed(1) })
                : t("recipe.noStripes")
              : t("recipe.repeatUnknown")}
          </span>
          <button type="button" className="text-link iris" onClick={onLayerPreview}>
            {t("recipe.layerPreview")} ▸
          </button>
        </div>
        {mixable ? (
          <>
            <div className="steppers">
              {used.map((entry) => (
                <div key={entry.extruder} className="layer-stepper" title={t("recipe.stepperHint", { n: entry.extruder, c: entry.count, total: row.cycle })}>
                  <span className="dot" style={{ background: rgbToHex(slotRgb.get(entry.extruder) ?? [120, 120, 120]) }} />
                  <span className="mono name">E{entry.extruder}</span>
                  <span className="mono value">{entry.count}</span>
                  <span className="arrows">
                    <button type="button" aria-label={t("recipe.more", { n: entry.extruder })} disabled={entry.count >= MAX_LAYERS} onClick={() => step(entry.extruder, 1)}>
                      ▲
                    </button>
                    <button type="button" aria-label={t("recipe.less", { n: entry.extruder })} disabled={used.length === 1 && entry.count <= 1} onClick={() => step(entry.extruder, -1)}>
                      ▼
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {unused.length > 0 && settings.assignmentMode !== "physical-only" && used.length < settings.maxComponents && (
              <div className="inline">
                <span className="muted">{t("recipe.add")}</span>
                {unused.map((slot) => (
                  <button key={slot.slot} type="button" className="chip button" onClick={() => step(slot.slot, 1)}>
                    <span className="dot" style={{ background: rgbToHex(slot.filament.effectiveRgb) }} />
                    <span className="mono">+E{slot.slot}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted">{hasManual ? t("recipe.forced", { label: row.label }) : t("recipe.autoSingle", { label: row.label })}</p>
        )}
        {undo && <RecipeUndoBar key={undo.count} undo={undo} />}
        {(hasOverride || hasManual) && (
          <button
            type="button"
            className="btn small"
            style={{ alignSelf: "flex-start" }}
            onClick={() => {
              onRemember(indices);
              for (const index of indices) {
                onRecipeOverride(index, null);
                onManualPhysical(index, null);
              }
            }}
          >
            <Icon name="refresh" size={12} /> {t("recipe.backToAuto")}
          </button>
        )}
      </section>

      {proposals.length > 0 && (
        <section className="pane-section">
          <div className="pane-head">
            <span className="pane-label">{t("recipe.others")}</span>
            <span className="pane-head-tools">
              <label className="pane-check" title={t("recipe.repeatCyclesTip")}>
                <input type="checkbox" checked={repeatCycles} onChange={(event) => toggleRepeatCycles(event.target.checked)} />
                {t("recipe.repeatCycles")}
              </label>
              <span className="pane-aside">{t("recipe.othersAside")}</span>
            </span>
          </div>
          <div className="proposal-list">
            {proposals.map((proposal) => {
              const key = `${proposal.kind}-${proposal.extruder ?? 0}-${normaliseRecipeCounts(proposal.counts).map((c) => `${c.extruder}:${c.count}`).join(",")}`;
              return (
                <button
                  key={key}
                  type="button"
                  className={`proposal${proposal.isCurrent ? " current" : ""}`}
                  disabled={proposal.isCurrent}
                  onClick={() => {
                    onRemember(indices);
                    onRecipeOverride(overrideKey, proposal.isAuto ? null : { ...proposal.counts });
                  }}
                >
                  <span className="sw" style={{ background: rgbToHex(proposal.rgb) }} />
                  <span className="proposal-main">
                    <span className="proposal-title">
                      <b>{proposalLabel(proposal)}</b>
                      {proposal.isCurrent && <span className="badge">{t("mix.proposalNow")}</span>}
                      {proposal.isAuto && !proposal.isCurrent && <span className="muted">{t("mix.proposalAuto")}</span>}
                      {/* each "E1 3" and the dot after it stay together; the line breaks only after a dot */}
                      <span className="mono muted proposal-recipe">{proposal.components.map((c) => `E${c.extruder}\u00a0${c.count}`).join("\u00a0· ")}</span>
                    </span>
                    {/* 6 px a layer; a very long cycle (over 30 layers) narrows so it still fits the card */}
                    <SequenceBar sequence={proposal.sequence} slotRgb={slotRgb} layerPx={Math.max(3, Math.min(6, Math.floor(180 / Math.max(1, proposal.sequence.length))))} height={6} repeat={repeatCycles} />
                    {proposal.collision && (
                      <span className="swap-bad">⚠ {t("mix.proposalCollision", { n: proposal.collision.paletteIndex })}</span>
                    )}
                  </span>
                  <span className="proposal-nums">
                    <span className={`mono ${deltaClass(proposal.deltaE)}`}>ΔE {proposal.deltaE.toFixed(1)}</span>
                    <span className="mono muted">{t("matrix.layers", { n: proposal.cycleLayers })}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="pane-section">
        <span className="pane-label">{t("recipe.straight")}</span>
        <div className="single-grid">
          {slots.map((slot) => {
            const de = colourDistance(rgbToLab(row.rgb), rgbToLab(slot.filament.effectiveRgb), metric);
            const current = row.kind === "physical" && row.counts[slot.slot] > 0;
            return (
              <button
                key={slot.slot}
                type="button"
                className="single-btn"
                aria-pressed={current}
                title={t("mix.recipeStraightTip", { n: slot.slot, name: slot.filament.name, e: de.toFixed(1) })}
                onClick={() => {
                  onRemember(indices);
                  for (const index of indices) {
                    onRecipeOverride(index, null);
                    onManualPhysical(index, slot.slot);
                  }
                }}
              >
                <span className="dot" style={{ background: rgbToHex(slot.filament.effectiveRgb) }} />
                <span className="mono">E{slot.slot}</span>
                <span className={`mono ${deltaClass(de)}`}>{de.toFixed(1)}</span>
              </button>
            );
          })}
        </div>
        <p className="muted">{t("recipe.scale")}</p>
      </section>
    </>
  );
}
