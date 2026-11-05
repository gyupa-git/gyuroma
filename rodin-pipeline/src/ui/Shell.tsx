import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LangContext, useT, type Lang } from "../i18n";
import wordmark from "../assets/brand/gyuroma-wordmark.svg";

/**
 * The pieces of the window frame: icons, the step bar, segmented controls,
 * drop-down menus and the glossary.  Everything here is presentation; the
 * state they show and change lives in App.
 */

const ICONS = {
  undo: <><path d="M5 3 2 6l3 3" /><path d="M2 6h7.5a4 4 0 0 1 0 8H7" /></>,
  redo: <><path d="m11 3 3 3-3 3" /><path d="M14 6H6.5a4 4 0 0 0 0 8H9" /></>,
  help: <><circle cx="8" cy="8" r="6.2" /><path d="M6.2 6.2a1.9 1.9 0 0 1 3.6.8c0 1.3-1.8 1.6-1.8 2.8" /><circle cx="8" cy="11.6" r="0.4" fill="currentColor" /></>,
  settings: <><path d="M7.01 3L7.14 1.15L8.86 1.15L8.99 3A5.1 5.1 0 0 1 10.83 3.76L12.23 2.55L13.45 3.77L12.24 5.17A5.1 5.1 0 0 1 13 7.01L14.85 7.14L14.85 8.86L13 8.99A5.1 5.1 0 0 1 12.24 10.83L13.45 12.23L12.23 13.45L10.83 12.24A5.1 5.1 0 0 1 8.99 13L8.86 14.85L7.14 14.85L7.01 13A5.1 5.1 0 0 1 5.17 12.24L3.77 13.45L2.55 12.23L3.76 10.83A5.1 5.1 0 0 1 3 8.99L1.15 8.86L1.15 7.14L3 7.01A5.1 5.1 0 0 1 3.76 5.17L2.55 3.77L3.77 2.55L5.17 3.76A5.1 5.1 0 0 1 7.01 3z" /><circle cx="8" cy="8" r="2.1" /></>,
  download: <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" />,
  check: <path d="M3.5 8.3 6.6 11.4 12.6 5" />,
  select: <path d="M3 2.5 12.5 7l-4 1.2L7 12.5z" />,
  brush: <><path d="M13.5 2.5 7.5 8.5" /><path d="M7.3 8.7c-1.6-.4-3.3.6-3.3 2.6 0 1-.6 1.6-1.5 1.9 2.9 1 5.6-.2 5.6-2.7" /></>,
  fill: <><path d="M8.5 2.5 13.5 7.5 9 12a1.5 1.5 0 0 1-2.1 0L4 9.1a1.5 1.5 0 0 1 0-2.1z" /><path d="M4.6 7.6h8.4" /><path d="M2.6 10c-.8 1.1-1.2 1.9-1.2 2.4a1.2 1.2 0 0 0 2.4 0c0-.5-.4-1.3-1.2-2.4z" /></>,
  // Two parts with three small triangles wedged between them, each its own way (the top one
  // tilted, so it is no mirror of the bottom one).
  gap: <><rect x="0.9" y="2" width="2" height="12" rx="1" /><rect x="13.1" y="2" width="2" height="12" rx="1" /><path d="M7.97 1.78 8.95 5.45 5.28 4.47zM6.41 8 9.7 6.1v3.8zM7.4 14.29 5.5 11h3.8z" fill="currentColor" stroke="none" /></>,
  /* the healing brush: a patch of colour with the specks (the gap icon's three pieces) lying in it */
  heal: <><rect x="1.2" y="1.2" width="13.6" height="13.6" rx="4.6" fill="currentColor" opacity="0.32" stroke="none" /><path d="M7.98 3.02 8.76 5.96 5.82 5.18zM6.73 8 9.36 6.48v3.04zM7.52 13.03 6 10.4h3.04z" fill="currentColor" stroke="none" /></>,
  // Tip, tube, collar and bulb on one centre line, turned 45° — the same drawing as the eyedropper cursor.
  eyedropper: <g transform="translate(3.333 13.333) rotate(-45)"><path d="M0 0 1.8-1.1H9V1.1H1.8z" /><path d="M9-1.9h.8v3.8H9z" fill="currentColor" /><path d="M9.8-1.5h1.8a1.5 1.5 0 0 1 0 3H9.8z" fill="currentColor" /></g>,
  map: <><path d="M1.5 3.5 5.5 2l5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5z" /><path d="M5.5 2v10.5M10.5 3.5V14" /></>,
  fit: <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />,
  lock: <><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>,
  pin: <><path d="M6 2.5h4l-.5 4 2 2v1h-7v-1l2-2z" /><path d="M8 9.5v4" /></>,
  split: <><path d="M2 8h12" /><path d="M5 4.5 8 2l3 2.5M5 11.5 8 14l3-2.5" /></>,
  mergeUp: <><path d="M8 13V4M4.5 7 8 3.5 11.5 7" /><path d="M3 2h10" /></>,
  link: <><circle cx="5" cy="8" r="2.5" /><circle cx="11" cy="8" r="2.5" /><path d="M7.5 8h1" /></>,
  cube: <><path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z" /><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6" /></>,
  flat: <><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11" /></>,
  // A round shape drawn in lines: its outline and the fold across it.
  lines: <><path d="M3 11.5C1.8 7.2 4.2 2.6 8.4 2.5c3.6-.1 5.6 3.4 4.7 6.7-.9 3.4-4.4 5.1-7.4 4.1" /><path d="M5.2 8.6c1.6-1.5 4.2-1.7 6-.4" /></>,
  // A staircase of faces, faint, and the straight line it is cut along.
  cutLine: <><path d="M2 13.5V11h3V8h3V5h3V2.5h3" strokeOpacity="0.4" /><path d="M2 12.5 13.5 3" /></>,
  soft: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="3.4" strokeOpacity="0.55" /><circle cx="8" cy="8" r="1.4" strokeOpacity="0.3" /></>,
  background: <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M2.5 8h11M8 2.5v11" /></>,
  xray: <><rect x="2.5" y="2.5" width="8" height="8" rx="1.2" strokeDasharray="2 1.6" /><rect x="5.5" y="5.5" width="8" height="8" rx="1.2" /></>,
  solo: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" fill="currentColor" /></>,
  refresh: <><path d="M13.5 8A5.5 5.5 0 1 1 11.8 4" /><path d="M13.5 2v3h-3" /></>,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  chevron: <path d="m4.5 6 3.5 3.5L11.5 6" />,
  layers: <><path d="M8 2 14 5 8 8 2 5z" /><path d="M2 8l6 3 6-3M2 11l6 3 6-3" /></>,
  rings: <><circle cx="5.2" cy="10" r="3" /><circle cx="11.3" cy="5.3" r="2.4" /><circle cx="12" cy="12" r="1.4" /></>,
  heart: <path d="M8 13.5S2.5 10.2 2.5 6.3A2.8 2.8 0 0 1 8 5a2.8 2.8 0 0 1 5.5 1.3c0 3.9-5.5 7.2-5.5 7.2z" />,
};

/**
 * Where GYUROMA can be supported: Toonation first in Korean (few there have
 * PayPal), PayPal first in English.  Shown only in quiet places — the settings
 * menu and the about page — never in the work.
 */
export function supportLinks(lang: Lang): Array<{ id: "toonation" | "paypal"; href: string }> {
  const links: Array<{ id: "toonation" | "paypal"; href: string }> = [
    { id: "toonation", href: "https://toon.at/donate/637376746437296380" },
    { id: "paypal", href: "https://paypal.me/gyupa" },
  ];
  return lang === "ko" ? links : links.reverse();
}
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, stroke = 1.5 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

/**
 * The slogan spells the name: the bracketed parts, set bright, read GYU + ROMA
 * (규파의 크로마 → 규로마; GYUpa's chROMA → GYUROMA).
 */
export function Slogan({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).filter(Boolean).map((part, i) =>
        part.startsWith("[") ? <b key={i}>{part.slice(1, -1)}</b> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/** The wordmark with Gyupa's face for its O; beside it the tagline over the slogan. */
export function Brand() {
  const t = useT();
  return (
    <div className="brand">
      <img className="brand-logo" src={wordmark} alt={t("brand.name")} />
      <span className="brand-words">
        <span className="brand-tagline">{t("brand.tagline")}</span>
        <span className="brand-slogan">
          <Slogan text={t("brand.slogan")} />
        </span>
      </span>
    </div>
  );
}

/** The logo's teeth, red to violet: the colours a line is written in. */
const RAINBOW = ["#F05653", "#FACA4B", "#43C07A", "#2B99E7", "#8E64D7"];

/** A colour along RAINBOW, t from 0 (red) to 1 (violet). */
function rainbowAt(t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (RAINBOW.length - 1);
  const k = Math.min(Math.floor(x), RAINBOW.length - 2);
  const f = x - k;
  const a = parseInt(RAINBOW[k].slice(1), 16);
  const b = parseInt(RAINBOW[k + 1].slice(1), 16);
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f);
  return `rgb(${mix(16)}, ${mix(8)}, ${mix(0)})`;
}

const letterCount = (text: string) => text.replace(/ /g, "").length;

/** A small repeatable random sequence, so the burst looks the same each time. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A line that writes itself: the letters land one by one, each glowing in its
 * colour along the rainbow; then each word snaps to the one rainbow colour
 * nearest its middle, colour by colour from `snap` every `beat` (so the red
 * words of every line snap together, then the yellow ones, ...); at `settle`
 * every letter turns at once to the line's own colour, and its colour bursts
 * out of it as `sparks` specks per letter.  Words never break inside.
 */
function Writing({ text, start, step, snap, beat, settle, sparks, seed, className }: { text: string; start: number; step: number; snap: number; beat: number; settle: number; sparks: number; seed: number; className: string }) {
  const count = letterCount(text);
  const along = (i: number) => (count > 1 ? i / (count - 1) : 0);
  const random = seeded(seed);
  let k = 0;
  return (
    <div className={`writing ${className}`}>
      <span className="sr-only">{text}</span>
      {text.split(" ").map((word, w) => (
        <span key={w} aria-hidden="true">
          {w > 0 && " "}
          <span className="writing-word">
            {[...word].map((letter, j) => {
              const i = k++;
              const stop = Math.round(along(i - j + (word.length - 1) / 2) * (RAINBOW.length - 1));
              const style = {
                "--c": rainbowAt(along(i)),
                "--w": RAINBOW[stop],
                "--land": `${start + i * step}ms`,
                "--snap": `${snap + stop * beat}ms`,
                "--settle": `${settle}ms`,
              } as CSSProperties;
              const specks = Array.from({ length: sparks }, (_, n) => {
                const angle = random() * Math.PI * 2;
                const reach = 1.4 + random() * 2.6;
                const speck = {
                  "--k": random() < 0.25 ? "#ffffff" : RAINBOW[stop],
                  "--s": `${(0.14 + random() * 0.16).toFixed(3)}em`,
                  "--dx": `${(Math.cos(angle) * reach * 1.3).toFixed(2)}em`,
                  "--dy": `${(Math.sin(angle) * reach).toFixed(2)}em`,
                  "--fall": `${(0.4 + random() * 0.6).toFixed(2)}em`,
                  "--burst": `${Math.round(800 + random() * 400)}ms`,
                  "--at": `${settle + Math.round(random() * 30)}ms`,
                } as CSSProperties;
                return <span key={n} className="writing-spark" style={speck} />;
              });
              return (
                <span key={i} className="writing-letter" style={style}>
                  {letter}
                  {specks}
                </span>
              );
            })}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * When each part of the welcome starts, in ms from when the card starts
 * playing; `end` is when the last speck has faded.  `written`: the lines are
 * already written, and the snap comes a moment after it starts playing.
 */
function welcomeTiming(tagline: string, about: string, written = false) {
  const taglineStart = 650;
  const taglineStep = 45;
  const aboutStart = taglineStart + letterCount(tagline) * taglineStep + 150;
  const aboutStep = 32;
  const snap = written ? 300 : aboutStart + letterCount(about) * aboutStep + 380;
  const beat = 140;
  // the last colour pops at 4 beats, takes 280 ms, and holds a moment before every letter turns white at once
  const settle = snap + (RAINBOW.length - 1) * beat + 280 + 300;
  // the slowest speck has faded by then
  return { taglineStart, taglineStep, aboutStart, aboutStep, snap, beat, settle, end: settle + 1250 };
}

/**
 * The GYUROMA card: the card pops up, the logo and how to read the name rise
 * in, the tagline and its second line write themselves in rainbow light, the
 * rainbow snaps into its five colours word by word, then both lines turn
 * white at once and the colours burst out of them.  `still` shows it already settled (the empty stage, after the
 * intro has played it).  `written` starts with the card up and the lines
 * already written in rainbow, standing still while `held`; then the snap,
 * the white and the burst play.
 */
export function Welcome({ hint, what, still = false, written = false, held = false, action }: { hint?: string; what?: string; still?: boolean; written?: boolean; held?: boolean; action?: ReactNode }) {
  const t = useT();
  const tagline = t("brand.tagline");
  const about = t("brand.about");
  const { taglineStart, taglineStep, aboutStart, aboutStep, snap, beat, settle } = welcomeTiming(tagline, about, written);
  const mode = still ? " still" : written ? ` written${held ? " held" : ""}` : "";
  return (
    <div className={`welcome${mode}`}>
      <img className="welcome-logo" src={wordmark} alt={t("brand.name")} />
      <div className="welcome-slogan">
        <Slogan text={t("brand.slogan")} />
      </div>
      <Writing className="welcome-tagline" text={tagline} start={taglineStart} step={taglineStep} snap={snap} beat={beat} settle={settle} sparks={3} seed={7} />
      <Writing className="welcome-about" text={about} start={aboutStart} step={aboutStep} snap={snap} beat={beat} settle={settle} sparks={1} seed={11} />
      {what && (
        <div className="welcome-hint welcome-what" style={{ "--rise": `${settle + 400}ms` } as CSSProperties}>
          {what}
        </div>
      )}
      {hint && (
        <div className="welcome-hint" style={{ "--rise": `${settle + 500}ms` } as CSSProperties}>
          {hint}
        </div>
      )}
      {action && (
        <div className="welcome-hint welcome-action" style={{ "--rise": `${settle + 700}ms` } as CSSProperties}>
          {action}
        </div>
      )}
    </div>
  );
}

/**
 * Calls `done` once the page draws smoothly again: ten frames in a row each
 * under 50 ms (whatever just loaded has drawn its first frames), or after
 * `limit` ms.  It waits while the tab is hidden.  Returns a cancel.
 */
function whenSmooth(done: () => void, limit = 2500): () => void {
  let raf = 0;
  let smooth = 0;
  let first = -1;
  let last = -1;
  const tick = (now: number) => {
    if (first < 0) first = now;
    smooth = last >= 0 && now - last < 50 ? smooth + 1 : 0;
    last = now;
    if (smooth >= 10 || now - first > limit) done();
    else raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/**
 * The welcome played over the whole window each time the app opens (first
 * visit or reload).  The app loads first: the card shows at once with its
 * lines already written, standing still while `hold` (the saved work is still
 * loading), and plays on (snap, white, burst) once the loading is done and
 * the page draws smoothly.  It fades out a moment after the last speck; a
 * click or any key skips it.  As the about page
 * (`about`, from the settings menu) it stays until closed, with a note under
 * the card and a button to play it again.
 */
export function Intro({ onDone, hold = false, about }: { onDone: () => void; hold?: boolean; about?: { note: string } }) {
  const t = useT();
  const { lang } = useContext(LangContext);
  const [leaving, setLeaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [round, setRound] = useState(0);
  const { end } = welcomeTiming(t("brand.tagline"), t("brand.about"), !about);
  useEffect(() => {
    if (hold || playing) return;
    return whenSmooth(() => setPlaying(true));
  }, [hold, playing]);
  useEffect(() => {
    const skip = () => setLeaving(true);
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, []);
  useEffect(() => {
    if (about || !playing) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setLeaving(true), reduced ? 1500 : end + 700);
    return () => window.clearTimeout(timer);
  }, [end, about, playing]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onDone, 420);
    return () => window.clearTimeout(timer);
  }, [leaving, onDone]);
  return (
    <div className={`intro${leaving ? " leaving" : ""}`} onPointerDown={() => setLeaving(true)}>
      <div className="intro-body">
        <Welcome key={round} written={!about} held={!playing} />
        {about && (
          <div className="intro-about" onPointerDown={(event) => event.stopPropagation()}>
            <span>{about.note}</span>
            <button type="button" className="btn small" onClick={() => setRound(round + 1)}>
              {t("about.replay")}
            </button>
            <button type="button" className="btn small" onClick={() => setLeaving(true)}>
              {t("about.close")}
            </button>
          </div>
        )}
        {about && (
          <div className="intro-about" onPointerDown={(event) => event.stopPropagation()}>
            <span>{t("support.note")}</span>
            {supportLinks(lang).map((link) => (
              <a key={link.id} className="btn small" href={link.href} target="_blank" rel="noopener noreferrer">
                <Icon name="heart" size={12} /> {t(link.id === "toonation" ? "support.toonation" : "support.paypal")}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface StepInfo {
  id: number;
  label: string;
  count?: string;
  done?: boolean;
}

export function StepNav({ steps, current, onChange }: { steps: StepInfo[]; current: number; onChange: (id: number) => void }) {
  const t = useT();
  return (
    <nav className="steps" aria-label={t("steps.aria")}>
      {steps.map((step) => {
        const active = step.id === current;
        return (
          <button key={step.id} type="button" className="step" aria-current={active ? "step" : undefined} onClick={() => onChange(step.id)}>
            {step.done && !active ? (
              <span className="step-done">
                <Icon name="check" size={10} stroke={1.8} />
              </span>
            ) : (
              <span className="step-no">{String(step.id).padStart(2, "0")}</span>
            )}
            <span>{step.label}</span>
            {step.count && <span className="step-count">{step.count}</span>}
          </button>
        );
      })}
    </nav>
  );
}

/** A row of mutually exclusive buttons (aria-pressed on the chosen one). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  flat = false,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string; disabled?: boolean }>;
  onChange: (next: T) => void;
  flat?: boolean;
  label?: string;
}) {
  return (
    <div className={`seg${flat ? " flat" : ""}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          title={option.title}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A button with a drop-down panel under it.  Closes on a click outside, on
 * Escape, and (unless the panel asks otherwise) after an item is chosen.
 */
export function Menu({
  trigger,
  children,
  align = "right",
  className = "",
  title,
  triggerClassName = "icon-btn",
  label,
  guide,
}: {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  className?: string;
  title?: string;
  triggerClassName?: string;
  label?: string;
  /** Names it for the app guide to walk to (data-guide). */
  guide?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (wrapRef.current && target && wrapRef.current.contains(target)) return;
      // Pickers and selects open their own popovers on the body; a click in
      // one of them is still a click "inside" this menu.
      if (target instanceof Element && target.closest(".colour-picker-popover, .colour-select-popover, .help-popover")) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="menu-wrap" ref={wrapRef} data-guide={guide}>
      <button type="button" className={triggerClassName} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={title} onClick={() => setOpen((v) => !v)}>
        {trigger}
      </button>
      {open && <div className={`menu ${align === "left" ? "left" : ""} ${className}`}>{typeof children === "function" ? children(close) : children}</div>}
    </div>
  );
}

/** The terms the screens use, one line each, in three groups. */
export function Glossary() {
  const t = useT();
  const groups: Array<{ title: string; items: Array<{ term: string; name: string; text: string; eg?: string }> }> = [
    {
      title: t("glossary.groupPrint"),
      items: [
        { term: "E1–E5", name: t("glossary.slotName"), text: t("glossary.slotText"), eg: t("glossary.slotEg") },
        { term: t("glossary.singleTerm"), name: t("glossary.singleName"), text: t("glossary.singleText") },
        { term: "VE", name: t("glossary.veName"), text: t("glossary.veText"), eg: t("glossary.veEg") },
        { term: t("glossary.cycleTerm"), name: t("glossary.cycleName"), text: t("glossary.cycleText") },
        { term: t("glossary.fidelityTerm"), name: t("glossary.fidelityName"), text: t("glossary.fidelityText") },
      ],
    },
    {
      title: t("glossary.groupColour"),
      items: [
        { term: "ΔE", name: t("glossary.deName"), text: t("glossary.deText") },
        { term: t("glossary.familyTerm"), name: t("glossary.familyName"), text: t("glossary.familyText") },
        { term: t("glossary.groupTerm"), name: t("glossary.groupName"), text: t("glossary.groupText") },
        { term: t("glossary.shadesTerm"), name: t("glossary.shadesName"), text: t("glossary.shadesText") },
      ],
    },
    {
      title: t("glossary.groupActions"),
      items: [
        { term: t("glossary.cutTerm"), name: t("glossary.cutName"), text: t("glossary.cutText") },
        { term: t("glossary.protectTerm"), name: t("glossary.protectName"), text: t("glossary.protectText") },
        { term: t("glossary.cleanupTerm"), name: t("glossary.cleanupName"), text: t("glossary.cleanupText") },
      ],
    },
  ];
  return (
    <>
      {groups.map((group) => (
        <div key={group.title}>
          <div className="glossary-group">{group.title}</div>
          {group.items.map((item) => (
            <div key={item.term} className="glossary-item">
              <span className="glossary-term">{item.term}</span>
              <span>
                <span className="glossary-name">{item.name}</span>
                <div className="glossary-text">{item.text}</div>
                {item.eg && <div className="glossary-eg">{item.eg}</div>}
              </span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
