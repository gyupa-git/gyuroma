import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { attachImage, type AttachedImage } from "./attachImage";
import { GyupaWaiting } from "./GyupaLoader";
import type { TidyLogEntry } from "../engine/tidy";
import { useT } from "../i18n";
import type { AiConnection } from "./TidyPanel";

/**
 * 💬 The consult with Claude, the same in 02 colour tidy, 03 mixing and 04 export:
 * the owner asks, Claude answers and makes the change — shown as a preview, kept
 * only with ✅ Apply (↩ Cancel takes it back).  A plan Claude only proposed (the
 * owner asked a question) waits for 👀 Preview.  The 🤖 button asks the step's
 * whole job at once.  Pictures go along with the words (pasted, dropped or 📎): "here, like this".
 */

/** Pictures one message may carry (the model's own pictures need the rest of the room). */
const MAX_ATTACHED = 3;

/** Whether a consult was left open at this place (open unless folded there before). */
function storedOpen(key: string | null): boolean {
  if (!key) return true;
  try {
    return window.localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}
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
  foldKey,
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
  auto?: { label: string; hint: string; short?: string; onClick: () => void; disabled?: boolean };
  presets?: ReactNode;
  extra?: ReactNode;
  examples: string[];
  placeholder: string;
  onSend: (message: string, images: AttachedImage[]) => void;
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
  /**
   * Where this consult is (02, 03, 04): it can then be folded to its title and 🤖 button, remembered there (11-09:
   * open, it is the tallest thing in the panel). Work starting or an answer coming in opens it again.
   */
  foldKey?: string;
}) {
  const t = useT();
  const storeKey = foldKey ? `rodin-pipeline-consult-open-${foldKey}` : null;
  const [open, setOpen] = useState(() => storedOpen(storeKey));
  // The same box goes on from 02 to 03: each place keeps its own.
  useEffect(() => setOpen(storedOpen(storeKey)), [storeKey]);
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (!storeKey) return;
    try {
      window.localStorage.setItem(storeKey, next ? "1" : "0");
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    if (busy) setOpen(true);
  }, [busy]);
  const [draft, setDraft] = useState("");
  const [attached, setAttached] = useState<AttachedImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFiles = async (files: Blob[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return false;
    const made = (await Promise.all(images.slice(0, MAX_ATTACHED).map(attachImage))).filter((x): x is AttachedImage => x !== null);
    setAttached((prev) => [...prev, ...made].slice(0, MAX_ATTACHED));
    // A picture dropped on the folded box: open it, so the picture is seen waiting in the writing field.
    if (made.length) setOpen(true);
    return true;
  };
  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.items].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  };
  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (!files.some((f) => f.type.startsWith("image/"))) return;
    event.preventDefault();
    void addFiles(files);
  };
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, busy]);
  // A new answer lights up a moment, its start brought into sight (11-05: "최종 답을 줄 때 뭔가 줬다는 표시").
  let lastAi: string | null = null;
  for (let i = log.length - 1; i >= 0 && lastAi === null; i--) if (log[i].role === "ai") lastAi = log[i].id;
  const seenAiRef = useRef(lastAi);
  const [arrived, setArrived] = useState<string | null>(null);
  useEffect(() => {
    if (lastAi === seenAiRef.current) return;
    seenAiRef.current = lastAi;
    if (!lastAi) return;
    setArrived(lastAi);
    setOpen(true);
    const timer = window.setTimeout(() => setArrived(null), 3200);
    return () => window.clearTimeout(timer);
  }, [lastAi]);
  useEffect(() => {
    if (arrived) logRef.current?.querySelector(".tidy-msg.arrived")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [arrived]);
  const send = () => {
    const text = draft.trim() || (attached.length ? t("tidy.imageOnly") : "");
    if (!text || busy) return;
    onSend(text, attached);
    setDraft("");
    setAttached([]);
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
    // A picture dropped anywhere on the consult goes with the words (11-05, the owner: off the writing field the
    // browser opened it in a new tab).
    <div
      className={`tidy-consult${busy ? " working" : ""}${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        if (ai !== true || ![...e.dataTransfer.items].some((item) => item.kind === "file")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <span className="consult-glow" aria-hidden="true">
        <span />
      </span>
      {/* Who this is and where its Claude comes from; nothing to press here but a key change. */}
      <header className="consult-head">
        {/* Foldable: the title is the switch, its arrow like the panel's other folds (a fold button of its own
            pushed the login line onto a second line). */}
        {storeKey && ai !== false ? (
          <button type="button" className="consult-title consult-toggle" aria-expanded={open} title={open ? t("tidy.fold") : t("tidy.unfold")} onClick={toggleOpen}>
            <span className="chev" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            💬 {title}
          </button>
        ) : (
          <b className="consult-title">💬 {title}</b>
        )}
        {ai === true && connectionLine}
      </header>
      {ai === false ? (
        keyForm
      ) : !open ? (
        // Folded: the step's whole job is still one press away.
        auto ? (
          <div className="consult-auto-row">
            <button type="button" className="btn primary consult-auto" disabled={waiting || auto.disabled} title={auto.hint} onClick={auto.onClick}>
              {auto.label}
            </button>
          </div>
        ) : null
      ) : (
        <>
          {/* The step's whole job at once: one button, one line on it, the rest folded away. */}
          {auto && (
            <div className="consult-auto-row">
              <button type="button" className="btn primary consult-auto" disabled={waiting || auto.disabled} title={auto.hint} onClick={auto.onClick}>
                {auto.label}
              </button>
              {auto.short && <p className="consult-note">{auto.short}</p>}
              <details className="consult-more">
                <summary>{t("tidy.howItWorks")}</summary>
                <p>{auto.hint}</p>
              </details>
            </div>
          )}
          {extra}
          {(log.length > 0 || busy) && (
            <div className="tidy-log" ref={logRef} aria-live="polite">
              {log.map((entry) => (
                <div key={entry.id} className={`tidy-msg ${entry.role}${entry.id === arrived ? " arrived" : ""}`}>
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
                    <>
                      <p>{entry.text}</p>
                      {entry.images && entry.images.length > 0 && (
                        <div className="consult-attached in-log">
                          {entry.images.map((src, i) => (
                            <img key={i} src={src} alt="" />
                          ))}
                        </div>
                      )}
                    </>
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
          {/* Quick asks just above the writing field, not inside it (11-05, the owner: with them inside, where to write was unclear). */}
          {(presets || onAnalyse || examples.length > 0) && (
            <div className="consult-quick">
              {presets}
              {/* An ask that goes at once, with the other asks — not inside the writing field, where a press meant to write set it off (11-05). */}
              {onAnalyse && (
                <button type="button" className="tidy-preset" disabled={waiting} title={onAnalyse.hint} onClick={onAnalyse.onClick}>
                  <span className="icon" aria-hidden="true">
                    🔍
                  </span>
                  <span>{onAnalyse.label}</span>
                </button>
              )}
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="consult-chip"
                  title={t("tidy.exampleHint")}
                  onClick={() => {
                    setDraft((d) => (d.trim() ? `${d.trim()} ${example}` : example));
                    inputRef.current?.focus();
                  }}
                >
                  {example}
                </button>
              ))}
            </div>
          )}
          {/* Writing to Claude: the field itself — the words, the pictures, and its tools along the bottom; a press anywhere on it writes. */}
          <div
            className={`consult-composer${dragging ? " dragging" : ""}`}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("button, input, textarea, a")) inputRef.current?.focus();
            }}
          >
            <label className="sr-only" htmlFor={inputId}>
              {t("tidy.inputLabel")} — {t("tidy.inputSub")}
            </label>
            <textarea id={inputId} ref={inputRef} className="consult-input" rows={3} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
            {attached.length > 0 && (
              <div className="consult-attached">
                {attached.map((image, i) => (
                  <span key={i} className="consult-attached-item">
                    <img src={image.thumb} alt="" />
                    <button type="button" className="consult-attached-x" aria-label={t("tidy.attachRemove")} title={t("tidy.attachRemove")} onClick={() => setAttached((prev) => prev.filter((_, k) => k !== i))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="consult-tools">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void addFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
              <button type="button" className="consult-tool" disabled={waiting || attached.length >= MAX_ATTACHED} title={t("tidy.attachHint")} aria-label={t("tidy.attach")} onClick={() => fileRef.current?.click()}>
                📎
              </button>
              <span className="consult-tools-gap" />
              <button type="button" className="btn small primary consult-send" disabled={waiting || (!draft.trim() && attached.length === 0)} title="⌘/Ctrl + Enter" onClick={send}>
                {t("tidy.send")} ↑
              </button>
            </div>
          </div>
          <p className="consult-note">{t("tidy.composerNote")}</p>
        </>
      )}
    </div>
  );
}
