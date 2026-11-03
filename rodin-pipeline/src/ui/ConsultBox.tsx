import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { GyupaWaiting } from "./GyupaLoader";
import type { TidyLogEntry } from "../engine/tidy";
import { useT } from "../i18n";
import type { AiConnection } from "./TidyPanel";

/**
 * 💬 The consult with Claude, the same in 02 colour tidy, 03 mixing and 04 export:
 * the owner asks, Claude answers and makes the change — shown as a preview, kept
 * only with ✅ Apply (↩ Cancel takes it back).  A plan Claude only proposed (the
 * owner asked a question) waits for 👀 Preview.  The 🤖 button asks the step's
 * whole job at once.
 */
export function ConsultBox({
  title,
  sub,
  inputId,
  ai,
  log,
  busy,
  elapsed,
  disabled,
  auto,
  presets,
  extra,
  examples,
  placeholder,
  onSend,
  onAnalyse,
  onStop,
  onTry,
  onApply,
  onCancel,
  canCancel,
  connection,
  keyForm,
  connectionLine,
}: {
  title: string;
  sub: string;
  inputId: string;
  /** null = still checking, false = no claude here. */
  ai: boolean | null;
  log: TidyLogEntry[];
  busy: string | null;
  elapsed: number;
  disabled: boolean;
  auto?: { label: string; hint: string; onClick: () => void; disabled?: boolean };
  presets?: ReactNode;
  extra?: ReactNode;
  examples: string[];
  placeholder: string;
  onSend: (message: string) => void;
  onAnalyse?: { label: string; hint: string; onClick: () => void };
  onStop: () => void;
  /** A proposal tried as a preview. */
  onTry: (entryId: string) => void;
  /** A preview kept. */
  onApply: (entryId: string) => void;
  /** A preview (or a change) taken back. */
  onCancel: (entryId: string) => void;
  /** Whether ↩ can take this entry back (only the newest change can). */
  canCancel: (entryId: string) => boolean;
  connection: AiConnection;
  keyForm: ReactNode;
  connectionLine: ReactNode;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
      event.currentTarget.addEventListener("compositionend", () => setTimeout(send, 0), { once: true });
      return;
    }
    send();
  };
  const waiting = disabled || busy !== null || ai === null;
  void connection;

  return (
    <div className="tidy-consult">
      <div className="tidy-consult-head">
        <b>💬 {title}</b>
        <span className="muted">{sub}</span>
      </div>
      {ai === false ? (
        keyForm
      ) : (
        <>
          {auto && (
            <button type="button" className="btn primary consult-auto" disabled={waiting || auto.disabled} title={auto.hint} onClick={auto.onClick}>
              {auto.label}
            </button>
          )}
          {auto && <p className="consult-auto-hint muted">{auto.hint}</p>}
          {extra}
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
                              : entry.status === "preview"
                                ? t("tidy.statusPreview")
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
                            <button type="button" className="btn small primary" disabled={waiting} onClick={() => onTry(entry.id)}>
                              👀 {t("tidy.previewTry")}
                            </button>
                          )}
                          {entry.status === "preview" && (
                            <span className="consult-preview-actions">
                              <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => onApply(entry.id)}>
                                ✅ {t("tidy.previewApply")}
                              </button>
                              {canCancel(entry.id) && (
                                <button type="button" className="btn small" disabled={busy !== null} onClick={() => onCancel(entry.id)}>
                                  ↩ {t("tidy.previewCancel")}
                                </button>
                              )}
                            </span>
                          )}
                          {entry.status === "applied" && canCancel(entry.id) && (
                            <button type="button" className="btn small" disabled={busy !== null} onClick={() => onCancel(entry.id)}>
                              ↩ {t("tidy.undo")}
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
                  <GyupaWaiting />
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
          {presets}
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
          <label className="tidy-input-label" htmlFor={inputId}>
            {t("tidy.inputLabel")} <span className="muted">— {t("tidy.inputSub")}</span>
          </label>
          <textarea id={inputId} ref={inputRef} className="tidy-input" rows={3} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
          <div className="tidy-actions">
            {onAnalyse && (
              <button type="button" className="btn small" disabled={waiting} title={onAnalyse.hint} onClick={onAnalyse.onClick}>
                🔍 {onAnalyse.label}
              </button>
            )}
            <button type="button" className="btn small primary" disabled={waiting || !draft.trim()} title="⌘/Ctrl + Enter" onClick={send}>
              {t("tidy.send")} ↑
            </button>
          </div>
          {connectionLine}
        </>
      )}
    </div>
  );
}
