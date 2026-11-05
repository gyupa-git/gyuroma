import { useState } from "react";
import type { AttachedImage } from "./attachImage";
import { ConsultBox } from "./ConsultBox";
import { TIDY_CONSULT_PRESETS, TIDY_PRESETS, type ChangeLine, type TidyConsultPreset, type TidyLogEntry, type TidyPreset, type TidyScope } from "../engine/tidy";
import type { TidyArea } from "../engine/tidyArea";
import type { AiRoute, KeyUsage } from "../engine/aiClient";
import { useT } from "../i18n";
import { GyupaSpin } from "./GyupaLoader";
import { HelpTip } from "./HelpTip";
import { Segmented } from "./Shell";

/** How the consult reaches Claude, and the owner's own key for when this computer has no Claude login. */
export interface AiConnection {
  /** null = no way yet (presets only until a key is put in). */
  route: AiRoute | null;
  keyMask: string | null;
  usage: KeyUsage;
  onSaveKey: (key: string) => void;
  onClearKey: () => void;
}

export interface TidyResultCard {
  /** Log entry the change belongs to (its ↩ undoes it). */
  entryId: string;
  title: string;
  lines: ChangeLine[];
  undone: boolean;
  dropped?: string[];
  /** Faces a picked-patch tidy changed (the settings stay as they are there). */
  faces?: number;
}

/**
 * ✨ Auto tidy: where it applies (the whole model or the picked patches), which
 * settings it changes, four presets that apply at once (what each would change
 * shows before it is pressed), the last change
 * (count, before → after, ↩ undo) right under them, and the 💬 consult with
 * Claude — it looks at the model from several sides and changes the same
 * knobs, or proposes changes when it was only asked.
 */
export function TidyPanel({
  scope,
  onScope,
  area,
  onArea,
  pickedCount,
  previewPreset,
  onPreset,
  result,
  onUndo,
  undoCount,
  highlight,
  onHideHighlight,
  ai,
  consult = true,
  log,
  busy,
  elapsed,
  onSend,
  onAnalyse,
  onStop,
  onApplySuggestion,
  onConsultPreset,
  onApplyPreview,
  onCancelEntry,
  canCancel,
  onAuto,
  parts,
  partView,
  onPartView,
  onRedoParts,
  onFocusPart,
  focusBusy = null,
  connection,
  disabled,
}: {
  scope: TidyScope;
  onScope: (scope: TidyScope) => void;
  area: TidyArea;
  onArea: (area: TidyArea) => void;
  /** Patches picked in 3D (the picked-only area needs at least one). */
  pickedCount: number;
  /** What a preset would change now; null when there is no model. */
  previewPreset: (id: TidyPreset["id"]) => ChangeLine[] | null;
  onPreset: (id: TidyPreset["id"]) => void;
  result: TidyResultCard | null;
  onUndo: () => void;
  /** How many tidies ↩ can still take back. */
  undoCount: number;
  highlight: boolean;
  onHideHighlight: () => void;
  /** null = still checking, false = no claude here (presets only). */
  ai: boolean | null;
  /** The Claude consult is offered (false in the build for others: see features.ts). */
  consult?: boolean;
  log: TidyLogEntry[];
  /** What the AI is doing now, or null. */
  busy: string | null;
  elapsed: number;
  onSend: (message: string, images: AttachedImage[]) => void;
  onAnalyse: () => void;
  onStop: () => void;
  onApplySuggestion: (entryId: string) => void;
  /** A ready-made request, sent to Claude as it is. */
  onConsultPreset: (preset: TidyConsultPreset) => void;
  /** A preview kept / taken back, and whether ↩ can take an entry back. */
  onApplyPreview: (entryId: string) => void;
  onCancelEntry: (entryId: string) => void;
  canCancel: (entryId: string) => boolean;
  /** 🤖 the whole job at once: 02 the AI flat paint, 03 the mixing check. */
  onAuto: () => void;
  /** The part map (shape first), when there is one. */
  parts: { subject: string; list: Array<{ name: string; pct: number; tint: string }> } | null;
  partView: boolean;
  onPartView: (on: boolean) => void;
  onRedoParts: () => void;
  /** 🎯 one part up close. */
  onFocusPart: (part: string) => void;
  /** The part being worked on up close (its chip shows the working face). */
  focusBusy?: string | null;
  connection: AiConnection;
  disabled: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem("rodin-pipeline-tidy-open") !== "0";
    } catch {
      return true;
    }
  });
  // The preset under the pointer or focus, previewed before it is pressed.
  const [previewId, setPreviewId] = useState<TidyPreset["id"] | null>(null);
  const preview = previewId ? previewPreset(previewId) : null;
  const pickedNone = area === "picked" && pickedCount === 0;
  const toggleOpen = () => {
    setOpen((v) => {
      try {
        window.localStorage.setItem("rodin-pipeline-tidy-open", v ? "0" : "1");
      } catch {
        // ignore
      }
      return !v;
    });
  };
  const mixing = scope === "mix";
  // Not the 🤖 and 🔍 asks again — they have their own buttons (11-04: the chips in two lines).
  const examples = mixing ? [t("tidy.exMix1"), t("tidy.exMix2")] : [t("tidy.exEdges"), t("tidy.exShade"), t("tidy.exSpecks")];

  return (
    <section className="pane-section tidy" aria-label={t("tidy.title")}>
      <div className="pane-head">
        <span className="pane-label">
          ✨ {t("tidy.title")}
          <HelpTip text={t(consult ? "tidy.help" : "tidy.helpPlain")} />
        </span>
        <button type="button" className="text-link" aria-expanded={open} onClick={toggleOpen}>
          {open ? t("tidy.fold") : t("tidy.unfold")} {open ? "▾" : "▸"}
        </button>
      </div>
      {open && (
        <>
          <div className="tidy-row">
            <span className="tidy-key">{t("tidy.area")}</span>
            <Segmented
              flat
              label={t("tidy.area")}
              value={area}
              onChange={onArea}
              options={[
                { value: "model", label: t("tidy.areaModel") },
                { value: "picked", label: pickedCount > 0 ? t("tidy.areaPickedN", { n: pickedCount }) : t("tidy.areaPicked"), title: t("tidy.areaPickedHint") },
              ]}
            />
          </div>
          {area === "model" && (
            <div className="tidy-row">
              <span className="tidy-key">{t("tidy.scope")}</span>
              <Segmented
                flat
                label={t("tidy.scope")}
                value={scope}
                onChange={onScope}
                options={[
                  { value: "clean", label: t("tidy.scopeClean"), title: t("tidy.scopeCleanHint") },
                  { value: "mix", label: t("tidy.scopeMix"), title: t("tidy.scopeMixHint") },
                  { value: "both", label: t("tidy.scopeBoth"), title: t("tidy.scopeBothHint") },
                ]}
              />
            </div>
          )}
          <p className={`tidy-where${pickedNone ? " warn" : ""}`} role="note">
            {area === "model" ? t("tidy.whereModel") : pickedNone ? t("tidy.wherePickedNone") : t("tidy.wherePicked", { n: pickedCount })}
          </p>
          <div className="tidy-presets">
            {TIDY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="tidy-preset"
                disabled={disabled || busy !== null || pickedNone}
                title={t(`tidy.preset.${preset.id}.hint` as Parameters<typeof t>[0])}
                onMouseEnter={() => setPreviewId(preset.id)}
                onMouseLeave={() => setPreviewId(null)}
                onFocus={() => setPreviewId(preset.id)}
                onBlur={() => setPreviewId(null)}
                onClick={() => onPreset(preset.id)}
              >
                <span className="icon" aria-hidden="true">
                  {preset.icon}
                </span>
                <span>{t(`tidy.preset.${preset.id}` as Parameters<typeof t>[0])}</span>
              </button>
            ))}
          </div>
          <p className="tidy-preview" aria-live="polite">
            {!previewId || !preview ? (
              <span className="muted">{t("tidy.previewHint")}</span>
            ) : preview.length === 0 ? (
              <span className="muted">{t("tidy.previewNothing")}</span>
            ) : (
              <>
                <span className="muted">{t(area === "picked" ? "tidy.previewLeadPicked" : "tidy.previewLead")}</span>{" "}
                {preview.map((line, i) => (
                  <span key={`${line.key}-${i}`} className="tidy-preview-item">
                    {line.label}{" "}
                    {line.from ? (
                      <>
                        <span className="mono from">{line.from}</span> → <span className="mono">{line.to}</span>
                      </>
                    ) : (
                      <span className="mono">{line.to}</span>
                    )}
                  </span>
                ))}
              </>
            )}
          </p>
          {result && (
            <div className={`tidy-result${result.undone ? " undone" : ""}`} role="status">
              <div className="tidy-result-head">
                <b>
                  {result.faces !== undefined
                    ? result.undone
                      ? t("tidy.undoneFaces", { n: result.faces.toLocaleString() })
                      : result.faces > 0
                        ? t("tidy.changedFaces", { n: result.faces.toLocaleString() })
                        : t("tidy.nothingPicked")
                    : result.undone
                      ? t("tidy.undoneCount", { n: result.lines.length })
                      : result.lines.length > 0
                        ? t("tidy.changedCount", { n: result.lines.length })
                        : t("tidy.nothing")}
                </b>
                <span className="muted">{result.title}</span>
                {undoCount > 0 && (
                  <button type="button" className="btn small" disabled={busy !== null} title={t("tidy.undoHint", { n: undoCount })} onClick={onUndo}>
                    ↩ {t("tidy.undo")} ({undoCount})
                  </button>
                )}
              </div>
              {result.lines.length > 0 && (
                <ul className="tidy-lines">
                  {result.lines.map((line, i) => (
                    <li key={`${line.key}-${i}`}>
                      <span>{line.label}</span> <span className="mono from">{line.from}</span> → <mark className="hl mono">{line.to}</mark>
                    </li>
                  ))}
                </ul>
              )}
              {result.dropped?.map((note) => (
                <p key={note} className="muted">
                  {t("tidy.dropped", { what: note })}
                </p>
              ))}
              {highlight && !result.undone && result.lines.length > 0 && (
                <p className="tidy-legend">
                  <mark className="hl">{t("tidy.legendMark")}</mark> {t("tidy.legend")}{" "}
                  <button type="button" className="text-link" onClick={onHideHighlight}>
                    {t("tidy.hideHighlight")}
                  </button>
                </p>
              )}
            </div>
          )}

          {consult && (
            <ConsultBox
              title={t("tidy.consult")}
              sub={t("tidy.consultSub")}
              inputId="tidy-input"
              ai={ai}
              log={log}
              busy={busy}
              elapsed={elapsed}
              disabled={disabled}
              auto={mixing ? { label: t("tidy.mixAuto"), hint: t("tidy.mixAutoHint"), short: t("tidy.mixAutoShort"), onClick: onAuto } : { label: t("tidy.auto"), hint: t("tidy.autoHint"), short: t("tidy.autoShort"), onClick: onAuto }}
              extra={
                !mixing && (
                  <div className="tidy-parts">
                    <span className="tidy-parts-title">{t("tidy.partsTitle")}</span>
                    {parts ? (
                      <>
                        <span className="tidy-parts-subject">{parts.subject}</span>
                        <span className="muted tidy-parts-hint">🎯 {t("tidy.focusHint")}</span>
                        <span className="tidy-parts-list">
                          {parts.list.map((part) => (
                            <button
                              key={part.name}
                              type="button"
                              className={`tidy-part${focusBusy === part.name ? " working" : ""}`}
                              disabled={busy !== null || disabled || ai !== true}
                              aria-busy={focusBusy === part.name || undefined}
                              title={`${t("tidy.focus", { part: part.name })} — ${t("tidy.focusHint")}`}
                              onClick={() => onFocusPart(part.name)}
                            >
                              {/* The part being worked on shows the working face where its colour was: the sign is where the press was. */}
                              {focusBusy === part.name ? <GyupaSpin size={13} /> : <i style={{ background: part.tint }} aria-hidden="true" />}
                              {part.name} <span className="muted">{part.pct.toFixed(0)}%</span>
                            </button>
                          ))}
                        </span>
                        <span className="tidy-parts-actions">
                          <button type="button" className="link-btn" aria-pressed={partView} title={t("tidy.partsShowHint")} onClick={() => onPartView(!partView)}>
                            {partView ? t("tidy.partsHide") : t("tidy.partsShow")}
                          </button>
                          <button type="button" className="link-btn" disabled={busy !== null || disabled} title={t("tidy.partsRedoHint")} onClick={onRedoParts}>
                            ↻ {t("tidy.partsRedo")}
                          </button>
                        </span>
                      </>
                    ) : (
                      <span className="muted">{t("tidy.partsNone")}</span>
                    )}
                  </div>
                )
              }
              presets={
                <div className="tidy-consult-presets">
                  {TIDY_CONSULT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="tidy-preset"
                      // Only 02's knobs can smooth borders.
                      disabled={disabled || busy !== null || ai === null || scope === "mix"}
                      title={scope === "mix" ? t("tidy.consultNeedsClean") : t(`tidy.consult.${preset.id}.hint` as Parameters<typeof t>[0])}
                      onClick={() => onConsultPreset(preset)}
                    >
                      <span className="icon" aria-hidden="true">
                        {preset.icon}
                      </span>
                      <span>{t(`tidy.consult.${preset.id}` as Parameters<typeof t>[0])}</span>
                      <span className="muted tidy-preset-sub">{t("tidy.consultPresetSub")}</span>
                    </button>
                  ))}
                </div>
              }
              examples={examples}
              placeholder={t("tidy.placeholder")}
              onSend={onSend}
              onAnalyse={{ label: t("tidy.analyse"), hint: t("tidy.analyseHint"), onClick: onAnalyse }}
              onStop={onStop}
              onTry={onApplySuggestion}
              onApply={onApplyPreview}
              onCancel={onCancelEntry}
              canCancel={canCancel}
              connection={connection}
              keyForm={<KeyForm connection={connection} />}
              connectionLine={<ConnectionLine connection={connection} />}
            />
          )}
        </>
      )}
    </section>
  );
}

/** Where the consult's Claude comes from, under the consult: this computer's login or the person's own key. */
export function ConnectionLine({ connection }: { connection: AiConnection }) {
  const t = useT();
  const [changing, setChanging] = useState(false);
  if (!connection.route) return null;
  if (connection.route === "local") return <p className="tidy-connection muted">{t("tidy.aiLocal")}</p>;
  if (changing) return <KeyForm connection={connection} onDone={() => setChanging(false)} />;
  return (
    <p className="tidy-connection muted">
      {t("tidy.aiKey", { mask: connection.keyMask ?? "" })} · {t("tidy.aiKeyUsage", { n: connection.usage.calls, usd: connection.usage.usd.toFixed(2) })}{" "}
      <button type="button" className="text-link" onClick={() => setChanging(true)}>
        {t("tidy.keyChange")}
      </button>{" "}
      <button
        type="button"
        className="text-link"
        onClick={() => {
          if (window.confirm(t("tidy.keyClearConfirm"))) connection.onClearKey();
        }}
      >
        {t("tidy.keyClear")}
      </button>
    </p>
  );
}

/** Puts the person's own Anthropic API key in this browser (sent to Anthropic only). */
export function KeyForm({ connection, onDone }: { connection: AiConnection; onDone?: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const key = draft.trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{8,}$/.test(key)) {
      setError(t("tidy.keyBad"));
      return;
    }
    connection.onSaveKey(key);
    setDraft("");
    setError(null);
    onDone?.();
  };
  return (
    <div className="tidy-apikey">
      <b>{t("tidy.keyTitle")}</b>
      <p className="empty-note">{t("tidy.keyHelp")}</p>
      <label className="tidy-input-label" htmlFor="tidy-apikey-input">
        {t("tidy.keyLabel")}
      </label>
      <div className="tidy-apikey-row">
        <input
          id="tidy-apikey-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="tidy-apikey-input"
          placeholder="sk-ant-…"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) save();
          }}
        />
        <button type="button" className="btn small primary" disabled={!draft.trim()} onClick={save}>
          {t("tidy.keySave")}
        </button>
        {onDone && (
          <button type="button" className="btn small" onClick={onDone}>
            {t("tidy.keyCancel")}
          </button>
        )}
      </div>
      {error && <p className="tidy-apikey-error">{error}</p>}
      <p className="empty-note">{t("tidy.keyHow")}</p>
      <p className="empty-note">{t("tidy.keyLocalNote")}</p>
    </div>
  );
}
