import type { FaceAtlas } from "./atlas";

/**
 * ✏️ Guide lines (11-05, the owner: "3d모델에 반투명한 가상선 긋기 기능을 넣어줘. 그럼 그게 색지도에 가상 선으로
 * 띄워져있고 그걸 보고 색지도에서 채색하면 꺾인 면이나 튀어나온 곳을 처리할때 편할 것 같아"): lines drawn on the
 * model's surface that touch no colour — shown over the 3D views and, at the same places, over the colour map, as a
 * guide where the map is hard to read (a fold, a bump).
 *
 * A point is kept as a face and where on it (barycentric weights), not as a position: the same point is then on the
 * model in every view and on any map — the whole map, or a patch unfolded on its own.
 */
export interface GuidePoint {
  face: number;
  bary: [number, number, number];
}

/** One drag: the runs it left on the surface (a run ends where the pointer left the model or jumped across a gap). */
export interface GuideStroke {
  runs: GuidePoint[][];
}

/**
 * A step this many times longer than the steps just before it is a jump, not a line: from the ribbon's edge onto the
 * arm behind it, say, where the pointer passed over a silhouette.  The pointer's points come a few screen pixels
 * apart, so steps along the surface stay alike (they grow only slowly as the surface turns away).
 */
const JUMP_RATIO = 6;
/** Steps the typical step is taken from (the latest ones). */
const STEPS_KEPT = 8;
/** Steps needed before a jump can be told (the first ones are taken as they come). */
const STEPS_TO_JUDGE = 3;

/** Builds one stroke from the points under the pointer, as it is dragged. */
export class GuideBuilder {
  readonly stroke: GuideStroke = { runs: [] };
  private run: GuidePoint[] | null = null;
  private last: [number, number, number] | null = null;
  private steps: number[] = [];

  /** The next point under the pointer (`point` in any space of the model's own scale), or null off the model. */
  add(hit: { faceIndex: number; point: [number, number, number]; bary?: [number, number, number] } | null): void {
    if (!hit || !hit.bary) {
      this.run = null;
      this.last = null;
      this.steps = [];
      return;
    }
    const p = hit.point;
    if (this.run && this.last) {
      const d = Math.hypot(p[0] - this.last[0], p[1] - this.last[1], p[2] - this.last[2]);
      if (d === 0) return;
      let typical = 0;
      for (const s of this.steps) typical += s;
      typical = this.steps.length > 0 ? typical / this.steps.length : 0;
      if (this.steps.length >= STEPS_TO_JUDGE && d > JUMP_RATIO * typical) {
        this.run = null;
        this.steps = [];
      } else {
        this.steps.push(d);
        if (this.steps.length > STEPS_KEPT) this.steps.shift();
      }
    }
    if (!this.run) {
      this.run = [];
      this.stroke.runs.push(this.run);
    }
    this.run.push({ face: hit.faceIndex, bary: [hit.bary[0], hit.bary[1], hit.bary[2]] });
    this.last = [p[0], p[1], p[2]];
  }

  /** Points drawn: a stroke of one point (a click) is no line. */
  get lineCount(): number {
    let n = 0;
    for (const run of this.stroke.runs) if (run.length >= 2) n++;
    return n;
  }
}

/** The runs of a stroke that are lines (two points or more). */
export function strokeLines(stroke: GuideStroke): GuidePoint[][] {
  return stroke.runs.filter((run) => run.length >= 2);
}

/**
 * The guide lines on a map, in atlas pixels: x, y pairs, one array per unbroken piece.  A line is broken where it
 * leaves what the map shows (a face not on it) and where it passes from one chart (island) to another — the two
 * sides of a seam lie apart on the map, and a straight stroke between them would cross whatever lies between.
 */
export function guidesOnMap(strokes: readonly GuideStroke[], atlas: FaceAtlas): Float32Array[] {
  const out: Float32Array[] = [];
  const chartOf = atlas.chartOf;
  const uv = atlas.faceUv;
  let piece: number[] = [];
  const flush = () => {
    if (piece.length >= 4) out.push(Float32Array.from(piece));
    piece = [];
  };
  for (const stroke of strokes) {
    for (const run of stroke.runs) {
      let chart = -1;
      for (const { face, bary } of run) {
        const c = face >= 0 && face < chartOf.length ? chartOf[face] : -1;
        if (c < 0) {
          flush();
          chart = -1;
          continue;
        }
        if (c !== chart) {
          flush();
          chart = c;
        }
        const o = face * 6;
        piece.push(uv[o] * bary[0] + uv[o + 2] * bary[1] + uv[o + 4] * bary[2], uv[o + 1] * bary[0] + uv[o + 3] * bary[1] + uv[o + 5] * bary[2]);
      }
      flush();
    }
  }
  return out;
}

/**
 * The guide lines on the model, as line segments (two points each, x y z), lifted off the surface by `lift` along
 * each face's normal so the surface does not cover them.  `positions` = 9 numbers a face (its three corners).
 */
export function guideSegments(strokes: readonly GuideStroke[], positions: Float32Array, lift: number): Float32Array {
  const faceCount = Math.floor(positions.length / 9);
  let count = 0;
  for (const stroke of strokes) for (const run of stroke.runs) if (run.length >= 2) count += run.length - 1;
  const out = new Float32Array(count * 6);
  let k = 0;
  const at = (point: GuidePoint, into: number) => {
    const o = point.face * 9;
    const [u, v, w] = point.bary;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    out[into] = ax * u + bx * v + cx * w + nx * lift;
    out[into + 1] = ay * u + by * v + cy * w + ny * lift;
    out[into + 2] = az * u + bz * v + cz * w + nz * lift;
  };
  for (const stroke of strokes) {
    for (const run of stroke.runs) {
      if (run.length < 2) continue;
      for (let i = 1; i < run.length; i++) {
        if (run[i - 1].face >= faceCount || run[i].face >= faceCount) {
          k += 6;
          continue;
        }
        at(run[i - 1], k);
        at(run[i], k + 3);
        k += 6;
      }
    }
  }
  return out;
}

/**
 * Guide lines as kept (11-05, the owner: "저장되게 해줘"): in user-data by the model's name (`guide-lines`, beside the
 * part maps) and in the work file — per run its faces and two weights a point (the third is what is left), to four
 * places.  `faceCount` = the model's faces when they were drawn: another face count (another file of the same name,
 * the faces cut anew) and they are not taken back.
 */
export interface StoredGuides {
  faceCount: number;
  strokes: Array<Array<{ faces: number[]; bary: number[] }>>;
}

export function packGuides(strokes: readonly GuideStroke[], faceCount: number): StoredGuides {
  return {
    faceCount,
    strokes: strokes
      .map((stroke) =>
        strokeLines(stroke).map((run) => ({
          faces: run.map((point) => point.face),
          bary: run.flatMap((point) => [Math.round(point.bary[0] * 1e4) / 1e4, Math.round(point.bary[1] * 1e4) / 1e4]),
        })),
      )
      .filter((runs) => runs.length > 0),
  };
}

/** The strokes kept for a model of `faceCount` faces; null when there are none for it (or what is kept is not guide lines). */
export function unpackGuides(stored: unknown, faceCount: number): GuideStroke[] | null {
  if (!stored || typeof stored !== "object") return null;
  const { faceCount: kept, strokes } = stored as Partial<StoredGuides>;
  if (kept !== faceCount || !Array.isArray(strokes)) return null;
  const out: GuideStroke[] = [];
  for (const runs of strokes) {
    if (!Array.isArray(runs)) continue;
    const stroke: GuideStroke = { runs: [] };
    for (const run of runs) {
      const faces = run?.faces;
      const bary = run?.bary;
      if (!Array.isArray(faces) || !Array.isArray(bary) || bary.length !== faces.length * 2 || faces.length < 2) continue;
      const points: GuidePoint[] = [];
      for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        const u = Number(bary[i * 2]);
        const v = Number(bary[i * 2 + 1]);
        if (!Number.isInteger(face) || face < 0 || face >= faceCount || !Number.isFinite(u) || !Number.isFinite(v)) continue;
        points.push({ face, bary: [u, v, Math.max(0, 1 - u - v)] });
      }
      if (points.length >= 2) stroke.runs.push(points);
    }
    if (stroke.runs.length > 0) out.push(stroke);
  }
  return out.length > 0 ? out : null;
}
