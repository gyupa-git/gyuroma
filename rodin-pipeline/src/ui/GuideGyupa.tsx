import face from "../assets/brand/gyupa-face-parts.json";
import type { GuidePose } from "../guide";

/**
 * Gyupa the guide: the broadcast's floor Gyupa (규파방송국 js/crowd.js
 * drawNpc), drawn the same way — the face from the canonical line drawing
 * (trace_face_parts.py, never redrawn) on a white sticker with a gold ring and
 * an ink rim, two feet, two round hands and the orange 3D pen — with the crown
 * of the floor's leader.  The face is never mirrored: turning round moves the
 * hands, the pen and the crown's tilt to the other side.
 *
 * Units: the body's radius is R, the ground is y = 0.  Poses move the hands
 * and the pen (CSS transitions on their transforms); walking and idling are
 * CSS animations on inner groups, so the two never fight over one transform.
 */
const R = 40;
const LIFT = R * 0.24;
const BODY_Y = -LIFT - R;
const HAND_R = R * 0.19;
const PEN = R * 1.25;
const INK = "#1d2a2e";
const SKIN = "#fff6e8";
const GOLD = "#ffcf4a";
/** Where the drawing reaches, for the viewBox: hands and pen out to the sides, the crown on top. */
export const VIEW = { x: -95, y: -128, w: 190, h: 142 };
/** The sticker: ring and rim around the line drawing, in its 1024 canvas. */
const FACE_RING = 540;
const FACE_RIM = 590;
const FACE_SCALE = R / (FACE_RIM + 18);

interface Hand {
  x: number;
  y: number;
}

/** The hands (front = the side Gyupa faces) and the pen's angle for a pose. */
function handsFor(pose: GuidePose, dir: 1 | -1, aim: number | null): { front: Hand; back: Hand; pen: number; penInFront: boolean } {
  const rest = { front: { x: dir * R * 1.02, y: BODY_Y + R * 0.22 }, back: { x: -dir * R * 1.02, y: BODY_Y + R * 0.22 } };
  const lean = -Math.PI / 2 + dir * 0.95;
  switch (pose) {
    case "point": {
      // The pen hand reaches out toward what is pointed at; the pen points at it.
      // Always out on the side faced (up or down too), so the hand never covers the face or the crown.
      const angle = aim ?? (dir > 0 ? -0.35 : Math.PI + 0.35);
      const out = { x: dir * R * (0.92 + 0.22 * Math.abs(Math.cos(angle))), y: BODY_Y + Math.sin(angle) * R * 0.55 + R * 0.05 };
      return { front: out, back: rest.back, pen: angle, penInFront: true };
    }
    case "salute":
      // Pen hand up at the brim of the crown, the pen standing up and out: a salute with the pen.
      return { front: { x: dir * R * 0.78, y: BODY_Y - R * 0.78 }, back: rest.back, pen: -Math.PI / 2 + dir * 0.55, penInFront: true };
    case "wave":
      return { front: { x: dir * R * 1.05, y: BODY_Y - R * 0.55 }, back: rest.back, pen: lean, penInFront: false };
    case "cheer":
      return { front: { x: dir * R * 1.0, y: BODY_Y - R * 0.95 }, back: { x: -dir * R * 1.0, y: BODY_Y - R * 0.95 }, pen: -Math.PI / 2 - dir * 0.35, penInFront: false };
    case "think":
      // A hand at the chin, the pen tucked behind.
      return { front: { x: dir * R * 0.45, y: BODY_Y + R * 0.95 }, back: rest.back, pen: lean, penInFront: false };
    default:
      return { ...rest, pen: lean, penInFront: false };
  }
}

function Pen({ angle }: { angle: number }) {
  return (
    <g className="gg-pen" style={{ transform: `rotate(${(angle * 180) / Math.PI}deg)` }}>
      <line x1={-PEN * 0.35} y1={0} x2={PEN * 0.65} y2={0} stroke={INK} strokeWidth={R * 0.3} strokeLinecap="round" />
      <line x1={-PEN * 0.3} y1={0} x2={PEN * 0.42} y2={0} stroke="#ff9a2e" strokeWidth={R * 0.18} strokeLinecap="round" />
      <line x1={PEN * 0.42} y1={0} x2={PEN * 0.62} y2={0} stroke="#3a2a22" strokeWidth={R * 0.18} strokeLinecap="round" />
    </g>
  );
}

function HandDot({ at, pen }: { at: Hand; pen?: number }) {
  return (
    <g className="gg-hand" style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
      {pen !== undefined && <Pen angle={pen} />}
      <circle r={HAND_R} fill={SKIN} stroke={INK} strokeWidth={2.4} />
    </g>
  );
}

/** The crown of the floor's leader: gold, three points with balls, a red stone. */
function Crown({ dir }: { dir: 1 | -1 }) {
  return (
    <g style={{ transform: `translate(${dir * R * 0.12}px, ${BODY_Y - R * 0.86}px) rotate(${dir * 9}deg)` }}>
      <path d="M-15 0 L-15 -13 L-7.5 -6 L0 -17 L7.5 -6 L15 -13 L15 0 Z" fill={GOLD} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <rect x={-15} y={-4.5} width={30} height={4.5} fill="#f0b43c" stroke={INK} strokeWidth={1.6} />
      {[-15, 0, 15].map((x) => (
        <circle key={x} cx={x} cy={x === 0 ? -17 : -13} r={2.6} fill={GOLD} stroke={INK} strokeWidth={1.6} />
      ))}
      <circle cx={0} cy={-2.3} r={2} fill="#e0443c" />
    </g>
  );
}

/** The face sticker: white disc, the line drawing (its teeth are holes in the mouth, so white), gold ring, ink rim. */
function Face() {
  return (
    <g transform={`translate(0 ${BODY_Y}) scale(${FACE_SCALE}) translate(-512 -512)`}>
      <circle cx={512} cy={512} r={FACE_RIM} fill="#fff" />
      {face.eyes.map((eye, i) => (
        <path key={i} d={eye.d} fill={INK} />
      ))}
      <path d={face.mouth} fill={INK} fillRule="evenodd" />
      <circle cx={512} cy={512} r={FACE_RING} fill="none" stroke={GOLD} strokeWidth={74} />
      <circle cx={512} cy={512} r={FACE_RIM} fill="none" stroke={INK} strokeWidth={36} />
    </g>
  );
}

export function GuideGyupa({ pose, dir, walking, aim, height }: { pose: GuidePose; dir: 1 | -1; walking: boolean; aim: number | null; height: number }) {
  const hands = handsFor(walking ? "idle" : pose, dir, aim);
  const width = (height * VIEW.w) / VIEW.h;
  return (
    <svg
      className={`guide-gyupa${walking ? " walking" : ""} pose-${walking ? "walk" : pose}`}
      width={width}
      height={height}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      aria-hidden="true"
    >
      <ellipse className="gg-shadow" cx={0} cy={-1} rx={R * 0.85} ry={R * 0.2} fill="rgba(0,0,0,0.28)" />
      <g className="gg-feet">
        {[-1, 1].map((side) => (
          <ellipse key={side} className={`gg-foot ${side < 0 ? "left" : "right"}`} cx={side * R * 0.36} cy={-R * 0.1} rx={R * 0.24} ry={R * 0.15} fill={SKIN} stroke={INK} strokeWidth={2.4} />
        ))}
      </g>
      <g className="gg-body">
        {!hands.penInFront && <HandDot at={hands.back} pen={hands.pen} />}
        {hands.penInFront && <HandDot at={hands.back} />}
        <Face />
        <Crown dir={dir} />
        {hands.penInFront ? <HandDot at={hands.front} pen={hands.pen} /> : <HandDot at={hands.front} />}
      </g>
    </svg>
  );
}

/** Just the face sticker, for the button that calls the guide. */
export function GyupaFaceIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`${-R - 2} ${BODY_Y - R - 2} ${2 * R + 4} ${2 * R + 4}`} aria-hidden="true">
      <Face />
    </svg>
  );
}
