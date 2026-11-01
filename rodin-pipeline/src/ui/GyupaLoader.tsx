import face from "../assets/brand/gyupa-face-parts.json";

/** The teeth of the logo (docs/로고/로고규칙.md): coral, marigold, emerald, sky, violet. */
const TEETH = ["#F05653", "#FACA4B", "#43C07A", "#2B99E7", "#8E64D7"];

/** The drawing's area with room for the ring: what the face element spans. */
const PAD = 48;
const SPAN = face.canvas + 2 * PAD;

/** Half the side of the square each dizzy swirl takes, in the drawing's units (an eye is about 210 across). */
const SWIRL = 140;
/** The swirl's line, about as thick as the drawing's own lines. */
const SWIRL_LINE = 30;

/** A spiral out from the middle of a square (−SWIRL…SWIRL): under two turns, the gaps between them wider than the line (so it reads as a swirl, not a round eye). */
const SWIRL_PATH = (() => {
  const turns = 1.7;
  const steps = 120;
  const reach = SWIRL - SWIRL_LINE / 2;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * 2 * Math.PI;
    const r = reach * t;
    d += `${i === 0 ? "M" : "L"}${(r * Math.cos(angle)).toFixed(1)} ${(r * Math.sin(angle)).toFixed(1)}`;
  }
  return d;
})();

/**
 * Gyupa's face turning: the app's one sign that it is working.  The face from
 * the canonical line drawing (trace_face_parts.py — never redrawn), as on a dark
 * background (the face is the background, the lines are light, the teeth the
 * logo's rainbow).  Five seconds on, the eyes turn into spinning swirls (dizzy).
 *
 * The turning is the compositor's (a CSS transform on plain elements, the eyes'
 * start delayed in CSS), so it goes on while the page is busy reading a model or
 * working out a merge — when no script or SVG animation would move.
 */
export function GyupaSpin({ size }: { size: number }) {
  const half = face.canvas / 2;
  const at = (v: number) => `${((v + PAD) / SPAN) * 100}%`;
  return (
    <span className="gyupa-spin" style={{ width: size, height: size }} aria-hidden="true">
      <span className="gyupa-spin-face">
        <svg viewBox={`${-PAD} ${-PAD} ${SPAN} ${SPAN}`} width="100%" height="100%">
          <circle cx={half} cy={half} r={half + 8} fill="none" stroke="currentColor" strokeWidth={64} />
          {face.teeth.map((d, i) => (
            <path key={i} d={d} fill={TEETH[i % TEETH.length]} stroke={TEETH[i % TEETH.length]} strokeWidth={6} />
          ))}
          <path d={face.mouth} fill="currentColor" fillRule="evenodd" />
        </svg>
        {face.eyes.map((eye, i) => {
          const [x, y, w, h] = eye.box;
          const [cx, cy] = eye.centre;
          return (
            <span key={i}>
              <span className="gyupa-spin-eye" style={{ left: at(x), top: at(y), width: `${(w / SPAN) * 100}%`, height: `${(h / SPAN) * 100}%` }}>
                <svg viewBox={`${x} ${y} ${w} ${h}`} width="100%" height="100%">
                  <path d={eye.d} fill="currentColor" />
                </svg>
              </span>
              <span
                className="gyupa-spin-swirl"
                style={{ left: at(cx - SWIRL), top: at(cy - SWIRL), width: `${((2 * SWIRL) / SPAN) * 100}%`, height: `${((2 * SWIRL) / SPAN) * 100}%` }}
              >
                <svg viewBox={`${-SWIRL} ${-SWIRL} ${2 * SWIRL} ${2 * SWIRL}`} width="100%" height="100%">
                  <path d={SWIRL_PATH} fill="none" stroke="currentColor" strokeWidth={SWIRL_LINE} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** While the app works: the turning face in the middle of the view, with what it is doing. */
export function GyupaLoader({ label }: { label: string | null }) {
  if (!label) return null;
  // One element for the whole wait (its words may change): the five seconds count from its start.
  return (
    <div className="gyupa-loader" role="status" aria-live="polite">
      <GyupaSpin size={44} />
      <span>{label}</span>
    </div>
  );
}

/** A small turning face for a line of text that is waiting (e.g. the tidy AI answering). */
export function GyupaWaiting({ size = 16 }: { size?: number }) {
  return <GyupaSpin size={size} />;
}
