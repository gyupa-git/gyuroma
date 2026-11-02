import { Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { GUIDE, HINTS, markHintsSeen, type GuideHintKey, type GuidePose, type GuideStep } from "../guide";
import { LangContext } from "../i18n";
import { GuideGyupa, VIEW } from "./GuideGyupa";
import { Icon } from "./Shell";

/**
 * The app guide: the window dims, the part being explained stays lit, and
 * Gyupa walks over to it, points with the pen and says what it is.  Chapters
 * come from guide.ts; a chapter can open an app step (01–04) before Gyupa
 * walks.  While the guide is open the app underneath takes no clicks or keys;
 * closing it brings back the step that was open before.  A first-time hint
 * (guide.ts HINTS) is one bubble of the same, and can hand over to the guide.
 */

export type GuideMode = { kind: "guide"; chapter?: number } | { kind: "hint"; hint: GuideHintKey };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Phase = { kind: "menu" } | { kind: "chapter"; chapter: number; index: number } | { kind: "end"; chapter: number } | { kind: "hint"; hint: GuideHintKey };

interface Placement {
  gyupa: { x: number; y: number };
  bubble: { x: number; y: number };
  tail: "down" | "up" | "left" | "right";
  /** Where along the bubble's edge its tail sits (px from its left or top). */
  tailAt: number;
  dir: 1 | -1;
  aim: number | null;
  light: Box | null;
}

const MARGIN = 10;
/** The tour's place in the guide's contents (the welcome hint offers it). */
const TOUR = GUIDE.findIndex((chapter) => chapter.id === "tour");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The first selector that finds something on screen ("a@b": a, then its closest b). */
function findTarget(at: string[] | undefined): HTMLElement | null {
  for (const spec of at ?? []) {
    const [selector, up] = spec.split("@");
    let element = document.querySelector<HTMLElement>(selector);
    if (element && up) element = element.closest<HTMLElement>(up);
    if (!element || element.closest(".guide")) continue;
    const box = element.getBoundingClientRect();
    if (box.width >= 4 && box.height >= 4) return element;
  }
  return null;
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Where Gyupa stands and where the bubble goes: beside the lit part, both on
 * screen, the bubble off the lit part — tried every way round, the least bad
 * kept (nearer the part, the bubble over Gyupa's head before anywhere else).
 */
function place(target: Box | null, vw: number, vh: number, gw: number, gh: number, bw: number, bh: number): Placement {
  const light = target
    ? (() => {
        const x = clamp(target.x - 6, 4, vw - 8);
        const y = clamp(target.y - 6, 4, vh - 8);
        return { x, y, w: Math.min(target.x + target.w + 6, vw - 4) - x, h: Math.min(target.y + target.h + 6, vh - 4) - y };
      })()
    : null;
  const spots: Array<{ x: number; y: number; cost: number }> = [];
  if (!light) spots.push({ x: vw / 2 - gw / 2, y: vh * 0.6 - gh / 2, cost: 0 });
  else {
    const cx = light.x + light.w / 2;
    const cy = light.y + light.h / 2;
    const big = light.w > vw * 0.45 || light.h > vh * 0.55;
    spots.push(
      { x: light.x + light.w + 6, y: cy - gh / 2, cost: 0 },
      { x: light.x - 6 - gw, y: cy - gh / 2, cost: 0 },
      { x: cx - gw / 2, y: light.y + light.h + 6, cost: 0 },
      { x: cx - gw / 2, y: light.y - 6 - gh, cost: 0 },
      { x: cx - gw / 2, y: light.y + light.h - gh - 18, cost: big ? 40 : 400 },
      { x: light.x + 18, y: light.y + light.h - gh - 18, cost: big ? 60 : 400 },
    );
  }
  let best: (Placement & { score: number }) | null = null;
  for (const spot of spots) {
    const gx = clamp(spot.x, MARGIN, vw - gw - MARGIN);
    const gy = clamp(spot.y, MARGIN, vh - gh - MARGIN);
    const shift = Math.abs(gx - spot.x) + Math.abs(gy - spot.y);
    // Gyupa's body (the drawing's middle), for overlaps and for where the bubble's tail points.
    const body = { x: gx + gw * 0.28, y: gy + gh * 0.12, w: gw * 0.44, h: gh * 0.88 };
    const head = { x: gx + gw / 2, y: gy + gh * 0.32 };
    const bubbles: Array<{ tail: Placement["tail"]; x: number; y: number; cost: number }> = [
      { tail: "down", x: head.x - bw / 2, y: gy + gh * 0.05 - bh - 6, cost: 0 },
      { tail: "left", x: gx + gw * 0.82, y: head.y - bh * 0.45, cost: 25 },
      { tail: "right", x: gx + gw * 0.18 - bw, y: head.y - bh * 0.45, cost: 25 },
      { tail: "up", x: head.x - bw / 2, y: gy + gh + 6, cost: 45 },
    ];
    for (const b of bubbles) {
      const bx = clamp(b.x, MARGIN, vw - bw - MARGIN);
      const by = clamp(b.y, MARGIN, vh - bh - MARGIN);
      const bubbleBox = { x: bx, y: by, w: bw, h: bh };
      let score = spot.cost + b.cost + shift * 0.4 + (Math.abs(bx - b.x) + Math.abs(by - b.y)) * 0.6;
      score += overlap(bubbleBox, body) / 12;
      if (light) {
        score += overlap(bubbleBox, light) / 25 + overlap(body, light) / 60;
        const px = clamp(gx + gw / 2, light.x, light.x + light.w);
        const py = clamp(gy + gh / 2, light.y, light.y + light.h);
        score += Math.hypot(px - (gx + gw / 2), py - (gy + gh / 2)) * 0.15;
      }
      if (!best || score < best.score) {
        let aim: number | null = null;
        let dir: 1 | -1 = gx + gw / 2 < vw / 2 ? 1 : -1;
        if (light) {
          const cx = gx + gw / 2;
          const cy = gy + gh * 0.4;
          const inside = cx > light.x && cx < light.x + light.w && cy > light.y && cy < light.y + light.h;
          const tx = inside ? light.x + light.w / 2 : clamp(cx, light.x + 8, light.x + light.w - 8);
          const ty = inside ? light.y + light.h / 2 : clamp(cy, light.y + 8, light.y + light.h - 8);
          dir = tx >= cx ? 1 : -1;
          if (inside && Math.abs(tx - cx) < 20) dir = cx < vw / 2 ? 1 : -1;
          aim = Math.atan2(ty - cy, tx - cx);
        }
        const tailAt = b.tail === "down" || b.tail === "up" ? clamp(head.x - bx, 18, bw - 18) : clamp(head.y - by, 16, bh - 16);
        best = { gyupa: { x: gx, y: gy }, bubble: { x: bx, y: by }, tail: b.tail, tailAt, dir, aim, light, score };
      }
    }
  }
  return best as Placement;
}

/** **bold** in a guide line: the words to find on the screen. */
function rich(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>));
}

export function GuideTour({ mode, onMode, step, onStep }: { mode: GuideMode | null; onMode: (mode: GuideMode | null) => void; step: number; onStep: (step: number) => void }) {
  const open = mode !== null;
  const { lang, t } = useContext(LangContext);
  const [phase, setPhase] = useState<Phase>({ kind: "menu" });
  const [shown, setShown] = useState<Placement | null>(null);
  const [gyupaAt, setGyupaAt] = useState<{ x: number; y: number; ms: number } | null>(null);
  const [walking, setWalking] = useState(false);
  const [talking, setTalking] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const runRef = useRef(0);
  const startStepRef = useRef(step);
  const stepRef = useRef(step);
  stepRef.current = step;
  const gyupaRef = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  const gh = Math.round(clamp(Math.min(size.h * 0.19, size.w * 0.3), 84, 168));
  const gw = Math.round((gh * VIEW.w) / VIEW.h);
  const bw = Math.min(360, size.w - 2 * MARGIN);

  const current: GuideStep | null = phase.kind === "chapter" ? GUIDE[phase.chapter].steps[phase.index] : phase.kind === "hint" ? HINTS[phase.hint] : null;
  const pose: GuidePose = phase.kind === "menu" ? "salute" : phase.kind === "end" ? "cheer" : current?.pose ?? (current?.at ? "point" : "idle");

  const modeRef = useRef<GuideMode | null>(null);
  useEffect(() => {
    const before = modeRef.current;
    modeRef.current = mode;
    if (!mode) return;
    // The step to come back to: the one open when the guide (not a hint) began.  Whoever opens
    // the guide has found it: the welcome hint (and the hint for the step on screen) is not owed.
    if (mode.kind === "guide" && before?.kind !== "guide") {
      startStepRef.current = stepRef.current;
      markHintsSeen(["welcome", stepRef.current]);
    }
    setPhase(mode.kind === "hint" ? { kind: "hint", hint: mode.hint } : mode.chapter !== undefined ? { kind: "chapter", chapter: mode.chapter, index: 0 } : { kind: "menu" });
    if (before) return;
    setShown(null);
    setTalking(false);
    // Gyupa walks in from the right, over the floor of the window.
    const start = { x: window.innerWidth + 10, y: window.innerHeight * 0.6 - gh / 2 };
    gyupaRef.current = start;
    setGyupaAt({ ...start, ms: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // The tour shows every step: their first-time hints have nothing more to say.
  useEffect(() => {
    if (phase.kind === "chapter" && GUIDE[phase.chapter].id === "tour") markHintsSeen([2, 3, 4]);
  }, [phase]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const close = () => {
    runRef.current++;
    if (mode?.kind === "guide" && stepRef.current !== startStepRef.current) onStep(startStepRef.current);
    onMode(null);
  };

  // Each new line (or menu): open its app step, find the part, place, walk, then talk.
  useLayoutEffect(() => {
    if (!open) return;
    const run = ++runRef.current;
    setTalking(false);
    void (async () => {
      if (current?.step && stepRef.current !== current.step) {
        onStep(current.step);
        await sleep(160);
      }
      await frame();
      await frame();
      if (run !== runRef.current) return;
      const element = current ? findTarget(current.at) : null;
      if (element) {
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
        await frame();
      }
      if (run !== runRef.current) return;
      const box = element?.getBoundingClientRect();
      const bubbleH = bubbleRef.current?.offsetHeight ?? 160;
      const placed = place(box ? { x: box.left, y: box.top, w: box.width, h: box.height } : null, size.w, size.h, gw, gh, bw, bubbleH);
      const from = gyupaRef.current ?? placed.gyupa;
      const distance = Math.hypot(placed.gyupa.x - from.x, placed.gyupa.y - from.y);
      const ms = reducedMotion() || distance < 4 ? 0 : Math.round(clamp(distance * 1.6, 260, 1300));
      gyupaRef.current = placed.gyupa;
      setShown(placed);
      setGyupaAt({ ...placed.gyupa, ms });
      setWalking(ms > 0);
      if (ms > 0) await sleep(ms);
      if (run !== runRef.current) return;
      setWalking(false);
      setTalking(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase, size.w, size.h, lang]);

  useEffect(() => {
    if (talking) primaryRef.current?.focus({ preventScroll: true });
  }, [talking]);

  const next = () => {
    if (phase.kind !== "chapter") return;
    const chapter = GUIDE[phase.chapter];
    if (phase.index + 1 < chapter.steps.length) setPhase({ ...phase, index: phase.index + 1 });
    else {
      setSeen((prev) => new Set(prev).add(phase.chapter));
      setPhase({ kind: "end", chapter: phase.chapter });
    }
  };
  const prev = () => {
    if (phase.kind === "chapter" && phase.index > 0) setPhase({ ...phase, index: phase.index - 1 });
    else setPhase({ kind: "menu" });
  };

  // Keys: the guide's own, and none of the app's while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") return;
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (phase.kind === "chapter" && (event.key === "ArrowRight" || event.key === "PageDown")) {
        event.preventDefault();
        next();
      } else if (phase.kind === "chapter" && (event.key === "ArrowLeft" || event.key === "PageUp")) {
        event.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!open) return null;
  const say = (ko: string, en: string) => (lang === "ko" ? ko : en);
  const chapterButtons = (
    <div className="guide-chapters">
      {GUIDE.map((chapter, i) => (
        <button key={chapter.id} type="button" className="guide-chapter" ref={i === 0 ? primaryRef : undefined} onClick={() => setPhase({ kind: "chapter", chapter: i, index: 0 })}>
          <span className="icon" aria-hidden="true">
            <Icon name={chapter.icon} size={14} stroke={1.5} />
          </span>
          <span>{say(chapter.ko, chapter.en)}</span>
          {seen.has(i) && (
            <span className="seen" title={t("guide.seen")}>
              <Icon name="check" size={12} stroke={1.8} />
            </span>
          )}
        </button>
      ))}
    </div>
  );

  let body: ReactNode;
  if (phase.kind === "hint") {
    const line = HINTS[phase.hint];
    body = (
      <>
        <p className="guide-text">{rich(say(line.ko, line.en))}</p>
        <div className="guide-actions">
          {phase.hint === "welcome" ? (
            <>
              <button type="button" className="btn small" onClick={close}>
                {t("guide.hintSelf")}
              </button>
              <button type="button" className="btn small primary" ref={primaryRef} onClick={() => onMode({ kind: "guide", chapter: TOUR })}>
                {say(GUIDE[TOUR].ko, GUIDE[TOUR].en)}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn small" onClick={() => onMode({ kind: "guide" })}>
                {t("guide.hintAll")}
              </button>
              <button type="button" className="btn small primary" ref={primaryRef} onClick={close}>
                {t("guide.hintOk")}
              </button>
            </>
          )}
        </div>
      </>
    );
  } else if (phase.kind === "menu" || phase.kind === "end") {
    body = (
      <>
        <p className="guide-text">{phase.kind === "menu" ? t("guide.hello") : t("guide.more")}</p>
        {chapterButtons}
        <div className="guide-actions">
          <span className="guide-keys">{t("guide.keysMenu")}</span>
          <button type="button" className="btn small" onClick={close}>
            {phase.kind === "menu" ? t("guide.later") : t("guide.finish")}
          </button>
        </div>
      </>
    );
  } else {
    const chapter = GUIDE[phase.chapter];
    const line = chapter.steps[phase.index];
    const last = phase.index === chapter.steps.length - 1;
    body = (
      <>
        <div className="guide-head">
          <span className="icon" aria-hidden="true">
            <Icon name={chapter.icon} size={12} stroke={1.6} />
          </span>
          <span>{say(chapter.ko, chapter.en)}</span>
          <span className="guide-count mono">
            {phase.index + 1} / {chapter.steps.length}
          </span>
        </div>
        <p className="guide-text">{rich(say(line.ko, line.en))}</p>
        <div className="guide-actions">
          <span className="guide-keys">{t("guide.keys")}</span>
          <button type="button" className="btn small" onClick={prev}>
            {phase.index === 0 ? t("guide.contents") : t("guide.prev")}
          </button>
          <button type="button" className="btn small primary" ref={primaryRef} onClick={next}>
            {last ? t("guide.chapterDone") : t("guide.next")}
          </button>
        </div>
      </>
    );
  }

  const light = shown?.light ?? null;
  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label={t("guide.title")}>
      <div
        className={`guide-light${light ? "" : " none"}`}
        style={light ? { left: light.x, top: light.y, width: light.w, height: light.h } : { left: size.w / 2, top: size.h / 2, width: 0, height: 0 }}
        aria-hidden="true"
      />
      {gyupaAt && (
        <div
          className="guide-walker"
          style={{ transform: `translate(${gyupaAt.x}px, ${gyupaAt.y}px)`, transitionDuration: `${gyupaAt.ms}ms` }}
          aria-hidden="true"
        >
          <GuideGyupa pose={talking ? pose : "idle"} dir={shown?.dir ?? -1} walking={walking} aim={shown?.aim ?? null} height={gh} />
        </div>
      )}
      <div
        ref={bubbleRef}
        className={`guide-bubble tail-${shown?.tail ?? "down"}${talking ? " on" : ""}`}
        style={{ left: shown?.bubble.x ?? -9999, top: shown?.bubble.y ?? 0, width: bw, ["--tail" as string]: `${shown?.tailAt ?? bw / 2}px` }}
        aria-live="polite"
      >
        <button type="button" className="guide-close" aria-label={t("guide.close")} title={t("guide.close")} onClick={close}>
          <Icon name="close" size={12} />
        </button>
        {body}
      </div>
    </div>
  );
}
