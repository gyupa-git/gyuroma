import { useEffect, useState } from "react";
import { recommendMixOption, type MixOptionScore } from "@core/mixAdvice";
import { adviceKey, ask, Superseded } from "../engine/adviceClient";
import { accentPaletteIndices } from "@core/spoolAdvice";
import type { PaletteEntry, PhysicalSlot } from "@core/types";
import type { MixSettings } from "../engine/types";
import { useT } from "../i18n";
import { HelpTip } from "./HelpTip";
import { NumberField, Row } from "./common";
import { Icon, Segmented } from "./Shell";

export interface PhysicalDirectSuggestion {
  extruder: number;
  deltaE: number;
}

function resolutionLabel(resolution: MixSettings["recipeResolution"]): string {
  if (resolution === "thirds") return "1/3";
  if (resolution === "half-thirds") return "50% + 1/3";
  return `${resolution.replace("grid", "")}% + 1/3`;
}
function resolutionShort(resolution: MixSettings["recipeResolution"]): string {
  if (resolution === "thirds") return "1/3";
  if (resolution === "half-thirds") return "50%";
  return `${resolution.replace("grid", "")}%`;
}

/**
 * Step 03's mixing settings: how many filaments one colour may mix, how fine
 * the layer ratios go, and a rating of every combination of the two (fidelity,
 * error, longest repeat) with the recommended one a click away.  The rest of
 * the planner's knobs are behind 고급.
 */
export function MixSection({
  settings,
  onChange,
  palette,
  slots,
  layerHeight,
  fidelity,
  longestCycle,
  highlight,
  mixingBlockedBy,
}: {
  /** Name of the chosen printer when its slicer cannot mix layers. */
  mixingBlockedBy?: string | null;
  settings: MixSettings;
  onChange: (next: MixSettings) => void;
  palette: PaletteEntry[];
  slots: PhysicalSlot[];
  /** For showing the repeat in mm next to the layer count. */
  layerHeight?: number | null;
  /** The score and longest repeat of what is set now, for the "→" on the recommendation. */
  fidelity: number | null;
  longestCycle: number;
  /** Fields the last auto tidy changed ("mix.<key>"), shown in yellow. */
  highlight?: Set<string> | null;
}) {
  const t = useT();
  const set = (patch: Partial<MixSettings>) => onChange({ ...settings, ...patch });
  const physicalOnlyMode = settings.assignmentMode === "physical-only";
  const [scores, setScores] = useState<MixOptionScore[] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rating, setRating] = useState(false);
  const hl = (...keys: string[]) => (keys.some((key) => highlight?.has(`mix.${key}`)) ? "hl-field" : undefined);
  // A tidy that changed something behind 고급 opens it, so the yellow can be seen.
  const advancedChanged = Boolean(hl("mixPriority", "mappingStrategy", "accentProtection", "autoPhysicalDirect", "physicalDirectDeltaE"));
  useEffect(() => {
    if (advancedChanged) setShowAdvanced(true);
  }, [advancedChanged]);
  // Twelve full plans: done in the advice worker so the window keeps moving.
  const rateSettings = () => {
    if (palette.length === 0 || slots.length === 0) return;
    const options = {
      accentIndices: accentPaletteIndices(palette),
      purePhysicalThreshold: settings.purePhysicalThreshold,
      accentProtection: settings.accentProtection,
      mixPriority: settings.mixPriority,
      mappingStrategy: settings.mappingStrategy,
      colourDifferenceMetric: settings.colourDifferenceMetric,
    };
    setRating(true);
    ask(
      { kind: "rate", palette, slots, options },
      adviceKey("rate", { palette: palette.map((p) => [p.index, p.rgb, p.count]), slots: slots.map((slot) => slot.filament.effectiveRgb), options }),
    )
      .then((next) => {
        setScores(next);
        setRating(false);
      })
      .catch((err) => {
        if (!(err instanceof Superseded)) setRating(false);
      });
  };
  const best = scores ? recommendMixOption(scores) : null;
  const isActive = (score: MixOptionScore) =>
    !physicalOnlyMode && score.maxComponents === settings.maxComponents && score.recipeResolution === settings.recipeResolution;
  const apply = (score: MixOptionScore) =>
    set({ assignmentMode: "physical-and-virtual", maxComponents: score.maxComponents === 3 ? 3 : 2, recipeResolution: score.recipeResolution });
  const mixMode = physicalOnlyMode ? "1" : String(settings.maxComponents);

  return (
    <section className="pane-section" aria-label={t("mix.panelTitle")}>
      <div className="pane-head">
        <span className="pane-label">
          {t("mix.panelTitle")}
          <HelpTip text={t("help.mix")} />
        </span>
        <button type="button" className="btn small" onClick={rateSettings} disabled={palette.length === 0 || slots.length === 0 || rating} title={t("mix.rateHint")}>
          <Icon name="refresh" size={11} stroke={1.6} />
          {rating ? t("fil.working") : t("mix.rateShort")}
        </button>
      </div>
      <div className="kv" style={{ gridTemplateColumns: "76px minmax(0, 1fr)" }}>
        <span>{t("mix.howMany")}</span>
        <span className={hl("assignmentMode", "maxComponents")}>
        <Segmented
          flat
          label={t("mix.howMany")}
          value={mixMode}
          onChange={(next) =>
            next === "1" ? set({ assignmentMode: "physical-only" }) : set({ assignmentMode: "physical-and-virtual", maxComponents: next === "3" ? 3 : 2 })
          }
          options={[
            { value: "1", label: t("mix.onlySingle"), title: t("mix.physicalOnly") },
            { value: "2", label: t("mix.upTo2") },
            { value: "3", label: t("mix.upTo3") },
          ]}
        />
        </span>
        {mixingBlockedBy && (
          <>
            <span />
            <span className={physicalOnlyMode ? "muted" : "warn"}>{t("mix.printerNoMixing", { name: mixingBlockedBy })}</span>
          </>
        )}
        <span title={t("mix.resolutionHint")}>{t("mix.ratioStep")}</span>
        <select className={hl("recipeResolution")} value={settings.recipeResolution} disabled={physicalOnlyMode} title={t("mix.resolutionHint")} onChange={(e) => set({ recipeResolution: e.target.value as MixSettings["recipeResolution"] })}>
          <option value="thirds">1/3</option>
          <option value="half-thirds">50% + 1/3</option>
          <option value="grid25">25% + 1/3</option>
          <option value="grid20">20% + 1/3</option>
          <option value="grid10">10% + 1/3</option>
          <option value="grid5">5% + 1/3</option>
        </select>
      </div>
      {scores && (
        <div className="rating" role="table" aria-label={t("mix.rateAria")}>
          <div className="rating-row head" role="row">
            <span role="columnheader">{t("mix.rateColSetting")}</span>
            <span role="columnheader" className="num">
              {t("mix.rateColFidelity")}
            </span>
            <span role="columnheader" className="num" title={t("mix.rateErrorHint")}>
              {t("mix.rateColErrorShort")}
            </span>
            <span role="columnheader" className="num" title={t("mix.rateHint")}>
              {t("mix.rateColCycleShort")}
            </span>
          </div>
          {[...scores]
            .sort((a, b) => b.fidelity - a.fidelity)
            .map((score) => {
              const active = isActive(score);
              const recommended = best === score;
              return (
                <button
                  key={`${score.maxComponents}-${score.recipeResolution}`}
                  type="button"
                  role="row"
                  className={`rating-row${recommended ? " best" : ""}${active ? " now" : ""}`}
                  title={active ? t("mix.rateCurrent") : t("mix.rateApplyHint")}
                  onClick={() => !active && apply(score)}
                >
                  <span role="cell" className="mono">
                    {t("mix.rateSettingShort", { components: score.maxComponents, resolution: resolutionShort(score.recipeResolution) })}
                    {recommended && <span className="star"> ★</span>}
                    {active && <span className="now-tag"> {t("mix.now")}</span>}
                    {score.lost > 0 && <span className="swap-bad"> ⚠{score.lost}</span>}
                  </span>
                  <span role="cell" className="num mono strong">
                    {Math.round(score.fidelity)}
                  </span>
                  <span role="cell" className="num mono">
                    {score.meanError.toFixed(1)}
                  </span>
                  <span role="cell" className="num mono" title={layerHeight ? `${(score.maxCycleLayers * layerHeight).toFixed(2)}mm` : undefined}>
                    {t("matrix.layers", { n: score.maxCycleLayers })}
                  </span>
                </button>
              );
            })}
        </div>
      )}
      {best && !isActive(best) && (
        <button type="button" className="recommend" title={t("mix.rateHint")} onClick={() => apply(best)}>
          <span>
            <span className="star">★</span> {t("mix.recommendApply", { components: best.maxComponents, resolution: resolutionShort(best.recipeResolution) })}
          </span>
          <span className="mono sub">
            {t("mix.recommendDelta", {
              a: fidelity !== null ? Math.round(fidelity) : "–",
              b: Math.round(best.fidelity),
              c: longestCycle,
              d: best.maxCycleLayers,
            })}
          </span>
        </button>
      )}
      {best && isActive(best) && <p className="muted">{t("mix.recommendOn", { s: resolutionLabel(best.recipeResolution) })}</p>}
      <button type="button" className="text-link" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)} style={{ alignSelf: "flex-start" }}>
        {t("clean.advanced")} {showAdvanced ? "▾" : "▸"}
      </button>
      {showAdvanced && (
        <div style={{ display: "grid", gap: 6 }}>
          <Row label={t("mix.model")} className={hl("mixPriority")}>
            <select value={settings.mixPriority} disabled={physicalOnlyMode} onChange={(e) => set({ mixPriority: e.target.value as MixSettings["mixPriority"] })}>
              <option value="accurate">{t("mix.modelAccurate")}</option>
              <option value="preserve-hue">{t("mix.modelHue")}</option>
              <option value="avoid-muddy">{t("mix.modelAccent")}</option>
            </select>
          </Row>
          <Row label={t("mix.mapping")} className={hl("mappingStrategy")}>
            <select value={settings.mappingStrategy} onChange={(e) => set({ mappingStrategy: e.target.value as MixSettings["mappingStrategy"] })}>
              <option value="closest">{t("mix.mapClosest")}</option>
              <option value="smooth">{t("mix.mapSmooth")}</option>
              <option value="preserve-hue">{t("mix.mapHue")}</option>
              <option value="preserve-accent">{t("mix.mapAccent")}</option>
              <option value="warm-neutral">{t("mix.mapWarm")}</option>
            </select>
          </Row>
          <Row label={t("mix.metric")}>
            <select value={settings.colourDifferenceMetric} onChange={(e) => set({ colourDifferenceMetric: e.target.value as MixSettings["colourDifferenceMetric"] })}>
              <option value="ciede2000">CIEDE2000 (ΔE00)</option>
              <option value="cie76">CIE76 (ΔE76)</option>
            </select>
          </Row>
          <Row label={t("mix.accent")} className={hl("accentProtection")}>
            <select value={settings.accentProtection} onChange={(e) => set({ accentProtection: e.target.value as MixSettings["accentProtection"] })}>
              <option value="off">{t("mix.accentOff")}</option>
              <option value="balanced">{t("mix.accentBalanced")}</option>
              <option value="strong">{t("mix.accentStrong")}</option>
            </select>
          </Row>
          <Row label={t("mix.lightness")} hint={t("mix.lightnessHint")}>
            <NumberField value={settings.previewLightnessOffset} min={-90} max={30} step={2} width={70} onChange={(v) => set({ previewLightnessOffset: v })} />
          </Row>
          <Row label={t("mix.pureThreshold")} hint={t("mix.pureThresholdHint")}>
            <NumberField value={settings.purePhysicalThreshold} min={0.5} max={1} step={0.005} width={70} onChange={(v) => set({ purePhysicalThreshold: v })} />
          </Row>
          <Row label={t("mix.autoDirect")} hint={t("mix.autoDirectHint")} className={hl("autoPhysicalDirect", "physicalDirectDeltaE")}>
            <input type="checkbox" checked={settings.autoPhysicalDirect} onChange={(e) => set({ autoPhysicalDirect: e.target.checked })} />
            <NumberField value={settings.physicalDirectDeltaE} min={0} max={30} step={0.5} width={58} onChange={(v) => set({ physicalDirectDeltaE: v })} />
          </Row>
        </div>
      )}
    </section>
  );
}
