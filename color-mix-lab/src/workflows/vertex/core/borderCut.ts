import type { FaceAdjacency } from "./meshAdjacency";
import { faceNormalAt, flatCorners, flatPositions, THIN_WALL, traceBorderLine, type BorderLineOptions, type MeshFaces, type MeshPoints } from "./borderLines";
import type { Tri, Vec3 } from "./types";

/**
 * Border cut: the faces along a colour border cut along the line drawn
 * through it (see borderLines), so the border runs where the line runs instead
 * of along whole triangles.
 *
 * Every vertex near a border is measured against the line: how far it lies
 * from the nearest stretch, and on which side — told in the vertex's own
 * surface (its normal), so where the border runs along a fold (a part standing
 * on another) the points on either side of the fold are told apart as well.
 * An edge whose two ends lie on
 * opposite sides of the same border gets a new point where the line crosses it
 * (a point very near the line counts as on it, so no sliver is cut off).  Each
 * face with such points is cut through them; each piece takes the group of its
 * side.  A face beside the border whose corners all lie on one side takes that
 * side's group whole.  Because a cut point depends only on its edge, the two
 * faces sharing an edge cut it at the same point: the result has no cracks.
 *
 * Faces are left as they are (only cut through where a neighbour's cut points
 * lie on their edges, keeping their group) where the corners are measured
 * against different borders (where three groups meet), where a corner is out
 * of reach of the line, in a third colour, and in protected groups.  A vertex
 * inside a part goes across the line only where the line swept over it (between
 * the border and the line); and pieces that went to a group must join what was
 * that group already — a run of them on its own (a crumb) goes back.
 *
 * The mesh passed in is untouched: the result lists the faces replaced and the
 * pieces replacing them, over the original vertices and the added ones.
 */
export interface BorderCut {
  /** Positions of the added vertices (x, y, z each); vertex `vertexCount + k` is the k-th. */
  addedVertices: Float64Array;
  /** The pieces: three vertex indices each (original or added). */
  pieces: Int32Array;
  /** The group of each piece. */
  pieceGroups: Int32Array;
  /** The original face each piece comes from. */
  pieceFaces: Int32Array;
  /** The original faces the pieces replace, ascending. */
  replaced: Int32Array;
}

const EMPTY: BorderCut = {
  addedVertices: new Float64Array(0),
  pieces: new Int32Array(0),
  pieceGroups: new Int32Array(0),
  pieceFaces: new Int32Array(0),
  replaced: new Int32Array(0),
};

/** Nearer the line than this (in edge lengths), a vertex counts as on it: no sliver is cut off beside it. */
const SNAP = 0.12;

/**
 * A vertex inside a part goes across the line only within this many edge lengths
 * of where the line swept (between the border and the line, as far as the line moved).
 */
const SWEPT = 0.5;

export function cutAlongBorderLines(
  adjacency: FaceAdjacency,
  triangles: MeshFaces,
  vertices: MeshPoints,
  groups: ArrayLike<number>,
  options: BorderLineOptions,
): BorderCut {
  const corners = flatCorners(triangles);
  const positions = flatPositions(vertices);
  const own = Int32Array.from(groups);
  // A settled stretch the last cut left rough (teeth) is cut afresh: the preview shows it smooth.
  const trace = traceBorderLine(adjacency, corners, positions, own, { ...options, reopenRough: true });
  if (!trace) return EMPTY;
  const { offsets, neighbours, faceCount } = adjacency;
  const vertexCount = positions.length / 3;
  const isProtected = (group: number) => options.protectedGroup[group] === 1;
  const { edgeLength, maxMove, eu, ev, eLeft, eRight, eFace, eAcross, slotA, slotB, line, along, stays, opened, borderFace } = trace;
  const edgeCount = eLeft.length;
  // Settled borders (a border already when the mesh was last cut) are the line
  // already: the line stays on them and no cut starts from them — except a stretch
  // still rough (teeth the last cut left, `opened`).  A vertex beside one is measured
  // against the border as it is: on its own side (or on it, SNAP) nothing changes;
  // only a face across it, a notch beside a smooth stretch, is cut.  Held back as a
  // clash instead, such a notch stayed for good.
  const settled = options.settled;
  const edgeSettled = (e: number) => !!settled && settled[eFace[e]] !== settled[eAcross[e]] && !opened[slotA[e]] && !opened[slotB[e]];

  // The stretches of line, with the normals of the two faces of the border edge each came from, in a grid of cells.
  const nx = new Float64Array(edgeCount * 3);
  const na = new Float64Array(edgeCount * 3);
  for (let e = 0; e < edgeCount; e++) {
    nx.set(faceNormalAt(corners, positions, eFace[e]), e * 3);
    na.set(faceNormalAt(corners, positions, eAcross[e]), e * 3);
  }
  // The way the line runs at each of its points where it stays on the border: the
  // stretches there taken together (at the corner of a tooth they point every way)
  // — for a vertex nearest to that point itself, where one stretch alone could put
  // it on the wrong side of the corner.  Where the line moved, the window's way (`along`).
  const pointCount = line.length / 3;
  const pointWay = new Float64Array(pointCount * 3);
  for (let e = 0; e < edgeCount; e++) {
    const a = slotA[e] * 3;
    const b = slotB[e] * 3;
    const sx = line[b] - line[a], sy = line[b + 1] - line[a + 1], sz = line[b + 2] - line[a + 2];
    const l = Math.hypot(sx, sy, sz);
    if (l === 0) continue;
    for (const p of [a, b]) {
      pointWay[p] += sx / l;
      pointWay[p + 1] += sy / l;
      pointWay[p + 2] += sz / l;
    }
  }
  // Each vertex's normal (its faces', by area): the surface it is measured in.
  const vertexNormal = new Float32Array(vertexCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const a = corners[f * 3] * 3, b = corners[f * 3 + 1] * 3, c = corners[f * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      vertexNormal[v] += x;
      vertexNormal[v + 1] += y;
      vertexNormal[v + 2] += z;
    }
  }
  // Each vertex's group: that of all its faces, or MIXED on a border.
  const MIXED = -1;
  const homeOf = new Int32Array(vertexCount).fill(-2);
  for (let f = 0; f < faceCount; f++)
    for (let k = 0; k < 3; k++) {
      const v = corners[f * 3 + k];
      homeOf[v] = homeOf[v] === -2 || homeOf[v] === own[f] ? own[f] : MIXED;
    }
  // How far each stretch of line lies off its border edge (its further end).
  const moved = new Float64Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    const a = slotA[e] * 3, b = slotB[e] * 3, u = eu[e] * 3, w = ev[e] * 3;
    moved[e] = Math.max(
      Math.hypot(line[a] - positions[u], line[a + 1] - positions[u + 1], line[a + 2] - positions[u + 2]),
      Math.hypot(line[b] - positions[w], line[b + 1] - positions[w + 1], line[b + 2] - positions[w + 2]),
    );
  }
  const reach = maxMove + edgeLength;
  const cell = Math.max(1e-9, reach);
  const keyOf = (ix: number, iy: number, iz: number) => (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
  const grid = new Map<number, number[]>();
  const tiny = 1e-6 * edgeLength;
  for (let e = 0; e < edgeCount; e++) {
    const a = slotA[e] * 3;
    const b = slotB[e] * 3;
    if (Math.hypot(line[b] - line[a], line[b + 1] - line[a + 1], line[b + 2] - line[a + 2]) < tiny) continue;
    const lo = [0, 1, 2].map((c) => Math.floor(Math.min(line[a + c], line[b + c]) / cell));
    const hi = [0, 1, 2].map((c) => Math.floor(Math.max(line[a + c], line[b + c]) / cell));
    for (let ix = lo[0]; ix <= hi[0]; ix++)
      for (let iy = lo[1]; iy <= hi[1]; iy++)
        for (let iz = lo[2]; iz <= hi[2]; iz++) {
          const key = keyOf(ix, iy, iz);
          const list = grid.get(key);
          if (list) list.push(e);
          else grid.set(key, [e]);
        }
  }

  // Each vertex near a border, measured the first time a face asks: its distance
  // across the nearest border (positive on the lower group's side) and that
  // border's pair of groups.  Out of reach = NONE; borders as near that disagree,
  // or a protected one = CLASH (measured, but left alone).
  const NONE = -1;
  const CLASH = -2;
  const pairOf = new Map<number, number>();
  const distanceOf = new Map<number, number>();
  const tie = 0.05 * edgeLength;
  /** How far the point lies from stretch e. */
  const distanceTo = (e: number, px: number, py: number, pz: number) => {
    const A = slotA[e] * 3;
    const B = slotB[e] * 3;
    const sx = line[B] - line[A], sy = line[B + 1] - line[A + 1], sz = line[B + 2] - line[A + 2];
    const len2 = sx * sx + sy * sy + sz * sz;
    const tt = len2 > 0 ? Math.max(0, Math.min(1, ((px - line[A]) * sx + (py - line[A + 1]) * sy + (pz - line[A + 2]) * sz) / len2)) : 0;
    return Math.hypot(px - line[A] - sx * tt, py - line[A + 1] - sy * tt, pz - line[A + 2] - sz * tt);
  };
  const measure = (v: number, f0: number, f1: number, f2: number): number => {
    const known = pairOf.get(v);
    if (known !== undefined) return known;
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    let n0 = vertexNormal[v * 3], n1 = vertexNormal[v * 3 + 1], n2 = vertexNormal[v * 3 + 2];
    const nl = Math.hypot(n0, n1, n2);
    if (nl > 0) {
      n0 /= nl;
      n1 /= nl;
      n2 /= nl;
    }
    // On the rim of a thin part, or at the tip where a fan of thin faces meets, the faces
    // around a vertex face every way and their normals cancel out: there is no surface to
    // tell its side in (taken from the face that asks first, its fan grew spikes), and the
    // vertex is left alone.
    if (!(nl > 0) || n0 * f0 + n1 * f1 + n2 * f2 < 0.2) {
      pairOf.set(v, CLASH);
      return CLASH;
    }
    const ix = Math.floor(px / cell);
    const iy = Math.floor(py / cell);
    const iz = Math.floor(pz / cell);
    let best = Infinity;
    let bestSide = 0;
    let bestPair = NONE;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(keyOf(ix + dx, iy + dy, iz + dz));
          if (!list) continue;
          for (const e of list) {
            // A border on the other side of a thin wall: the point looks away from both its faces.
            if (nx[e * 3] * n0 + nx[e * 3 + 1] * n1 + nx[e * 3 + 2] * n2 < -THIN_WALL && na[e * 3] * n0 + na[e * 3 + 1] * n1 + na[e * 3 + 2] * n2 < -THIN_WALL) continue;
            const A = slotA[e];
            const B = slotB[e];
            const ax = line[A * 3], ay = line[A * 3 + 1], az = line[A * 3 + 2];
            const sx = line[B * 3] - ax, sy = line[B * 3 + 1] - ay, sz = line[B * 3 + 2] - az;
            const len2 = sx * sx + sy * sy + sz * sz;
            if (len2 < tiny * tiny) continue;
            let tt = ((px - ax) * sx + (py - ay) * sy + (pz - az) * sz) / len2;
            tt = Math.max(0, Math.min(1, tt));
            const qx = ax + sx * tt, qy = ay + sy * tt, qz = az + sz * tt;
            const d = Math.hypot(px - qx, py - qy, pz - qz);
            if (d > reach || d > best + tie) continue;
            // Which side: left of the way the line runs, in the vertex's own surface
            // (normal × way).  The way: where the line moved, the window's (which holds
            // along teeth); where it stayed on the border, the stretch's own — or, nearest
            // to an end of it, every stretch at that end taken together.
            let tx = 0, ty = 0, tz = 0;
            const wayAt = (point: number) => (stays[point] ? pointWay : along);
            if (tt <= 0 || tt >= 1) {
              const point = tt <= 0 ? A : B;
              const w = wayAt(point);
              tx = w[point * 3];
              ty = w[point * 3 + 1];
              tz = w[point * 3 + 2];
            } else if (!stays[A] && !stays[B]) {
              tx = along[A * 3] * (1 - tt) + along[B * 3] * tt;
              ty = along[A * 3 + 1] * (1 - tt) + along[B * 3 + 1] * tt;
              tz = along[A * 3 + 2] * (1 - tt) + along[B * 3 + 2] * tt;
            } else {
              tx = sx;
              ty = sy;
              tz = sz;
            }
            const wx = n1 * tz - n2 * ty, wy = n2 * tx - n0 * tz, wz = n0 * ty - n1 * tx;
            const wl = Math.hypot(wx, wy, wz);
            if (wl === 0) continue;
            const signed = Math.sign((px - qx) * wx + (py - qy) * wy + (pz - qz) * wz) * d;
            const pair = eLeft[e] * 65536 + eRight[e];
            if (d < best - tie) {
              best = d;
              bestSide = signed;
              bestPair = pair;
            } else {
              // As near as the best: they must agree, or the vertex is left alone — but a
              // vertex on the line (within SNAP of both) is a point of it whichever side the
              // stretches put it on by a hair, not a disagreement.  Held back as one, a
              // tooth with a corner on the line stayed whole across it.
              const onLine = Math.abs(signed) < SNAP * edgeLength && Math.abs(bestSide) < SNAP * edgeLength;
              if (pair !== bestPair || (!onLine && Math.sign(signed) !== Math.sign(bestSide))) bestPair = CLASH;
              if (d < best) {
                best = d;
                if (bestPair !== CLASH) bestSide = signed;
              }
            }
          }
        }
    // A vertex inside a part measured across the line from it: only where the line swept
    // over it — between the border and the line, as far as a stretch of this border moved
    // off it.  Further out (whole edges inside a part, off a line that hardly moved) the
    // side turns on the line's ends and corners: it took points across by chance, crumbs.
    if (bestPair >= 0 && Math.abs(bestSide) >= SNAP * edgeLength) {
      const lower = Math.floor(bestPair / 65536);
      const upper = bestPair % 65536;
      const home = homeOf[v];
      if ((home === lower || home === upper) && home !== (bestSide > 0 ? lower : upper)) {
        let swept = false;
        for (let dx = -1; dx <= 1 && !swept; dx++)
          for (let dy = -1; dy <= 1 && !swept; dy++)
            for (let dz = -1; dz <= 1 && !swept; dz++) {
              const list = grid.get(keyOf(ix + dx, iy + dy, iz + dz));
              if (!list) continue;
              for (const e of list) {
                if (eLeft[e] * 65536 + eRight[e] !== bestPair) continue;
                if (nx[e * 3] * n0 + nx[e * 3 + 1] * n1 + nx[e * 3 + 2] * n2 < -THIN_WALL && na[e * 3] * n0 + na[e * 3 + 1] * n1 + na[e * 3 + 2] * n2 < -THIN_WALL) continue;
                if (distanceTo(e, px, py, pz) <= moved[e] + SWEPT * edgeLength) {
                  swept = true;
                  break;
                }
              }
            }
        if (!swept) bestSide = -bestSide;
      }
    }
    if (bestPair >= 0 && (isProtected(Math.floor(bestPair / 65536)) || isProtected(bestPair % 65536))) bestPair = CLASH;
    pairOf.set(v, bestPair);
    if (bestPair >= 0) distanceOf.set(v, Math.abs(bestSide) < SNAP * edgeLength ? 0 : bestSide);
    return bestPair;
  };
  const fieldPair = (v: number) => pairOf.get(v) ?? NONE;
  const measureFace = (f: number): boolean => {
    const [n0, n1, n2] = faceNormalAt(corners, positions, f);
    let near = false;
    for (let k = 0; k < 3; k++) if (measure(corners[f * 3 + k], n0, n1, n2) !== NONE) near = true;
    return near;
  };

  // The faces to measure: out from the border faces while a corner lies within
  // reach of the line.  The first face beyond (none of its corners in reach) is
  // only cut through where a cut point lies on its edge.
  const BAND = 1;
  const BEYOND = 2;
  const kind = new Uint8Array(faceCount);
  const todo: number[] = [];
  // From the border faces — only those on a border that is not settled, when some are.
  const seed = settled ? new Uint8Array(faceCount) : borderFace;
  if (settled)
    for (let e = 0; e < edgeCount; e++)
      if (!edgeSettled(e)) {
        seed[eFace[e]] = 1;
        seed[eAcross[e]] = 1;
      }
  for (let f = 0; f < faceCount; f++)
    if (seed[f]) {
      kind[f] = BAND;
      measureFace(f);
      todo.push(f);
    }
  for (let head = 0; head < todo.length; head++) {
    const f = todo[head];
    if (kind[f] !== BAND) continue;
    for (let i = offsets[f]; i < offsets[f + 1]; i++) {
      const n = neighbours[i];
      if (kind[n]) continue;
      kind[n] = measureFace(n) ? BAND : BEYOND;
      todo.push(n);
    }
  }

  // Cut points: on an edge whose ends lie strictly on opposite sides of the same border.
  const added: number[] = [];
  const cutOn = new Map<number, number>(); // edge key → added vertex index
  const cutPoint = (u: number, v: number): number => {
    const pu = fieldPair(u);
    if (pu < 0 || pu !== fieldPair(v)) return -1;
    const du = distanceOf.get(u) as number;
    const dv = distanceOf.get(v) as number;
    if (!(du * dv < 0)) return -1;
    const key = u < v ? u * vertexCount + v : v * vertexCount + u;
    const known = cutOn.get(key);
    if (known !== undefined) return known;
    const t = du / (du - dv);
    const index = vertexCount + added.length / 3;
    for (let c = 0; c < 3; c++) added.push(positions[u * 3 + c] + (positions[v * 3 + c] - positions[u * 3 + c]) * t);
    cutOn.set(key, index);
    return index;
  };
  /** Every face across the side u–v of f (more than one where a fin or a doubled face shares it). */
  const acrossSide = (f: number, u: number, v: number, take: (n: number) => void) => {
    for (let i = offsets[f]; i < offsets[f + 1]; i++) {
      const n = neighbours[i];
      const s0 = corners[n * 3], s1 = corners[n * 3 + 1], s2 = corners[n * 3 + 2];
      if ((s0 === u || s1 === u || s2 === u) && (s0 === v || s1 === v || s2 === v)) take(n);
    }
  };

  const pieces: number[] = [];
  const pieceGroups: number[] = [];
  const pieceFaces: number[] = [];
  const replaced: number[] = [];
  const ringPoints: number[] = [];
  const ringSign: number[] = [];
  const t = [0, 0, 0];
  for (let head = 0; head < todo.length; head++) {
    const f = todo[head];
    const group = own[f];
    t[0] = corners[f * 3];
    t[1] = corners[f * 3 + 1];
    t[2] = corners[f * 3 + 2];
    // The face's outline: its corners with the cut points between them.  A face
    // beside a cut side is cut through it too (whatever it is), so no crack opens.
    ringPoints.length = 0;
    ringSign.length = 0;
    let cuts = 0;
    for (let k = 0; k < 3; k++) {
      const u = t[k];
      const v = t[(k + 1) % 3];
      ringPoints.push(u);
      ringSign.push(fieldPair(u) >= 0 ? Math.sign(distanceOf.get(u) as number) : NaN);
      const c = cutPoint(u, v);
      if (c >= 0) {
        ringPoints.push(c);
        ringSign.push(0);
        cuts++;
        acrossSide(f, u, v, (n) => {
          if (kind[n]) return;
          kind[n] = BEYOND;
          todo.push(n);
        });
      }
    }
    // Measured whole: all three corners against one border, the face in one of its groups.
    const pair = fieldPair(t[0]);
    const measured =
      kind[f] === BAND &&
      pair >= 0 &&
      pair === fieldPair(t[1]) &&
      pair === fieldPair(t[2]) &&
      !isProtected(group) &&
      (group === Math.floor(pair / 65536) || group === pair % 65536);
    if (!measured) {
      if (cuts === 0) continue;
      // Cut through only where its neighbours' cut points lie, keeping its group:
      // a fan from the first cut point (never three points on one side).
      replaced.push(f);
      let start = 0;
      while (ringPoints[start] < vertexCount) start++;
      const n = ringPoints.length;
      for (let i = 1; i < n - 1; i++) {
        pieces.push(ringPoints[start], ringPoints[(start + i) % n], ringPoints[(start + i + 1) % n]);
        pieceGroups.push(group);
        pieceFaces.push(f);
      }
      continue;
    }
    const lower = Math.floor(pair / 65536);
    const upper = pair % 65536;
    const groupOfSign = (sign: number) => (sign > 0 ? lower : upper);
    let plus = false;
    let minus = false;
    for (let k = 0; k < 3; k++) {
      const sign = Math.sign(distanceOf.get(t[k]) as number);
      if (sign > 0) plus = true;
      else if (sign < 0) minus = true;
    }
    if (!plus && !minus) continue; // all on the line: nothing to tell
    if (!(plus && minus)) {
      const next = groupOfSign(plus ? 1 : -1);
      if (next === group) continue;
      replaced.push(f);
      pieces.push(t[0], t[1], t[2]);
      pieceGroups.push(next);
      pieceFaces.push(f);
      continue;
    }
    // The line runs between two points of the outline (cut points, or a corner on it):
    // the outline splits there into two parts, each a fan from the first.
    replaced.push(f);
    const n = ringPoints.length;
    const ends: number[] = [];
    for (let i = 0; i < n; i++) if (ringSign[i] === 0) ends.push(i);
    const [x, y] = ends; // a face crossed by the line has exactly two
    for (const [from, to] of [
      [x, y],
      [y, x],
    ]) {
      let side = 0;
      const count = (to - from + n) % n;
      for (let i = 1; i < count; i++) side = side || ringSign[(from + i) % n];
      for (let i = 1; i < count; i++) {
        pieces.push(ringPoints[from], ringPoints[(from + i) % n], ringPoints[(from + i + 1) % n]);
        pieceGroups.push(groupOfSign(side));
        pieceFaces.push(f);
      }
    }
  }

  // A piece (or a whole face) that went to the other group has to join that group:
  // where the faces beside it were left as they are (three groups meet, a protected
  // colour), it would stay a speck of its own — and pieces side by side, a crumb.  So
  // each run of changed pieces that reaches no piece or face that was that group
  // already goes back to its faces' groups.
  {
    const total = vertexCount + added.length / 3;
    const items = new Map<number, number[]>(); // side → pieces (p) and faces left whole (-(f + 1)) on it
    const groupOf = (item: number) => (item >= 0 ? pieceGroups[item] : own[-item - 1]);
    const side = (a: number, b: number) => (a < b ? a * total + b : b * total + a);
    const add = (a: number, b: number, item: number) => {
      const key = side(a, b);
      const list = items.get(key);
      if (list) list.push(item);
      else items.set(key, [item]);
    };
    for (let p = 0; p < pieceGroups.length; p++)
      for (let k = 0; k < 3; k++) add(pieces[p * 3 + k], pieces[p * 3 + ((k + 1) % 3)], p);
    const gone = new Uint8Array(faceCount);
    for (const f of replaced) gone[f] = 1;
    const beside = new Uint8Array(faceCount);
    for (const f of replaced)
      for (let i = offsets[f]; i < offsets[f + 1]; i++) {
        const n = neighbours[i];
        if (gone[n] || beside[n]) continue;
        beside[n] = 1;
        for (let k = 0; k < 3; k++) add(corners[n * 3 + k], corners[n * 3 + ((k + 1) % 3)], -(n + 1));
      }
    const changed = (item: number) => item >= 0 && pieceGroups[item] !== own[pieceFaces[item]];
    const run = new Int32Array(pieceGroups.length);
    const members: number[] = [];
    for (let round = 1; round <= 3; round++) {
      let back = 0;
      for (let p0 = 0; p0 < pieceGroups.length; p0++) {
        if (run[p0] === round || !changed(p0)) continue;
        const group = pieceGroups[p0];
        run[p0] = round;
        members.length = 0;
        members.push(p0);
        let joins = false;
        for (let i = 0; i < members.length; i++) {
          const p = members[i];
          for (let k = 0; k < 3; k++) {
            const list = items.get(side(pieces[p * 3 + k], pieces[p * 3 + ((k + 1) % 3)])) as number[];
            for (const other of list) {
              if (other === p || groupOf(other) !== group) continue;
              if (!changed(other)) joins = true;
              else if (run[other] !== round) {
                run[other] = round;
                members.push(other);
              }
            }
          }
        }
        if (joins) continue;
        for (const p of members) pieceGroups[p] = own[pieceFaces[p]];
        back += members.length;
      }
      if (back === 0) break;
    }
  }

  const order = replaced.map((_, i) => i);
  order.sort((a, b) => replaced[a] - replaced[b]);
  return {
    addedVertices: Float64Array.from(added),
    pieces: Int32Array.from(pieces),
    pieceGroups: Int32Array.from(pieceGroups),
    pieceFaces: Int32Array.from(pieceFaces),
    replaced: Int32Array.from(order.map((i) => replaced[i])),
  };
}

/**
 * The mesh with the cut made.  The vertices: the original ones (same order),
 * then the added ones.  The faces: every face keeps its number — a replaced
 * face's place takes its first piece — and the other pieces follow at the end.
 * So whatever refers to a face by its number still finds it (or its first
 * piece), and arrays per face carry over by copying.  `originalFace` gives the
 * face of the mesh passed in each one comes from; `piece` the piece it is (-1
 * for a face as it was).
 */
export function meshWithCut(
  vertices: ArrayLike<Vec3>,
  triangles: ArrayLike<Tri>,
  cut: BorderCut,
): { vertices: Vec3[]; triangles: Tri[]; originalFace: Int32Array; piece: Int32Array } {
  const outVertices: Vec3[] = Array.from(vertices);
  for (let k = 0; k < cut.addedVertices.length; k += 3)
    outVertices.push([cut.addedVertices[k], cut.addedVertices[k + 1], cut.addedVertices[k + 2]]);
  const faceCount = triangles.length;
  const firstPiece = new Int32Array(faceCount).fill(-1);
  for (let p = cut.pieceGroups.length - 1; p >= 0; p--) firstPiece[cut.pieceFaces[p]] = p;
  const count = faceCount + cut.pieceGroups.length - cut.replaced.length;
  const outTriangles: Tri[] = new Array(count);
  const originalFace = new Int32Array(count);
  const piece = new Int32Array(count).fill(-1);
  const pieceTri = (p: number): Tri => [cut.pieces[p * 3], cut.pieces[p * 3 + 1], cut.pieces[p * 3 + 2]];
  for (let f = 0; f < faceCount; f++) {
    const p = firstPiece[f];
    outTriangles[f] = p >= 0 ? pieceTri(p) : triangles[f];
    originalFace[f] = f;
    piece[f] = p;
  }
  let n = faceCount;
  for (let p = 0; p < cut.pieceGroups.length; p++) {
    if (firstPiece[cut.pieceFaces[p]] === p) continue;
    outTriangles[n] = pieceTri(p);
    originalFace[n] = cut.pieceFaces[p];
    piece[n++] = p;
  }
  return { vertices: outVertices, triangles: outTriangles, originalFace, piece };
}
