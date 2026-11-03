import { MAX_PAINTABLE_EXTRUDER_ID } from "@core/paintCodes";
import type { Template3mfInfo } from "@core/template3mf";
import { combineTurns, sameTurn, turnMode, turnRows, type FixedCoordinateMode } from "@core/orientation";
import { rgbToHex } from "@core/colour";
import { deltaE2000, rgbToLab } from "@core/prusaFdmMixer";
import { PRINT_PRESETS } from "@core/printPresets";
import type { ExportSettings, FilamentSettings } from "../engine/types";
import { hexToRgb } from "../engine/mesh";
import { BAMBU_STUDIO_MAX_FILAMENTS, PRINTERS, templateFitsPrinter, type Printer } from "../engine/printers";
import { useT } from "../i18n";
import { NumberField, Row, Swatch } from "./common";
import { HelpTip } from "./HelpTip";
import type { MatrixSummary } from "./MappingMatrix";
import { Icon } from "./Shell";

export interface ExportCheck {
  physicalCount: number;
  virtualIds: number[];
  renumbered: Array<{ from: number; to: number }>;
  failures: string[];
}

export interface NomadPanelState {
  canExport: boolean;
  colourCount: number;
  onExport: () => void;
  onImport: (file: File) => void;
  report: { message: string; warnings: string[] } | null;
}

type TranslateKey = Parameters<ReturnType<typeof useT>>[0];

/** The printer's product name, or the UI's own words for the catch-all entries. */
export function printerLabel(printer: Printer, t: ReturnType<typeof useT>): string {
  return printer.name || t(`printer.name_${printer.id}` as TranslateKey);
}

/** The groups of the picker, most used first: filament machines, then the others, then colour printers. */
const PRINTER_GROUPS: Array<{ key: TranslateKey; match: (printer: Printer) => boolean }> = [
  { key: "exp.printerGroupMajor", match: (p) => p.kind === "fdm" && p.tier === "major" },
  { key: "exp.printerGroupMinor", match: (p) => p.kind === "fdm" && p.tier === "minor" },
  { key: "exp.printerGroupColour", match: (p) => p.kind === "colour" },
];

const FORMAT_LABEL: Record<"3mf" | "obj" | "wrl" | "ply", string> = { "3mf": "3MF", obj: "OBJ + MTL", wrl: "VRML (.wrl)", ply: "PLY" };

const FACES = [
  ["front", "exp.coordFaceFront"],
  ["back", "exp.coordFaceBack"],
  ["left", "exp.coordFaceLeft"],
  ["right", "exp.coordFaceRight"],
  ["top", "exp.coordFaceTop"],
  ["bottom", "exp.coordFaceBottom"],
] as const;

/**
 * "This face on the bed", counted from the model standing the way its file
 * says (`base`): the mode each face makes.  Counted from the raw file instead,
 * "front" on a Y-up OBJ only stood it up.  Each is written as its own turn so
 * no two choices share a value (on an OBJ, "back" is the same turn as "keep").
 */
export function faceChoices(base: FixedCoordinateMode): Array<{ mode: FixedCoordinateMode; label: (typeof FACES)[number][1] }> {
  return FACES.map(([face, label]) => ({
    mode: turnMode(combineTurns(turnRows(`face-${face}`), turnRows(base)), true),
    label,
  }));
}

/** Which face of the upright model is on the bed, when it is one of the six. */
export function faceOnBed(mode: ExportSettings["coordinateMode"], base: FixedCoordinateMode): (typeof FACES)[number][1] | null {
  if (mode === "auto" || mode === "stand-up") return null;
  return faceChoices(base).find((face) => sameTurn(face.mode, mode))?.label ?? null;
}

export function ExportSection({
  settings,
  orientationBase,
  onChange,
  check,
  finalCheck,
  onExport,
  busy,
  templateInfo,
  defaultFileName,
  nomad,
  filaments,
  onAdoptTemplateColours,
  onUndoAdoptTemplateColours,
  configIncluded: configIncludedProp,
  lastExport,
  onDownloadAgain,
  outcome,
  summary,
  print,
  printer,
  onChoosePrinter,
  printerNotice,
  slotCount,
  onOpenGather,
}: {
  settings: ExportSettings;
  /** How the loaded file stands by itself (OBJ Y-up, 3MF as is): what the face choices count from. */
  orientationBase: FixedCoordinateMode;
  onChange: (next: ExportSettings) => void;
  check: ExportCheck | null;
  /** The colour result, summarised where the print is started. */
  finalCheck: {
    fidelity: number;
    cycleLayers: number;
    layerHeightMm: number | null;
    lost: Array<{ paletteIndex: number; hex: string }>;
    worstDeltaE: number;
    poorCount: number;
    colourCount: number;
  } | null;
  onExport: () => void;
  busy: boolean;
  templateInfo: Template3mfInfo | null;
  defaultFileName: string;
  nomad: NomadPanelState;
  filaments: FilamentSettings;
  onAdoptTemplateColours: () => void;
  /** Present when the last adoption can still be taken back. */
  onUndoAdoptTemplateColours: (() => void) | null;
  /** True when the export writes the template's printer config. */
  configIncluded: boolean;
  /** The file built by the last export, kept so it can be downloaded again by a plain click. */
  lastExport: { fileName: string; size: number; at: number } | null;
  onDownloadAgain: () => void;
  /** Result of the last export click, shown right under the button so a failure is not missed. */
  outcome: { kind: "ok" | "error"; message: string; at: number } | null;
  /** The matrix's numbers, so the last check reads the same as step 03. */
  summary: MatrixSummary;
  /** Size of the print: height in mm, the layer height it will use, and the layer count. */
  print: {
    heightMm: number | null;
    layerHeight: number | null;
    layers: number | null;
    faceDown: string;
    /** Print size against the printer's bed and build height; fitHeight is the tallest target that fits. */
    fit: { size: { x: number; y: number; z: number }; bed: { x: number; y: number; z: number }; fits: boolean; fitHeight: number } | null;
  };
  /** The printer the file is for. */
  printer: Printer;
  onChoosePrinter: (id: string) => void;
  /** What the last printer pick changed in the plan, with its undo. */
  printerNotice: { changes: string[]; undo: () => void } | null;
  /** Filament slots in use (step 03). */
  slotCount: number;
  /** Opens 모아 뽑기 (several finished files on one bed). */
  onOpenGather: () => void;
}) {
  const t = useT();
  const set = (patch: Partial<ExportSettings>) => onChange({ ...settings, ...patch });
  const faces = faceChoices(orientationBase);
  const choices: string[] = ["blender-y-up", "keep", "stand-up", "auto", "x-up", ...faces.map((face) => face.mode)];
  const current = settings.coordinateMode;
  // A saved value none of the choices spells (an older face name, a ⤓ turn)
  // shows as the choice that turns the model the same way, if there is one.
  const shown = choices.includes(current)
    ? current
    : (faces.find((face) => sameTurn(face.mode, current as FixedCoordinateMode))?.mode ?? current);
  const listed = choices.includes(shown);
  const ok = check !== null && check.failures.length === 0;
  const fdm = printer.kind === "fdm" ? printer : null;
  const prusa = fdm?.slicer === "prusa";
  // Written as a Bambu Studio project: the mixes go in as mixed filaments.
  const bambuProject = Boolean(fdm?.bambuProject);
  const colourFormat = printer.kind === "colour" ? (settings.colourFormat && printer.formats.includes(settings.colourFormat) ? settings.colourFormat : printer.formats[0]) : null;
  // A template made for another printer (an XL config in a CORE One file) is left out.
  const templateFits = templateFitsPrinter(printer, templateInfo?.printerModel);
  const configAvailable = Boolean(templateInfo?.configFound) && templateFits;
  const configIncluded = prusa && settings.includePrinterConfig && configAvailable;
  // Slot colours vs the template's filament colours: the recipes only carry extruder numbers,
  // so E1..En must mean the same filament in the app, in PrusaSlicer and on the printer.
  const templateColours = prusa && templateFits ? (templateInfo?.physicalColours ?? []) : [];
  const slotRows = Array.from({ length: filaments.count }, (_v, i) => {
    const hex = (filaments.hex[i] ?? "#808080").toUpperCase();
    const templateRgb = templateColours[i];
    const templateHex = templateRgb ? rgbToHex(templateRgb) : null;
    const distance = templateRgb ? deltaE2000(rgbToLab(hexToRgb(hex)), rgbToLab(templateRgb)) : 0;
    return { slot: i + 1, hex, name: filaments.names[i] ?? "", templateHex, mismatch: templateHex !== null && distance > 8 };
  });
  const mismatches = slotRows.filter((row) => row.mismatch);
  const templateCountDiffers = templateColours.length > 0 && templateColours.length !== filaments.count;
  // Colour mismatches are overwritten when the template config goes in; a count mismatch never is.
  const slicerWarn = templateCountDiffers || (mismatches.length > 0 && !configIncludedProp);
  const appName = printer.app || t("exp.printerAnyApp");
  // The bed follows the printer; a hand-typed one is pointed out (catch-all entries have no bed of their own).
  const bedEdited = printer.name !== "" && !(prusa && templateFits) && (settings.bedX !== printer.bed.x || settings.bedY !== printer.bed.y);
  return (
    <>
      <section className="pane-section" aria-label={t("exp.printerTitle")}>
        <div className="pane-head">
          <span className="pane-label">
            {t("exp.printerTitle")}
            <HelpTip text={t("exp.printerHint")} />
          </span>
        </div>
        <select className="printer-select" value={printer.id} disabled={busy} onChange={(e) => onChoosePrinter(e.target.value)} aria-label={t("exp.printerTitle")}>
          {PRINTER_GROUPS.map((group) => (
            <optgroup key={group.key} label={t(group.key)}>
              {PRINTERS.filter(group.match).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {printerLabel(entry, t)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="printer-facts muted">
          {fdm
            ? t("exp.printerFactsFdm", {
                app: appName,
                slots: fdm.slots.base === fdm.slots.max ? String(fdm.slots.max) : `${fdm.slots.base}~${fdm.slots.max}`,
                x: fdm.bed.x,
                y: fdm.bed.y,
                mixing: bambuProject ? t("exp.printerMixingBambu") : fdm.layerMixing ? t("exp.printerMixingYes") : t("exp.printerMixingNo"),
              })
            : t("exp.printerFactsColour", { app: appName, x: printer.bed.x, y: printer.bed.y })}
        </div>
        {fdm?.provisional && (
          <div className="warn">
            {t("exp.printerProvisional", { when: new Date(`${fdm.provisional}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" }) })}
          </div>
        )}
        {fdm && slotCount > fdm.slots.max &&<div className="warn">{t("exp.printerTooManySlots", { app: slotCount, max: fdm.slots.max, name: printerLabel(fdm, t) })}</div>}
        {printerNotice && (
          <div className="note printer-notice" role="status">
            <span>
              {t("exp.printerChanged")} {printerNotice.changes.join(" · ")}
            </span>
            <button type="button" className="btn small" onClick={printerNotice.undo}>
              {t("exp.printerUndo")}
            </button>
          </div>
        )}
        {printer.kind === "colour" && (
          <>
            <div className="muted">{t("exp.colourIntro")}</div>
            <div className="quality-list" role="radiogroup" aria-label={t("exp.colourFormat")}>
              {printer.formats.map((format) => (
                <button key={format} type="button" role="radio" aria-checked={colourFormat === format} className="quality" onClick={() => set({ colourFormat: format })}>
                  <span>{FORMAT_LABEL[format]}</span>
                  <span className="muted">{t(`exp.colourFormat_${format}` as TranslateKey)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
      {prusa && (
        <section className="pane-section" aria-label={t("exp.qualityTitle")}>
          <div className="pane-head">
            <span className="pane-label">
              {t("exp.qualityTitle")}
              <HelpTip text={t("exp.qualityHint")} />
            </span>
          </div>
          <div className="quality-list" role="radiogroup" aria-label={t("exp.qualityTitle")}>
            <button type="button" role="radio" aria-checked={settings.printPreset === null} className="quality" onClick={() => set({ printPreset: null })} title={t("exp.qualityTemplateHint")}>
              <span>{t("exp.qualityTemplate")}</span>
              <span className="mono">{templateInfo?.layerHeight ? `${templateInfo.layerHeight.toFixed(2)}mm` : "–"}</span>
            </button>
            {PRINT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={settings.printPreset === preset.id}
                className="quality"
                title={t("exp.qualitySource", { s: preset.source })}
                onClick={() => set({ printPreset: preset.id })}
              >
                <span>{t(`exp.quality_${preset.id}` as TranslateKey)}</span>
                <span className="mono">{preset.layerHeight.toFixed(2)}mm</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="pane-section">
        {print.fit && !print.fit.fits && (
          <div className="note warn-box fit-note">
            <span className="warn">
              {t("exp.fitTooBig", {
                name: printerLabel(printer, t),
                x: print.fit.bed.x,
                y: print.fit.bed.y,
                z: print.fit.bed.z,
              })}
            </span>
            {print.fit.fitHeight >= 1 && (
              <button type="button" className="btn small" disabled={busy} onClick={() => set({ targetHeight: print.fit!.fitHeight })}>
                {t("exp.fitShrink", { h: print.fit.fitHeight })}
              </button>
            )}
          </div>
        )}
        {bedEdited && (
          <div className="note fit-note">
            <span className="muted">{t("exp.bedEdited", { x: settings.bedX, y: settings.bedY, px: printer.bed.x, py: printer.bed.y })}</span>
            <button type="button" className="btn small" disabled={busy} onClick={() => set({ bedX: printer.bed.x, bedY: printer.bed.y })}>
              {t("exp.bedReset")}
            </button>
          </div>
        )}
        <div className="kv">
          <span>{t("exp.height")}</span>
          <span className="mono">{print.heightMm !== null ? `${print.heightMm.toFixed(1)} mm` : "–"}</span>
          {print.fit && (
            <>
              <span>{t("exp.size")}</span>
              <span className={`mono${print.fit.fits ? "" : " warn"}`}>
                {print.fit.size.x.toFixed(0)} × {print.fit.size.y.toFixed(0)} × {print.fit.size.z.toFixed(0)} mm
              </span>
            </>
          )}
          <span>{t("exp.faceDown")}</span>
          <span>{print.faceDown}</span>
          {fdm && (
            <>
              <span>{t("exp.layerCount")}</span>
              <span className="mono">{print.layers !== null ? t("matrix.layers", { n: print.layers.toLocaleString() }) : "–"}</span>
            </>
          )}
        </div>
      </section>
      {fdm && finalCheck && (
        <section className="pane-section" aria-label={t("exp.groupCheck")}>
          <span className="pane-label">{t("exp.groupCheck")}</span>
          <div className="kv" style={{ gridTemplateColumns: "112px minmax(0, 1fr)" }}>
            <span>{t("glossary.fidelityTerm")}</span>
            <span className="mono">
              {Math.round(finalCheck.fidelity)} <span className="muted">/ 100</span>
            </span>
            <span>{t("exp.checkColoursShort")}</span>
            <span className="mono">{t("exp.coloursSplit", { n: finalCheck.colourCount, s: summary.singles, m: summary.mixes })}</span>
            <span>{t("matrix.factAverage")}</span>
            <span className="mono">{summary.averageDeltaE.toFixed(1)}</span>
            {summary.worst && (
              <>
                <span>{t("matrix.factWorst")}</span>
                <span className={`mono ${summary.worst.deltaE > 5 ? "warn" : ""}`}>
                  {summary.worst.hex} {summary.worst.deltaE.toFixed(1)}
                </span>
              </>
            )}
            <span>{t("exp.longestRepeat")}</span>
            <span className="mono">
              {finalCheck.layerHeightMm ? `${(finalCheck.cycleLayers * finalCheck.layerHeightMm).toFixed(1)} mm` : t("matrix.layers", { n: finalCheck.cycleLayers })}
            </span>
          </div>
          {finalCheck.lost.length > 0 && (
            <div className="swap-bad">
              ⚠ {t("fil.lostNow", { n: finalCheck.lost.length })}{" "}
              {finalCheck.lost.map((colour) => (
                <span key={colour.paletteIndex} className="cell-colour" style={{ marginRight: 6 }}>
                  <Swatch hex={colour.hex} />#{colour.paletteIndex}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
      <details className="pane-details">
        <summary>{t("exp.groupFile")}</summary>
        <div className="pane-details-body">
      <Row label={t("exp.fileName")}>
        <input type="text" value={settings.fileName} placeholder={defaultFileName} style={{ width: 230 }} onChange={(e) => set({ fileName: e.target.value })} />
      </Row>
      <Row label={t("exp.coordinates")} hint={t("exp.coordinatesHint")}>
        <select value={shown} onChange={(e) => set({ coordinateMode: e.target.value as ExportSettings["coordinateMode"] })}>
          <option value="blender-y-up">{t("exp.coordYUp")}</option>
          <option value="keep">{t("exp.coordKeep")}</option>
          <option value="stand-up">{t("exp.coordStandUp")}</option>
          <option value="auto">{t("exp.coordAuto")}</option>
          <option value="x-up">{t("exp.coordXUp")}</option>
          <optgroup label={t("exp.coordFaceGroup")}>
            {faces.map((face) => (
              <option key={face.label} value={face.mode}>
                {t(face.label)}
              </option>
            ))}
          </optgroup>
          {!listed && <option value={settings.coordinateMode}>{t("exp.coordTurn")}</option>}
        </select>
      </Row>
      <Row label={t("exp.scaleHeight")} hint={t("exp.scaleHeightHint")}>
        <NumberField value={settings.scale} min={0.001} step={0.1} width={70} onChange={(v) => set({ scale: v > 0 ? v : 1 })} />
        <input
          type="number"
          placeholder={t("exp.optional")}
          value={settings.targetHeight ?? ""}
          min={1}
          style={{ width: 80 }}
          onChange={(e) => set({ targetHeight: e.target.value ? Number(e.target.value) : null })}
        />
      </Row>
      {fdm && (
        <Row label={t("exp.splitObjects")} hint={t("exp.splitObjectsHint")}>
          <input type="checkbox" checked={settings.splitObjects} onChange={(e) => set({ splitObjects: e.target.checked })} />
        </Row>
      )}
      {fdm && prusa && settings.splitObjects && (
        <Row label={t("exp.splitAsParts")} hint={t("exp.splitAsPartsHint")}>
          <input type="checkbox" checked={settings.splitAsParts} onChange={(e) => set({ splitAsParts: e.target.checked })} />
        </Row>
      )}
      <Row label={t("exp.bedPlace")}>
        <input type="checkbox" checked={settings.putOnBed} onChange={(e) => set({ putOnBed: e.target.checked })} />
        <input type="checkbox" checked={settings.centerOnBed} onChange={(e) => set({ centerOnBed: e.target.checked })} />
      </Row>
      <Row
        label={t("exp.bedSize")}
        hint={prusa && templateFits && templateInfo?.bedSize ? t("exp.bedFromTemplate", { x: templateInfo.bedSize.x, y: templateInfo.bedSize.y }) : t("exp.bedFromPrinter", { x: printer.bed.x, y: printer.bed.y })}
      >
        <NumberField value={settings.bedX} min={10} width={70} onChange={(v) => set({ bedX: v })} />
        <span className="muted">×</span>
        <NumberField value={settings.bedY} min={10} width={70} onChange={(v) => set({ bedY: v })} />
      </Row>
      {fdm && (
        <Row label={t("exp.defaultExtruder")}>
          <NumberField value={settings.defaultExtruder} min={1} max={filaments.count} width={60} onChange={(v) => set({ defaultExtruder: Math.max(1, Math.min(filaments.count, Math.round(v))) })} />
        </Row>
      )}
      {prusa && (
        <Row label={t("exp.includeConfig")} hint={t("exp.includeConfigHint")}>
          <input type="checkbox" checked={configIncluded} disabled={!configAvailable} onChange={(e) => set({ includePrinterConfig: e.target.checked })} />
          <span className="muted">
            {configAvailable
              ? t("exp.configFromTemplate")
              : templateInfo?.configFound
                ? t("exp.configOtherPrinter", { model: templateInfo.printerModel ?? "?" })
                : t("exp.configNoTemplate")}
          </span>
        </Row>
      )}
        </div>
      </details>
      {fdm && (
        <details className="pane-details" open={!ok || mismatches.length > 0 || templateCountDiffers}>
          <summary>
            {t("exp.checksTitle")}
            <span className={!ok ? "danger" : slicerWarn ? "warn" : "ok"}>
              {check ? (!ok ? t("exp.badgeFail", { n: check.failures.length }) : slicerWarn ? t("exp.badgeSlicerWarn") : t("exp.badgeOk")) : t("load.noModel")}
            </span>
          </summary>
          <div className="pane-details-body">

        {check && (
          <div className="note">
            <div className="check-list">
              {fdm.layerMixing ? (
                <div className={check.failures.some((f) => /contiguous/.test(f)) ? "fail" : ""}>
                  {t("exp.checkContiguous", {
                    range: check.virtualIds.length > 0 ? `VE${check.virtualIds[0]}~VE${check.virtualIds[check.virtualIds.length - 1]}` : t("exp.noVirtual"),
                  })}
                  {check.renumbered.length > 0 ? t("exp.renumbered", { list: check.renumbered.map((r) => `${r.from}→${r.to}`).join(", ") }) : ""}
                </div>
              ) : (
                <div className={check.virtualIds.length > 0 ? "fail" : ""}>{t("exp.checkNoMixing", { app: appName })}</div>
              )}
              <div className={check.failures.some((f) => /at most \d+/.test(f)) || slotCount > fdm.slots.max ? "fail" : ""}>
                {fdm.layerMixing
                  ? t("exp.checkLimit", { p: check.physicalCount, v: check.virtualIds.length, t: check.physicalCount + check.virtualIds.length, max: bambuProject ? BAMBU_STUDIO_MAX_FILAMENTS : MAX_PAINTABLE_EXTRUDER_ID })
                  : t("exp.checkSlots", { p: check.physicalCount, max: fdm.slots.max })}
              </div>
              <div className={check.failures.some((f) => /JSON|defined/.test(f)) ? "fail" : ""}>{t("exp.checkStates")}</div>
              <div className={check.failures.some((f) => /outside|Unpainted/.test(f)) ? "fail" : ""}>{t("exp.checkPhysical", { p: check.physicalCount })}</div>
              {prusa ? (
                <div>{t("exp.checkConfig", { state: configIncluded ? t("exp.configStateIncluded") : t("exp.configStateOmitted") })}</div>
              ) : bambuProject ? (
                <div>{t("exp.checkBambuProject", { p: check.physicalCount, m: check.virtualIds.length })}</div>
              ) : (
                <div>{t("exp.checkPaintBambu", { app: appName })}</div>
              )}
              <div>{t("exp.checkThumbnail")}</div>
            </div>
            {check.failures.length > 0 && (
              <ul className="rules danger">
                {check.failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className={`note slicer-check${mismatches.length > 0 || templateCountDiffers ? " warn-box" : ""}`}>
          <b>{t("exp.slicerTitle")}</b>
          <div className="muted">
            {prusa ? t("exp.slicerIntro") : bambuProject ? t("exp.slicerIntroBambu", { n: filaments.count }) : t("exp.slicerIntroOther", { app: appName, n: filaments.count })}
          </div>
          <div className="slot-list">
            {slotRows.map((row) => (
              <span key={row.slot} className={`slot-chip${row.mismatch ? " mismatch" : ""}`}>
                <b>E{row.slot}</b>
                <Swatch hex={row.hex} size={14} />
                <code>{row.hex}</code>
                {row.name && row.name !== `E${row.slot}` && <span className="muted">{row.name}</span>}
                {row.mismatch && row.templateHex && (
                  <span className="muted">
                    ≠ <Swatch hex={row.templateHex} size={12} /> {row.templateHex}
                  </span>
                )}
              </span>
            ))}
          </div>
          {!prusa ? null : templateColours.length === 0 ? (
            <div className="muted">
              {templateInfo?.configFound && !templateFits ? t("exp.configOtherPrinter", { model: templateInfo.printerModel ?? "?" }) : t("exp.slicerNoTemplate")}
            </div>
          ) : mismatches.length === 0 && !templateCountDiffers ? (
            <div className="ok">{t("exp.slicerMatch", { name: templateInfo?.fileName ?? "" })}</div>
          ) : (
            <div className="inline">
              <span className={configIncludedProp && !templateCountDiffers ? "muted" : "warn"}>
                {templateCountDiffers
                  ? filaments.count > templateColours.length
                    ? t("exp.slicerCountTooMany", { app: filaments.count, template: templateColours.length, from: templateColours.length + 1 })
                    : t("exp.slicerCountDiffers", { app: filaments.count, template: templateColours.length })
                  : configIncludedProp
                    ? t("exp.slicerMismatchOverwritten", { list: mismatches.map((row) => `E${row.slot}`).join(", ") })
                    : t("exp.slicerMismatch", { list: mismatches.map((row) => `E${row.slot}`).join(", ") })}
              </span>
              <button
                type="button"
                className="btn small adopt-template"
                disabled={busy}
                title={t("exp.slicerAdoptHint")}
                onClick={onAdoptTemplateColours}
              >
                {t("exp.slicerAdopt")}
              </button>
            </div>
          )}
          {prusa && onUndoAdoptTemplateColours && (
            <div className="inline">
              <span className="muted">{t("exp.slicerAdoptDone")}</span>
              <button type="button" className="btn small" disabled={busy} onClick={onUndoAdoptTemplateColours}>
                {t("exp.slicerAdoptUndo")}
              </button>
            </div>
          )}
        </div>
          </div>
        </details>
      )}

      <details className="pane-details">
        <summary>{t("exp.nomadTitle")}</summary>
        <div className="pane-details-body">
          <p className="muted">{t("exp.nomadIntro")}</p>
          <div className="inline">
            <button type="button" className="btn" disabled={busy || !nomad.canExport} onClick={nomad.onExport}>
              {t("exp.nomadExport", { n: nomad.colourCount })}
            </button>
            <label className="btn">
              {t("exp.nomadImport")}
              <input
                type="file"
                accept=".obj,text/plain"
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) nomad.onImport(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {nomad.report && (
            <div className="note">
              <div>{nomad.report.message}</div>
              {nomad.report.warnings.map((w) => (
                <div key={w} className="warn">
                  {w}
                </div>
              ))}
            </div>
          )}
          <div className="muted">{t("exp.nomadRules")}</div>
          <ul className="rules">
            <li>{t("exp.rule1")}</li>
            <li>{t("exp.rule2")}</li>
            <li>{t("exp.rule3")}</li>
            <li>{t("exp.rule4")}</li>
            <li>{t("exp.rule5")}</li>
          </ul>
        </div>
      </details>
      <section className="pane-section gather-entry" aria-label={t("gather.entryTitle")}>
        <span className="pane-label">{t("gather.entryTitle")}</span>
        <p className="muted">{t("gather.entryText")}</p>
        <div className="inline">
          <button type="button" className="btn soft" onClick={onOpenGather}>
            <Icon name="layers" size={14} stroke={1.6} />
            {t("gather.open")}
          </button>
        </div>
      </section>
      <div className="sidebar-foot">
        {outcome && (
          <div className={`export-outcome ${outcome.kind}`} role={outcome.kind === "error" ? "alert" : "status"}>
            <b>{outcome.kind === "ok" ? t("exp.outcomeOkTitle") : t("exp.outcomeErrorTitle")}</b>
            <pre>{outcome.message}</pre>
          </div>
        )}
        <button type="button" className="btn primary big" disabled={busy || !ok} onClick={onExport} title={t("exp.downloadHint")}>
          <Icon name="download" size={14} stroke={1.7} />
          {colourFormat ? t("exp.exportColour", { format: FORMAT_LABEL[colourFormat] }) : t("top.export")}
        </button>
        <span className="hint">
          {settings.fileName || defaultFileName} · {prusa ? t("exp.openHint") : bambuProject ? t("exp.openHintBambu") : printer.app ? t("exp.openHintApp", { app: printer.app }) : t("exp.openHintAny")}
        </span>
        {lastExport && (
          <button type="button" className="text-link download-again" onClick={onDownloadAgain} title={t("exp.downloadAgainHint")}>
            {t("exp.downloadAgain", { file: lastExport.fileName, size: `${(lastExport.size / (1024 * 1024)).toFixed(1)} MB` })}
          </button>
        )}
      </div>
    </>
  );
}
