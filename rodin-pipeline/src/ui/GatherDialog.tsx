import { useEffect, useMemo, useRef, useState } from "react";
import { planGather, mixesUsed, slotsUsed, type GatherPlan, type GatherSource, type GatherWarning } from "../engine/gather";
import { GatherJobError, readInWorker, writeInWorker } from "../engine/gatherClient";
import { countAction } from "../engine/counter";
import { useT, type Key } from "../i18n";
import { Swatch } from "./common";
import { Icon } from "./Shell";

/**
 * 모아 뽑기: finished 3MF files in, one file for one bed out.  The list keeps
 * the owner's order (the first file sets the printer and print settings), the
 * bed shows where every model goes, and the summary says what was shared.
 */
interface Entry {
  id: number;
  file: File;
  progress: number;
  source: GatherSource | null;
  error: { key: string; params: Record<string, string | number> } | null;
  url: string | null;
}

let nextEntry = 1;

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** A dark colour lifted toward white, so a model shows on the dark bed. */
function onDark(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const light = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (light >= 0.35) return hex;
  const lift = (0.35 - light) / 0.35 * 0.55;
  return `rgb(${rgb.map((v) => Math.round(v + (255 - v) * lift)).join(",")})`;
}

/** The colour a source paints most, to show its model in on the bed. */
function mainColour(source: GatherSource): string {
  let best = 0;
  let colour = source.physical[0] ?? "#808080";
  const mixes = new Map(source.mixes.map((mix) => [mix.id, mix.color]));
  for (const [key, count] of Object.entries(source.states)) {
    const state = Number(key);
    const hex = state === 0 ? source.physical[0] : state <= source.physical.length ? source.physical[state - 1] : mixes.get(state);
    if (hex && count > best) (best = count), (colour = hex);
  }
  return colour;
}

/** One picture of the included files' thumbnails side by side, for the new file. */
async function combinedThumbnail(sources: GatherSource[]): Promise<Uint8Array | null> {
  const images = sources.filter((source) => source.thumbnail);
  if (images.length === 0) return null;
  try {
    const bitmaps = await Promise.all(images.map((source) => createImageBitmap(new Blob([source.thumbnail as Uint8Array<ArrayBuffer>], { type: "image/png" }))));
    const columns = Math.ceil(Math.sqrt(bitmaps.length));
    const rows = Math.ceil(bitmaps.length / columns);
    const size = 512;
    const cell = size / columns;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = Math.round(cell * rows);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    bitmaps.forEach((bitmap, i) => {
      const scale = Math.min(cell / bitmap.width, cell / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      ctx.drawImage(bitmap, (i % columns) * cell + (cell - w) / 2, Math.floor(i / columns) * cell + (cell - h) / 2, w, h);
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function BedView({ sources, plan, numberOf }: { sources: GatherSource[]; plan: GatherPlan; numberOf: (index: number) => number }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(420);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // At most 440 px, so the summary under it stays in view.
    const observer = new ResizeObserver(() => setWidth(Math.max(200, Math.min(440, Math.floor(canvas.parentElement?.clientWidth ?? 420)))));
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const bed = plan.bed;
    const bedW = bed.maxX - bed.minX;
    const bedH = bed.maxY - bed.minY;
    const pad = 10;
    const scale = (width - pad * 2) / Math.max(bedW, bedH);
    const height = Math.round(bedH * scale + pad * 2);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // the bed, front at the bottom as in the slicer
    const px = (x: number) => pad + (x - bed.minX) * scale;
    const py = (y: number) => pad + (bed.maxY - y) * scale;
    ctx.fillStyle = token("--well", "#0d0d0e");
    ctx.fillRect(px(bed.minX), py(bed.maxY), bedW * scale, bedH * scale);
    ctx.strokeStyle = token("--border-soft", "#26262a");
    ctx.lineWidth = 1;
    for (let x = Math.ceil(bed.minX / 50) * 50; x <= bed.maxX; x += 50) {
      ctx.beginPath();
      ctx.moveTo(px(x) + 0.5, py(bed.maxY));
      ctx.lineTo(px(x) + 0.5, py(bed.minY));
      ctx.stroke();
    }
    for (let y = Math.ceil(bed.minY / 50) * 50; y <= bed.maxY; y += 50) {
      ctx.beginPath();
      ctx.moveTo(px(bed.minX), py(y) + 0.5);
      ctx.lineTo(px(bed.maxX), py(y) + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = token("--border-strong", "#42424a");
    ctx.strokeRect(px(bed.minX) + 0.5, py(bed.maxY) + 0.5, bedW * scale - 1, bedH * scale - 1);
    for (const corner of plan.excluded) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(px(corner.minX), py(corner.maxY), (corner.maxX - corner.minX) * scale, (corner.maxY - corner.minY) * scale);
      ctx.clip();
      ctx.strokeStyle = token("--faint", "#5f5f67");
      for (let k = -200; k < 400; k += 6) {
        ctx.beginPath();
        ctx.moveTo(px(corner.minX) + k, py(corner.maxY));
        ctx.lineTo(px(corner.minX) + k + 200, py(corner.maxY) + 200);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (plan.tower) {
      const tw = plan.tower;
      ctx.save();
      ctx.beginPath();
      ctx.rect(px(tw.minX), py(tw.maxY), (tw.maxX - tw.minX) * scale, (tw.maxY - tw.minY) * scale);
      ctx.clip();
      ctx.strokeStyle = token("--faint", "#5f5f67");
      for (let k = -200; k < 400; k += 6) {
        ctx.beginPath();
        ctx.moveTo(px(tw.minX) + k, py(tw.maxY));
        ctx.lineTo(px(tw.minX) + k + 200, py(tw.maxY) + 200);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = token("--muted", "#8a8a93");
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t("gather.tower"), px((tw.minX + tw.maxX) / 2), py(tw.minY) + 12);
    }
    // the models, each in the colour it paints most
    for (const index of plan.used) {
      const source = sources[index];
      const colour = onDark(mainColour(source));
      source.parts.forEach((part, k) => {
        const place = plan.places[index]?.[k];
        if (!place || place.offBed) return;
        const { width: w, height: h, cells } = part.silhouette;
        const dot = Math.max(1.6, scale * 1.2);
        ctx.fillStyle = colour;
        for (let cy = 0; cy < h; cy++)
          for (let cx = 0; cx < w; cx++) if (cells[cy * w + cx]) ctx.fillRect(px(part.box.minX + place.dx + cx) - 0.2, py(part.box.minY + place.dy + cy + 1) - 0.2, dot, dot);
        const mx = px((place.box.minX + place.box.maxX) / 2);
        const my = py((place.box.minY + place.box.maxY) / 2);
        ctx.beginPath();
        ctx.arc(mx, my, 9, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(12,12,13,0.82)";
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(numberOf(index)), mx, my + 0.5);
        ctx.textBaseline = "alphabetic";
      });
    }
  }, [sources, plan, width, numberOf, t]);
  return <canvas ref={ref} className="gather-bed" aria-label={t("gather.bedLabel")} />;
}

export function GatherDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [same, setSame] = useState<number[]>([]);
  const [fileName, setFileName] = useState("");
  const [writing, setWriting] = useState<number | null>(null);
  const [result, setResult] = useState<{ kind: "ok"; fileName: string; blob: Blob } | { kind: "error"; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && writing === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, writing]);

  const errorText = (key: string, params: Record<string, string | number>) => t(`gather.err.${key}` as Key, params);

  const addFiles = (files: FileList | File[]) => {
    const added = [...files].filter((file) => /\.3mf$/i.test(file.name)).map((file): Entry => ({ id: nextEntry++, file, progress: 0, source: null, error: null, url: null }));
    if (added.length === 0) return;
    setResult(null);
    setEntries((prev) => [...prev, ...added]);
    // One file at a time: each read streams a whole model.
    for (const entry of added) {
      queue.current = queue.current.then(async () => {
        try {
          const source = await readInWorker(entry.file, (progress) => setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, progress } : e))));
          const url = source.thumbnail ? URL.createObjectURL(new Blob([source.thumbnail as Uint8Array<ArrayBuffer>], { type: "image/png" })) : null;
          setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, source, url, progress: 1 } : e)));
        } catch (error) {
          const job = error instanceof GatherJobError ? error : new GatherJobError("unknown", { message: String(error) });
          setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, error: { key: job.key, params: job.params } } : e)));
        }
      });
    }
  };

  const ready = entries.filter((entry) => entry.source);
  const sources = useMemo(() => ready.map((entry) => entry.source as GatherSource), [ready.map((entry) => entry.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const sameIndices = useMemo(() => ready.flatMap((entry, i) => (same.includes(entry.id) ? [i] : [])), [sources, same]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => (sources.length > 0 ? planGather(sources, sources.map((_s, i) => i), { same: sameIndices }) : null), [sources, sameIndices]);
  const numberOf = useMemo(() => {
    const numbers = new Map(plan?.used.map((index, k) => [index, k + 1]) ?? []);
    return (index: number) => numbers.get(index) ?? 0;
  }, [plan]);
  const reading = entries.some((entry) => !entry.source && !entry.error);
  const unknownPrinter = Boolean(plan?.warnings.some((warning) => warning.key === "bambuPrinter"));
  const canWrite = Boolean(plan && plan.used.length >= 2 && !plan.tooMany && !unknownPrinter && !reading && writing === null);
  const defaultName = plan && plan.used.length > 0 ? t("gather.defaultName", { n: plan.used.length }) : t("gather.defaultNameNone");

  const move = (id: number, by: number) =>
    setEntries((prev) => {
      const at = prev.findIndex((entry) => entry.id === id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= prev.length) return prev;
      const next = prev.slice();
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    });
  const remove = (id: number) =>
    setEntries((prev) => {
      const gone = prev.find((entry) => entry.id === id);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return prev.filter((entry) => entry.id !== id);
    });

  const write = async () => {
    if (!plan || !canWrite) return;
    setWriting(0);
    setResult(null);
    try {
      const used = plan.used.map((index) => sources[index]);
      const name = (fileName.trim() || defaultName).replace(/(\.3mf)?$/i, ".3mf");
      const blob = await writeInWorker(
        ready.map((entry) => entry.file),
        sources,
        plan,
        name.replace(/\.3mf$/i, ""),
        await combinedThumbnail(used),
        (progress) => setWriting(progress),
      );
      downloadBlob(name, blob);
      countAction(`gather/${plan.slicer}`);
      setResult({ kind: "ok", fileName: name, blob });
    } catch (error) {
      const job = error instanceof GatherJobError ? error : new GatherJobError("unknown", { message: String(error) });
      setResult({ kind: "error", message: errorText(job.key, job.params) });
    } finally {
      setWriting(null);
    }
  };

  if (!open) return null;
  const warningText = (warning: GatherWarning) => t(`gather.warn.${warning.key}` as Key, warning as unknown as Record<string, string>);
  const base = plan && plan.used.length > 0 ? sources[plan.used[0]] : null;
  return (
    <div className="gather-overlay" role="dialog" aria-modal="true" aria-label={t("gather.title")}>
      <div className="gather">
        <header className="gather-head">
          <div>
            <h2>{t("gather.title")}</h2>
            <p className="muted">{t("gather.subtitle")}</p>
          </div>
          <button type="button" className="icon-btn" aria-label={t("gather.close")} title={t("gather.close")} disabled={writing !== null} onClick={onClose}>
            <Icon name="close" size={14} stroke={1.6} />
          </button>
        </header>
        <div className="gather-body">
          <div className="gather-list">
            <label
              className={`dropzone${dragging ? " active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
              }}
            >
              <strong>{t("gather.dropTitle")}</strong>
              <span className="muted">{t("gather.dropHint")}</span>
              <input
                type="file"
                accept=".3mf"
                multiple
                disabled={writing !== null}
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {entries.length === 0 && <p className="muted gather-empty">{t("gather.empty")}</p>}
            <ol className="gather-files">
              {entries.map((entry, row) => {
                const index = ready.indexOf(entry);
                const source = entry.source;
                const left = plan?.left.find((item) => item.source === index);
                const taken = plan?.taken.filter((item) => item.source === index) ?? [];
                const number = index >= 0 ? numberOf(index) : 0;
                const usedSlots = source ? new Set(slotsUsed(source)) : new Set<number>();
                return (
                  <li key={entry.id} className={`gather-file${left ? " left" : ""}${entry.error ? " failed" : ""}`}>
                    <span className="gather-number">{number || "–"}</span>
                    {entry.url ? <img className="gather-thumb" src={entry.url} alt="" /> : <span className="gather-thumb" />}
                    <div className="gather-file-main">
                      <div className="gather-file-name" title={entry.file.name}>
                        {entry.file.name}
                      </div>
                      {source && (
                        <div className="gather-file-meta mono">
                          {t("gather.meta", {
                            faces: source.objects.reduce((sum, object) => sum + object.faces, 0).toLocaleString(),
                            mixes: mixesUsed(source).length,
                            h: source.footprint.maxZ.toFixed(1),
                          })}
                          {source.parts.length > 1 && ` · ${t("gather.metaParts", { n: source.parts.length })}`}
                        </div>
                      )}
                      {source && (
                        <div className="gather-chips">
                          {source.physical.map((hex, i) => (
                            <span key={i} className={`gather-chip${usedSlots.has(i + 1) ? "" : " unused"}`} title={`E${i + 1} ${hex}`}>
                              <Swatch hex={hex} size={12} />E{i + 1}
                            </span>
                          ))}
                        </div>
                      )}
                      {!source && !entry.error && (
                        <div className="gather-progress" aria-label={t("gather.reading", { p: `${Math.round(entry.progress * 100)}%` })}>
                          <span style={{ width: `${Math.round(entry.progress * 100)}%` }} />
                        </div>
                      )}
                      {entry.error && <div className="warn">{errorText(entry.error.key, entry.error.params)}</div>}
                      {number === 1 && <div className="gather-base">{t("gather.base")}</div>}
                      {left?.reason === "slicer" && <div className="warn gather-left">{t("gather.leftSlicer")}</div>}
                      {left?.reason === "filaments" && (
                        <div className="gather-left">
                          <span className="warn">{t("gather.leftOut")}</span>{" "}
                          {left.colours.map((hex) => (
                            <span key={hex} className="cell-colour">
                              <Swatch hex={hex} size={12} />
                              <span className="mono">{hex}</span>
                            </span>
                          ))}
                          <button type="button" className="btn small soft" title={t("gather.sameHint")} onClick={() => setSame((prev) => [...prev, entry.id])}>
                            {t("gather.sameButton")}
                          </button>
                        </div>
                      )}
                      {taken.length > 0 && (
                        <div className="gather-taken">
                          {taken.map((item) => (
                            <span key={item.colour} className="cell-colour">
                              <Swatch hex={item.colour} size={12} />
                              {t("gather.taken", { colour: item.colour, slot: item.slot })}
                            </span>
                          ))}
                          <button type="button" className="text-link" onClick={() => setSame((prev) => prev.filter((id) => id !== entry.id))}>
                            {t("gather.takenUndo")}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="gather-file-tools">
                      <button type="button" className="icon-btn tiny" aria-label={t("gather.up")} title={t("gather.up")} disabled={row === 0 || writing !== null} onClick={() => move(entry.id, -1)}>
                        ↑
                      </button>
                      <button type="button" className="icon-btn tiny" aria-label={t("gather.down")} title={t("gather.down")} disabled={row === entries.length - 1 || writing !== null} onClick={() => move(entry.id, 1)}>
                        ↓
                      </button>
                      <button type="button" className="icon-btn tiny" aria-label={t("gather.remove")} title={t("gather.remove")} disabled={writing !== null} onClick={() => remove(entry.id)}>
                        <Icon name="close" size={11} stroke={1.6} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="gather-side">
            {plan && plan.used.length > 0 ? (
              <>
                <span className="pane-label">{t("gather.bedLabel")}</span>
                <div className="gather-bed-wrap">
                  <BedView sources={sources} plan={plan} numberOf={numberOf} />
                </div>
                <div className="kv gather-summary">
                  <span>{t("gather.slicerLabel")}</span>
                  <span>{plan.slicer === "bambu" ? t("gather.slicerBambu", { printer: base?.printerModel ?? "–" }) : t("gather.slicerPrusa")}</span>
                  <span>{t("gather.modelsLabel")}</span>
                  <span>{t("gather.models", { n: plan.used.length, parts: plan.used.reduce((sum, index) => sum + sources[index].parts.length, 0) })}</span>
                  <span>{t("gather.slotsLabel")}</span>
                  <span className="gather-chips">
                    {plan.slots.map((hex, i) => (
                      <span key={i} className="gather-chip" title={hex}>
                        <Swatch hex={hex} size={12} />E{i + 1}
                      </span>
                    ))}
                  </span>
                  <span>{t("gather.mixesLabel")}</span>
                  <span>
                    <b className="mono">{t("gather.mixes", { before: plan.mixesBefore, after: plan.mixes.length })}</b>
                    {plan.mixesBefore - plan.mixes.length - plan.joined.length > 0 && (
                      <span className="muted"> · {t("gather.mixesShared", { n: plan.mixesBefore - plan.mixes.length - plan.joined.length })}</span>
                    )}
                  </span>
                  {base && (
                    <>
                      <span>{t("gather.settingsLabel")}</span>
                      <span>{t("gather.settings", { h: base.layerHeight ? `${base.layerHeight} mm` : "–", printer: base.printerModel ?? "–" })}</span>
                    </>
                  )}
                </div>
                {plan.joined.length > 0 && (
                  <div className="note warn-box gather-joined">
                    <div className="warn">{t("gather.joinedTitle", { limit: plan.limit, n: plan.joined.length })}</div>
                    {plan.joined.map((join, k) => (
                      <div key={k} className="cell-colour">
                        <Swatch hex={join.from} size={12} />
                        <span aria-hidden="true">→</span>
                        <Swatch hex={join.to} size={12} />
                        <span className="mono muted">{t("gather.joinedRow", { faces: join.faces.toLocaleString(), d: join.distance.toFixed(1) })}</span>
                      </div>
                    ))}
                  </div>
                )}
                {plan.slotChanges.length > 0 && (
                  <div className="note warn-box">
                    {plan.slotChanges.map((change) => (
                      <div key={change.slot} className="cell-colour">
                        <Swatch hex={change.after} size={12} />
                        {t("gather.slotChange", { slot: change.slot, before: change.before, after: change.after })}
                      </div>
                    ))}
                  </div>
                )}
                {(plan.warnings.length > 0 || plan.tooMany) && (
                  <ul className="gather-warnings">
                    {plan.tooMany && <li className="warn">{t("gather.tooMany", { n: plan.slots.length + plan.mixes.length, max: plan.limit })}</li>}
                    {plan.warnings.map((warning) => (
                      <li key={warning.key} className="warn">
                        {warningText(warning)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="muted gather-open-hint">{t(plan.slicer === "bambu" ? "gather.openHintBambu" : "gather.openHint")}</p>
              </>
            ) : (
              <p className="muted gather-empty">{t("gather.intro")}</p>
            )}
          </div>
        </div>
        <footer className="gather-foot">
          <label className="row gather-name">
            <span className="row-label">{t("gather.fileName")}</span>
            <input type="text" value={fileName} placeholder={defaultName} onChange={(e) => setFileName(e.target.value)} />
          </label>
          {result?.kind === "ok" && (
            <span className="gather-result">
              <span className="ok">✓ {t("gather.done", { file: result.fileName, size: sizeText(result.blob.size) })}</span>
              <button type="button" className="text-link" onClick={() => downloadBlob(result.fileName, result.blob)}>
                {t("gather.downloadAgain")}
              </button>
            </span>
          )}
          {result?.kind === "error" && (
            <span className="warn gather-result" role="alert">
              {result.message}
            </span>
          )}
          {writing !== null && (
            <span className="gather-result muted">{t("gather.writing", { p: `${Math.round(writing * 100)}%` })}</span>
          )}
          <button type="button" className="btn primary" disabled={!canWrite} title={plan && plan.used.length < 2 ? t("gather.needTwo") : undefined} onClick={() => void write()}>
            <Icon name="download" size={14} stroke={1.7} />
            {t("gather.export")}
          </button>
        </footer>
      </div>
    </div>
  );
}
