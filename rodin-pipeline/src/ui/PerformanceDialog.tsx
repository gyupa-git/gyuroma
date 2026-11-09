import { useEffect, useState } from "react";
import type { PerformanceSettings } from "../engine/types";
import { useT } from "../i18n";
import { Icon, Segmented } from "./Shell";

/**
 * ⚙ Speed and memory (11-09): the switches that change how hard the computer works — the graphics card for the
 * colour map's unfolding, how many pixels the 3D views draw, the highlights' blinking, saving memory on big models,
 * and the 3MF's compression. Each one acts at once; the box says what this computer can do.
 */
export function PerformanceDialog({
  value,
  onChange,
  onClose,
  lowMemoryOn,
  faces,
}: {
  value: PerformanceSettings;
  onChange: (next: PerformanceSettings) => void;
  onClose: () => void;
  /** Whether saving memory is on now (by itself for a big model when "auto"). */
  lowMemoryOn: boolean;
  /** The open model's face count, if any. */
  faces: number | null;
}) {
  const t = useT();
  const [gpu, setGpu] = useState<"checking" | "yes" | "no">("checking");
  useEffect(() => {
    let alive = true;
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (!nav.gpu) {
      setGpu("no");
      return;
    }
    nav.gpu
      .requestAdapter()
      .then((adapter) => alive && setGpu(adapter ? "yes" : "no"))
      .catch(() => alive && setGpu("no"));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch: Partial<PerformanceSettings>) => onChange({ ...value, ...patch });
  const cores = navigator.hardwareConcurrency || 0;
  const heapLimit = (performance as Performance & { memory?: { jsHeapSizeLimit?: number } }).memory?.jsHeapSizeLimit;
  const screenRatio = Math.min(window.devicePixelRatio || 1, 2);
  const shownRatio = value.pixelRatio === "auto" ? screenRatio : value.pixelRatio;
  const onOff = (on: boolean) => (on ? "on" : "off");

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("perf.title")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="perf">
        <header className="perf-head">
          <div>
            <h2>{t("perf.title")}</h2>
            <p className="muted">{t("perf.sub")}</p>
          </div>
          <button type="button" className="icon-btn" aria-label={t("perf.close")} title={t("perf.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="perf-body">
          <div className="perf-device" role="note">
            <b>{t("perf.device")}</b>
            <span className={gpu === "yes" ? "ok" : undefined}>{gpu === "checking" ? t("perf.webgpuChecking") : gpu === "yes" ? t("perf.webgpuYes") : t("perf.webgpuNo")}</span>
            {cores > 0 && <span>{t("perf.cores", { n: cores })}</span>}
            {heapLimit ? <span>{t("perf.heap", { gb: (heapLimit / 1024 ** 3).toFixed(1) })}</span> : null}
          </div>

          <section className="perf-row">
            <b>{t("perf.gpu")}</b>
            <Segmented
              flat
              label={t("perf.gpu")}
              value={onOff(value.gpuUnfold)}
              onChange={(next) => set({ gpuUnfold: next === "on" })}
              options={[
                { value: "on", label: t("perf.on"), disabled: gpu === "no" && !value.gpuUnfold },
                { value: "off", label: t("perf.off") },
              ]}
            />
            <p>
              {t("perf.gpuHint")}
              {gpu === "no" && <> {t("perf.gpuNone")}</>}
            </p>
          </section>

          <section className="perf-row">
            <b>
              {t("perf.sharp")} <span className="perf-now">{t("perf.sharpNow", { x: String(shownRatio) })}</span>
            </b>
            <Segmented
              flat
              label={t("perf.sharp")}
              value={value.pixelRatio}
              onChange={(next) => set({ pixelRatio: next })}
              options={[
                { value: "auto", label: t("perf.auto") },
                { value: 1, label: "1×" },
                { value: 1.5, label: "1.5×" },
                { value: 2, label: "2×" },
              ]}
            />
            <p>{t("perf.sharpHint")}</p>
          </section>

          <section className="perf-row">
            <b>{t("perf.pulse")}</b>
            <Segmented
              flat
              label={t("perf.pulse")}
              value={onOff(value.highlightPulse)}
              onChange={(next) => set({ highlightPulse: next === "on" })}
              options={[
                { value: "on", label: t("perf.on") },
                { value: "off", label: t("perf.off") },
              ]}
            />
            <p>{t("perf.pulseHint")}</p>
          </section>

          <section className="perf-row">
            <b>
              {t("perf.memory")} <span className="perf-now">{lowMemoryOn ? t("perf.memoryNowOn") : t("perf.memoryNowOff")}</span>
            </b>
            <Segmented
              flat
              label={t("perf.memory")}
              value={value.lowMemory}
              onChange={(next) => set({ lowMemory: next })}
              options={[
                { value: "auto", label: t("perf.auto") },
                { value: "on", label: t("perf.on") },
                { value: "off", label: t("perf.off") },
              ]}
            />
            <p>
              {t("perf.memoryHint")}
              {faces !== null && <> {t("perf.memoryModel", { n: faces.toLocaleString() })}</>}
            </p>
          </section>

          <section className="perf-row">
            <b>{t("perf.worker")}</b>
            <Segmented
              flat
              label={t("perf.worker")}
              value={onOff(value.exportWorker)}
              onChange={(next) => set({ exportWorker: next === "on" })}
              options={[
                { value: "on", label: t("perf.on") },
                { value: "off", label: t("perf.off") },
              ]}
            />
            <p>{t("perf.workerHint")}</p>
          </section>

          <section className="perf-row">
            <b>{t("perf.zip")}</b>
            <Segmented
              flat
              label={t("perf.zip")}
              value={value.exportCompression}
              onChange={(next) => set({ exportCompression: next })}
              options={[
                { value: "small", label: t("perf.zipSmall") },
                { value: "fast", label: t("perf.zipFast") },
              ]}
            />
            <p>{t("perf.zipHint")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
