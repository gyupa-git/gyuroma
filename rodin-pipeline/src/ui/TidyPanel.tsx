import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { TIDY_CONSULT_PRESETS, TIDY_PRESETS, type ChangeLine, type TidyConsultPreset, type TidyLogEntry, type TidyPreset, type TidyScope } from "../engine/tidy";
import type { TidyArea } from "../engine/tidyArea";
import type { AiRoute, KeyUsage } from "../engine/aiClient";
import { useT } from "../i18n";
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
  onSend: (message: string) => void;
  onAnalyse: () => void;
  onStop: () => void;
  onApplySuggestion: (entryId: string) => void;
  /** A ready-made request, sent to Claude as it is. */
  onConsultPreset: (preset: TidyConsultPreset) => void;
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
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  // The preset under the pointer or focus, previewed before it is pressed.
  const [previewId, setPreviewId] = useState<TidyPreset["id"] | null>(null);
  const preview = previewId ? previewPreset(previewId) : null;
  const pickedNone = area === "picked" && pickedCount === 0;
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  // The newest message in view.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, busy]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft("");
  };
  const onKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    // Mid-composition (Korean IME) the last syllable is not in the value yet.
    if (event.nativeEvent.isComposing) {
      const target = event.currentTarget;
      target.addEventListener("compositionend", () => setTimeout(send, 0), { once: true });
      return;
    }
    send();
  };
  const examples = [t("tidy.exAnalyse"), t("tidy.exEdges"), t("tidy.exShade"), t("tidy.exSpecks")];
  const lastApplied = [...log].reverse().find((entry) => entry.role === "ai" && entry.status === "applied");

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
          <div className="tidy-consult">
            <div className="tidy-consult-head">
              <b>💬 {t("tidy.consult")}</b>
              <span className="muted">{t("tidy.consultSub")}</span>
            </div>
            {ai === false ? (
              <KeyForm connection={connection} />
            ) : (
              <>
                {(log.length > 0 || busy) && (
                  <div className="tidy-log" ref={logRef} aria-live="polite">
                    {log.map((entry) => (
                      <div key={entry.id} className={`tidy-msg ${entry.role}`}>
                        {entry.role === "ai" ? (
                          <>
                            <p>{entry.text}</p>
                            {entry.observations && entry.observations.length > 0 && (
                              <ul className="tidy-obs">
                                {entry.observations.map((line, i) => (
                                  <li key={i}>{line}</li>
                                ))}
                              </ul>
                            )}
                            {entry.lines && entry.lines.length > 0 && (
                              <div className={`tidy-proposal ${entry.status ?? ""}`}>
                                <span className="tidy-status">
                                  {entry.status === "applied"
                                    ? t("tidy.statusApplied")
                                    : entry.status === "undone"
                                      ? t("tidy.statusUndone")
                                      : t("tidy.statusSuggested")}
                                </span>
                                <ul className="tidy-lines">
                                  {entry.lines.map((line, i) => (
                                    <li key={`${line.key}-${i}`}>
                                      <span>{line.label}</span> <span className="mono from">{line.from}</span> → <mark className="hl mono">{line.to}</mark>
                                    </li>
                                  ))}
                                </ul>
                                {entry.status === "suggested" && (
                                  <button type="button" className="btn small primary" disabled={disabled || busy !== null} onClick={() => onApplySuggestion(entry.id)}>
                                    ✅ {t("tidy.applySuggestion")}
                                  </button>
                                )}
                                {entry.status === "applied" && lastApplied?.id === entry.id && result?.entryId === entry.id && !result.undone && undoCount > 0 && (
                                  <button type="button" className="btn small" disabled={busy !== null} onClick={onUndo}>
                                    ↩ {t("tidy.undo")} ({undoCount})
                                  </button>
                                )}
                              </div>
                            )}
                            {entry.dropped?.map((note) => (
                              <p key={note} className="muted">
                                {t("tidy.dropped", { what: note })}
                              </p>
                            ))}
                          </>
                        ) : (
                          <p>{entry.text}</p>
                        )}
                      </div>
                    ))}
                    {busy && (
                      <div className="tidy-msg working">
                        <span className="spinner" aria-hidden="true" />
                        <span>
                          {busy} · {t("tidy.seconds", { n: elapsed })}
                        </span>
                        <button type="button" className="btn small" onClick={onStop}>
                          ⏹ {t("tidy.stop")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
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
                <div className="tidy-examples">
                  {examples.map((example) => (
                    <button
                      key={example}
                      type="button"
                      className="chip button"
                      onClick={() => {
                        setDraft((d) => (d.trim() ? `${d.trim()} ${example}` : example));
                        inputRef.current?.focus();
                      }}
                    >
                      {example}
                    </button>
                  ))}
                </div>
                <label className="tidy-input-label" htmlFor="tidy-input">
                  {t("tidy.inputLabel")} <span className="muted">— {t("tidy.inputSub")}</span>
                </label>
                <textarea
                  id="tidy-input"
                  ref={inputRef}
                  className="tidy-input"
                  rows={3}
                  value={draft}
                  placeholder={t("tidy.placeholder")}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKey}
                />
                <div className="tidy-actions">
                  <button type="button" className="btn small" disabled={disabled || busy !== null || ai === null} title={t("tidy.analyseHint")} onClick={onAnalyse}>
                    🔍 {t("tidy.analyse")}
                  </button>
                  <button type="button" className="btn small primary" disabled={disabled || busy !== null || ai === null || !draft.trim()} title="⌘/Ctrl + Enter" onClick={send}>
                    {t("tidy.send")} ↑
                  </button>
                </div>
                <ConnectionLine connection={connection} />
              </>
            )}
          </div>
          )}
        </>
      )}
    </section>
  );
}

/** Where the consult's Claude comes from, under the consult: this computer's login or the person's own key. */
function ConnectionLine({ connection }: { connection: AiConnection }) {
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
function KeyForm({ connection, onDone }: { connection: AiConnection; onDone?: () => void }) {
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
