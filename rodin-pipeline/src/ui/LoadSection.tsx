import { useState } from "react";
import type { MeshModel, PaletteEntry } from "@core/types";
import type { Template3mfInfo } from "@core/template3mf";
import { rgbToHex } from "@core/colour";
import type { PaletteSettings } from "../engine/types";
import { useT } from "../i18n";
import { Row, Section, Swatch, pct } from "./common";
import { ColourPicker } from "./ColourPicker";

export interface SourceInfo {
  kind: "rodin" | "obj" | "nomad";
  fileName: string;
  uniqueColours: number;
  rodin?: {
    paletteHex: string[];
    usedPaletteNumbers: number[];
    warnings: string[];
    paletteSource: "project_settings" | "full_spectrum" | "fallback";
    paletteCount: number;
    usedColourCount: number;
    unpaintedTriangleCount: number;
  };
}

export interface WorkState {
  /** The model came back from the browser autosave on startup. */
  restored: boolean;
  /** Undo steps available. */
  undoSteps: number;
  /** The colours differ from the loaded file's own. */
  changed: boolean;
}

/** Where the autosave lives: files in the app's folder, or the browser (asked to keep it or not, or not known). */
export type WorkStore = "folder" | "kept" | "notKept" | "browser";

function Dropzone({
  accept,
  title,
  hint,
  disabled,
  onFile,
}: {
  accept: string;
  title: string;
  hint: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <label
      className={`dropzone${active ? " active" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !disabled) onFile(file);
      }}
    >
      <strong>{title}</strong>
      <span className="muted">{hint}</span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}

export function LoadSection({
  model,
  sourceInfo,
  busy,
  onModelFile,
  templateInfo,
  onTemplateFile,
  onClearTemplate,
  palette,
  rememberTemplate,
  onRememberTemplate,
  rememberWork,
  onRememberWork,
  workState,
  onClearWork,
  onSaveWork,
  saveState,
  onRevertOriginal,
  workStore,
  onRecolour,
  onOpenGather,
}: {
  model: MeshModel | null;
  sourceInfo: SourceInfo | null;
  busy: boolean;
  onModelFile: (file: File) => void;
  templateInfo: Template3mfInfo | null;
  onTemplateFile: (file: File) => void;
  onClearTemplate: () => void;
  palette: PaletteEntry[];
  rememberTemplate: boolean;
  onRememberTemplate: (next: boolean) => void;
  rememberWork: boolean;
  onRememberWork: (next: boolean) => void;
  workState: WorkState | null;
  onClearWork: () => void;
  /** Saves the work as a file of the person's own (.gyuroma). */
  onSaveWork: () => void;
  saveState: "idle" | "saving" | "saved";
  onRevertOriginal: () => void;
  workStore: WorkStore;
  onRecolour: (hex: string, next: string) => void;
  /** Opens 모아 뽑기 (several finished files on one bed). */
  onOpenGather: () => void;
}) {
  const t = useT();
  const rodin = sourceInfo?.rodin;
  const bedText = templateInfo?.bedSize
    ? t("load.bed", { x: templateInfo.bedSize.x.toFixed(0), y: templateInfo.bedSize.y.toFixed(0) })
    : t("load.noBed");
  return (
    <Section step={1} title={t("load.title")} subtitle={t("load.subtitle")} help={t("help.load")} badge={model ? t("load.faces", { n: model.stats.triangleCount.toLocaleString() }) : t("load.noModel")}>
      <Dropzone accept=".3mf,.obj,.gyuroma" title={t("load.dropTitle")} hint={t("load.dropHint")} disabled={busy} onFile={onModelFile} />
      <button type="button" className="text-link iris load-gather" onClick={onOpenGather}>
        {t("load.gather")}
      </button>
      {model && sourceInfo && (
        <div className="note">
          <div className="stats">
            <span>{t("load.file")}</span>
            <b title={sourceInfo.fileName}>{sourceInfo.fileName}</b>
            <span>{t("load.facesVertices")}</span>
            <b>
              {model.stats.triangleCount.toLocaleString()} / {model.stats.vertexCount.toLocaleString()}
            </b>
            <span>{t("load.uniqueColours")}</span>
            <b>{sourceInfo.uniqueColours}</b>
            {rodin && (
              <>
                <span>{t("load.rodinPalette")}</span>
                <b>
                  {t("load.paletteUsed", { count: rodin.paletteCount, used: rodin.usedColourCount })}
                  {rodin.paletteSource === "fallback" ? t("load.paletteFallback") : rodin.paletteSource === "full_spectrum" ? t("load.paletteMixTable") : ""}
                </b>
                {/* A print file (an export): its colours are the filaments and mixes, not the model's own. */}
                {rodin.paletteSource === "full_spectrum" && <span className="load-note warn">{t("load.printFileNote")}</span>}
              </>
            )}
            {rodin && rodin.unpaintedTriangleCount > 0 && (
              <>
                <span>{t("load.unpainted")}</span>
                <b className="warn">{t("load.unpaintedValue", { n: rodin.unpaintedTriangleCount.toLocaleString() })}</b>
              </>
            )}
            {workState && (
              <>
                <span>{t("load.work")}</span>
                <b className="work-state">
                  {workState.restored ? `${t("load.workRestored")} · ` : ""}
                  {!workState.changed
                    ? t("load.workUnmodified")
                    : workState.undoSteps > 0
                      ? t("load.workModified", { n: workState.undoSteps })
                      : t("load.workModifiedNoUndo")}
                </b>
              </>
            )}
          </div>
          {rodin && (
            <div className="swatch-row" style={{ marginTop: 6 }}>
              {rodin.paletteHex.map((hex, i) => {
                const used = rodin.usedPaletteNumbers.includes(i + 1);
                return <Swatch key={`${hex}-${i}`} hex={hex} title={`E${i + 1} ${hex}${used ? "" : ` ${t("load.unused")}`}`} size={20} />;
              })}
            </div>
          )}
          {rodin?.warnings.map((w) => (
            <div key={w} className="muted warn">
              {w}
            </div>
          ))}
          <div className="inline" style={{ marginTop: 6 }}>
            <button type="button" className="btn small primary save-work" disabled={busy || saveState === "saving"} title={t("load.saveWorkHint")} onClick={onSaveWork}>
              {saveState === "saving" ? t("load.saving") : saveState === "saved" ? t("load.saved") : t("load.saveWork")}
            </button>
            {workState?.changed && (
              <button type="button" className="btn small revert-original" disabled={busy} title={t("load.revertHint")} onClick={onRevertOriginal}>
                {t("load.revert")}
              </button>
            )}
            <button type="button" className="btn small danger new-work" disabled={busy} onClick={onClearWork}>
              {t("load.newWork")}
            </button>
          </div>
        </div>
      )}
      <label className="inline remember-work" style={{ gap: 8 }}>
        <input type="checkbox" checked={rememberWork} onChange={(e) => onRememberWork(e.target.checked)} />
        <span className="muted">{t("load.rememberWork")}</span>
      </label>
      {rememberWork && (
        <div className={`muted work-store${workStore === "notKept" ? " warn" : ""}`}>
          {t(workStore === "folder" ? "load.storeFolder" : workStore === "kept" ? "load.storeKept" : workStore === "notKept" ? "load.storeNotKept" : "load.storeBrowser")}
        </div>
      )}
      <details className="template-block">
        <summary className={templateInfo ? "template-summary attached" : "template-summary muted"}>
          {templateInfo ? (
            <>
              {t("load.templateSummaryNamed", { name: templateInfo.fileName })} <span className="muted">· {bedText}</span>
            </>
          ) : (
            t("load.templateSummaryNone")
          )}
        </summary>
        <div className="template-card">
          {templateInfo ? (
            <div className="note">
              <div className="stats">
                <span>{t("load.currentTemplate")}</span>
                <b title={templateInfo.fileName}>{templateInfo.fileName}</b>
                <span>{t("load.bedLabel")}</span>
                <b>{bedText}</b>
                <span>{t("load.configLabel")}</span>
                <b>{templateInfo.configFound ? t("load.configFound") : t("load.noConfig")}</b>
                <span>{t("load.templateColoursLabel")}</span>
                <b>
                  {templateInfo.physicalColours.length > 0 ? (
                    <span className="swatch-row" style={{ display: "inline-flex" }}>
                      {templateInfo.physicalColours.map((rgb, i) => (
                        <Swatch key={`${rgbToHex(rgb)}-${i}`} rgb={rgb} size={14} title={`E${i + 1} ${templateInfo.physicalNames[i] ?? ""} ${rgbToHex(rgb)}`.replace(/\s+/g, " ")} />
                      ))}
                      <span className="muted">
                        {t("load.templateColours", { n: templateInfo.physicalColours.length })}
                        {templateInfo.physicalNames.length > 0 ? ` · ${templateInfo.physicalNames.slice(0, templateInfo.physicalColours.length).join(", ")}` : ""}
                      </span>
                    </span>
                  ) : (
                    t("load.templateNoColours")
                  )}
                </b>
              </div>
              <div className="inline" style={{ marginTop: 6 }}>
                <button type="button" className="btn small" onClick={onClearTemplate}>
                  {t("load.removeTemplate")}
                </button>
              </div>
            </div>
          ) : (
            <div className="muted template-none">{rememberTemplate ? t("load.templateRememberedNone") : t("load.templateNone")}</div>
          )}
          <Dropzone
            accept=".3mf"
            title={templateInfo ? t("load.templateReplace") : t("load.templateChoose")}
            hint={t("load.templateHint")}
            disabled={busy}
            onFile={onTemplateFile}
          />
          <label className="inline" style={{ gap: 8 }}>
            <input type="checkbox" checked={rememberTemplate} onChange={(e) => onRememberTemplate(e.target.checked)} />
            <span className="muted">{t("load.rememberTemplate")}</span>
          </label>
        </div>
      </details>
    </Section>
  );
}
