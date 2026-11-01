import type { FaceAdjacency } from "./meshAdjacency";
import type { Tri, Vec3 } from "./types";

/**
 * Border lines: the stairs and teeth along a colour border, redrawn as a
 * gentle line, and the faces near it coloured by the side of that line their
 * centre is on.
 *
 * 1. The border edges: sides between faces of two groups, each taken once and
 *    pointed so the lower group is on its left.
 * 2. The line.  For each border point, the border points within half a window
 *    of it along borders of the same two groups — both ways along a line, and
 *    where teeth touch at a corner into both lines there — give an average.
 *    Moving every point to its average would also pull every bend inwards
 *    (a round part would shrink, a little more each time it is run), so a
 *    point moves only across the border, by how far its own pull across it
 *    differs from the pull across it around it: what is jagged straightens,
 *    what bends evenly stays where it is.  A border shorter than two windows
 *    all round (a small island) stays too — it cannot tell the two apart.
 *    A point stays put where the border turns back on itself within the
 *    window (the end of a thin strip, a small island, a run of corners) — the
 *    edges walked there point every which way — and where three groups meet,
 *    where a border ends and along a protected group's border.  No point moves
 *    further than a quarter window.
 * 3. The faces: near the border (no further than a point can move), each
 *    face's centre is measured against the nearest stretch of line; the side
 *    it is on — told in the face's own surface, so where the border runs along
 *    a fold (a part standing on another) a face on either side of the fold is
 *    told apart as well — gives its group (only between the two groups of that
 *    stretch — a third colour is left alone; a face as near to stretches that disagree is
 *    left too).  The changes are made nearest the border first and only where
 *    the new group already touches the face, so they grow from the border and
 *    never leave a strip of their own inside a part.  A tooth whose centre lies
 *    beyond the line goes; a notch fills.
 *
 * The mesh itself is untouched: only which group each face is in.
 */
export interface BorderLineOptions {
  /** The window, in border edges: stairs and bends shorter than this straighten; 0 = off. */
  span: number;
  /** 1 for groups whose borders stay as they are. */
  protectedGroup: Uint8Array;
  /**
   * Each face's group (any number standing for it) when the mesh was last cut
   * along the lines (borderCut, confirmed).  A side that was a border then was
   * cut along the line then: it is the line already, and stays — whatever the
   * colours on either side have become since.  Omitted: every border is drawn afresh.
   */
  settled?: ArrayLike<number>;
}

/** Below this, the edges walked around a point (their directions summed, over their length) turn back on themselves. */
const FOLD = 0.35;

/**
 * A border is behind a thin wall from a face (or point) whose normal points away
 * from both faces of the border edge by more than this (as a cosine): the other
 * side of a thin part, not the same surface.  Along a fold the faces stand at an
 * angle, but one of them faces the same way.
 */
export const THIN_WALL = 0.3;

/** The line drawn along the borders (steps 1 and 2), for the faces to be measured against. */
export interface BorderLineTrace {
  /** Mean length of a border edge. */
  edgeLength: number;
  /** How far a point of the line may lie from the border it was drawn from. */
  maxMove: number;
  /** The border edges: from vertex eu to ev, the lower group (eLeft) on the left, from face eFace. */
  eu: number[];
  ev: number[];
  eLeft: number[];
  eRight: number[];
  eFace: number[];
  /** The face on the other side of each border edge. */
  eAcross: number[];
  /** The border point at each end of an edge (an index into the per-point arrays). */
  slotA: Int32Array;
  slotB: Int32Array;
  /** Per border point (x, y, z each): where the line passes it, and across the border towards the lower group. */
  line: Float64Array;
  across: Float64Array;
  /** Per border point (x, y, z each): the way the border runs over the window, lower group on the left (not set where the line stays). */
  along: Float64Array;
  /** 1 where the line stays on the border itself (and `across` is not set). */
  stays: Uint8Array;
  /** 1 for faces with a side on a border. */
  borderFace: Uint8Array;
}

export function traceBorderLine(
  adjacency: FaceAdjacency,
  triangles: MeshFaces,
  vertices: MeshPoints,
  groups: Int32Array,
  options: BorderLineOptions,
): BorderLineTrace | null {
  const span = Math.max(0, options.span);
  if (span === 0) return null;
  const { offsets, neighbours, faceCount } = adjacency;
  const corners = flatCorners(triangles);
  const positions = flatPositions(vertices);
  const isProtected = (group: number) => options.protectedGroup[group] === 1;

  // 1) Border edges.
  const eu: number[] = [];
  const ev: number[] = [];
  const eLeft: number[] = [];
  const eRight: number[] = [];
  const eFace: number[] = [];
  const eAcross: number[] = [];
  const borderFace = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const own = groups[f];
    let foreign = false;
    for (let i = offsets[f]; i < offsets[f + 1] && !foreign; i++) foreign = groups[neighbours[i]] !== own;
    if (!foreign) continue;
    for (let k = 0; k < 3; k++) {
      const u = corners[f * 3 + k];
      const v = corners[f * 3 + ((k + 1) % 3)];
      let across = -1;
      for (let i = offsets[f]; i < offsets[f + 1]; i++) {
        const n = neighbours[i];
        const s0 = corners[n * 3], s1 = corners[n * 3 + 1], s2 = corners[n * 3 + 2];
        if ((s0 === u || s1 === u || s2 === u) && (s0 === v || s1 === v || s2 === v)) {
          across = n;
          break;
        }
      }
      if (across < 0 || groups[across] === own) continue;
      borderFace[f] = 1;
      borderFace[across] = 1;
      if (across < f) continue; // taken from the other face
      // Pointed so the lower group is on the left (the face's own winding has it on the left).
      if (own < groups[across]) {
        eu.push(u);
        ev.push(v);
        eLeft.push(own);
        eRight.push(groups[across]);
      } else {
        eu.push(v);
        ev.push(u);
        eLeft.push(groups[across]);
        eRight.push(own);
      }
      eFace.push(f);
      eAcross.push(across);
    }
  }
  const edgeCount = eu.length;
  if (edgeCount === 0) return null;

  // The border points, numbered, and the edges at each (in flat arrays: this runs on millions of faces).
  const slot = new Map<number, number>();
  const at: number[] = [];
  const slotOf = (v: number) => {
    let s = slot.get(v);
    if (s === undefined) {
      s = at.length;
      slot.set(v, s);
      at.push(v);
    }
    return s;
  };
  const slotA = new Int32Array(edgeCount);
  const slotB = new Int32Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    slotA[e] = slotOf(eu[e]);
    slotB[e] = slotOf(ev[e]);
  }
  const count = at.length;
  const edgeStart = new Int32Array(count + 1);
  for (let e = 0; e < edgeCount; e++) {
    edgeStart[slotA[e] + 1]++;
    edgeStart[slotB[e] + 1]++;
  }
  for (let s = 0; s < count; s++) edgeStart[s + 1] += edgeStart[s];
  const edgeList = new Int32Array(edgeStart[count]);
  const fill = edgeStart.slice(0, count);
  for (let e = 0; e < edgeCount; e++) {
    edgeList[fill[slotA[e]]++] = e;
    edgeList[fill[slotB[e]]++] = e;
  }
  const pair = new Int32Array(edgeCount);
  const lengthOf = new Float64Array(edgeCount);
  let edgeLength = 0;
  for (let e = 0; e < edgeCount; e++) {
    pair[e] = eLeft[e] * 65536 + eRight[e];
    const p = eu[e] * 3;
    const q = ev[e] * 3;
    lengthOf[e] = Math.hypot(positions[q] - positions[p], positions[q + 1] - positions[p + 1], positions[q + 2] - positions[p + 2]);
    edgeLength += lengthOf[e];
  }
  edgeLength /= edgeCount;
  const half = (span * edgeLength) / 2;
  const maxMove = Math.max(2, span / 4) * edgeLength;

  // Settled: every border edge at the point was a border already when the mesh was last cut.
  const settled = options.settled;
  const settledAt = (s: number) => {
    if (!settled) return false;
    for (let k = edgeStart[s]; k < edgeStart[s + 1]; k++) {
      const e = edgeList[k];
      if (settled[eFace[e]] === settled[eAcross[e]]) return false;
    }
    return true;
  };
  // A point moves when its border edges are all of one unprotected pair and as many come in as go out
  // (and they are not settled).
  const moves = new Uint8Array(count);
  for (let s = 0; s < count; s++) {
    let balance = 0;
    const p0 = pair[edgeList[edgeStart[s]]];
    let one = true;
    for (let k = edgeStart[s]; k < edgeStart[s + 1]; k++) {
      const e = edgeList[k];
      balance += slotA[e] === s ? 1 : -1;
      if (pair[e] !== p0) one = false;
    }
    if (balance === 0 && one && !isProtected(Math.floor(p0 / 65536)) && !isProtected(p0 % 65536) && !settledAt(s)) moves[s] = 1;
  }
  const pos = new Float64Array(count * 3);
  for (let s = 0; s < count; s++) for (let c = 0; c < 3; c++) pos[s * 3 + c] = positions[at[s] * 3 + c];
  // A border shorter than two windows all round (a small island, a short stretch between
  // corners where three groups meet) cannot tell an even bend from a jagged one: it stays,
  // left to the teeth trim and the island cleanup.
  {
    const seen = new Uint8Array(count);
    const stack: number[] = [];
    const members: number[] = [];
    for (let s0 = 0; s0 < count; s0++) {
      if (!moves[s0] || seen[s0]) continue;
      const p0 = pair[edgeList[edgeStart[s0]]];
      seen[s0] = 1;
      stack.push(s0);
      members.length = 0;
      let length = 0;
      while (stack.length > 0) {
        const a = stack.pop() as number;
        members.push(a);
        for (let i = edgeStart[a]; i < edgeStart[a + 1]; i++) {
          const e = edgeList[i];
          if (pair[e] !== p0) continue;
          if (slotA[e] === a) length += lengthOf[e]; // each edge once, from its start
          const b = slotA[e] === a ? slotB[e] : slotA[e];
          if (!moves[b] || seen[b]) continue;
          seen[b] = 1;
          stack.push(b);
        }
      }
      if (length < 2 * span * edgeLength) for (const a of members) moves[a] = 0;
    }
  }

  // 2) The walk around a point: the border points of its pair within half a window
  // (not through a point that stays), and how much the edges walked point one way.
  const walkCap = 10 * Math.ceil(span) + 8;
  const dist = new Float64Array(count).fill(Infinity);
  const edgeSeen = new Int32Array(edgeCount);
  let walkStamp = 0;
  const reached: number[] = [];
  let straightness = 0;
  const heading = [0, 0, 0]; // the edges walked, their directions summed
  const walk = (s: number) => {
    reached.length = 0;
    walkStamp++;
    const p0 = pair[edgeList[edgeStart[s]]];
    dist[s] = 0;
    reached.push(s);
    let vx = 0, vy = 0, vz = 0, walked = 0;
    for (let k = 0; k < reached.length && reached.length < walkCap; k++) {
      const a = reached[k];
      if (dist[a] >= half || !moves[a]) continue;
      for (let i = edgeStart[a]; i < edgeStart[a + 1]; i++) {
        const e = edgeList[i];
        if (pair[e] !== p0) continue;
        if (edgeSeen[e] !== walkStamp) {
          edgeSeen[e] = walkStamp;
          const p = eu[e] * 3;
          const q = ev[e] * 3;
          vx += positions[q] - positions[p];
          vy += positions[q + 1] - positions[p + 1];
          vz += positions[q + 2] - positions[p + 2];
          walked += lengthOf[e];
        }
        const b = slotA[e] === a ? slotB[e] : slotA[e];
        if (dist[b] !== Infinity) continue;
        // Measured straight from s, not along the border: teeth make the border
        // twice as long as the line through them, and the window would shrink with them.
        const d = Math.hypot(pos[b * 3] - pos[s * 3], pos[b * 3 + 1] - pos[s * 3 + 1], pos[b * 3 + 2] - pos[s * 3 + 2]);
        if (d > half) continue;
        reached.push(b);
        dist[b] = d;
      }
    }
    straightness = walked > 0 ? Math.hypot(vx, vy, vz) / walked : 0;
    heading[0] = vx;
    heading[1] = vy;
    heading[2] = vz;
  };
  const clearWalk = () => {
    for (const b of reached) dist[b] = Infinity;
  };
  // The surface normal at each point: of the faces its edges came from.
  const normalAt = new Float64Array(count * 3);
  for (let s = 0; s < count; s++) {
    for (let k = edgeStart[s]; k < edgeStart[s + 1]; k++) {
      const n = faceNormalAt(corners, positions, eFace[edgeList[k]]);
      normalAt[s * 3] += n[0];
      normalAt[s * 3 + 1] += n[1];
      normalAt[s * 3 + 2] += n[2];
    }
  }
  // Across the border at each point, in the surface, towards the lower group: the
  // normal × the way the border runs over the whole window (not just the edges at the
  // point — at the corner of a tooth those point every way).
  const across = new Float64Array(count * 3);
  const along = new Float64Array(count * 3);
  // One walk per point: whether it stays (it does not move, or the border turns back on
  // itself within the window), which way is across, and its pull across the border —
  // how far the average of the points around it lies to one side.
  const stays = new Uint8Array(count);
  const pull = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    if (!moves[s]) {
      stays[s] = 1;
      continue;
    }
    walk(s);
    const n0 = normalAt[s * 3], n1 = normalAt[s * 3 + 1], n2 = normalAt[s * 3 + 2];
    const cx = n1 * heading[2] - n2 * heading[1];
    const cy = n2 * heading[0] - n0 * heading[2];
    const cz = n0 * heading[1] - n1 * heading[0];
    const length = Math.hypot(cx, cy, cz);
    if (straightness < FOLD || reached.length < 3 || length === 0) {
      stays[s] = 1;
      clearWalk();
      continue;
    }
    across[s * 3] = cx / length;
    across[s * 3 + 1] = cy / length;
    across[s * 3 + 2] = cz / length;
    const way = Math.hypot(heading[0], heading[1], heading[2]);
    along[s * 3] = heading[0] / way;
    along[s * 3 + 1] = heading[1] / way;
    along[s * 3 + 2] = heading[2] / way;
    let sx = 0, sy = 0, sz = 0;
    for (const b of reached) {
      sx += pos[b * 3];
      sy += pos[b * 3 + 1];
      sz += pos[b * 3 + 2];
    }
    const n = reached.length;
    pull[s] = (sx / n - pos[s * 3]) * across[s * 3] + (sy / n - pos[s * 3 + 1]) * across[s * 3 + 1] + (sz / n - pos[s * 3 + 2]) * across[s * 3 + 2];
    clearWalk();
  }
  // Each point moves across the border by how far its pull differs from the pull around
  // it — along an even bend every point is pulled alike, so it stays — and never further
  // than maxMove.
  const line = pos.slice();
  for (let s = 0; s < count; s++) {
    if (stays[s]) continue;
    walk(s);
    let around = 0, n = 0;
    for (const b of reached) {
      if (stays[b]) continue; // one that stays has no pull to compare
      around += pull[b];
      n++;
    }
    clearWalk();
    const move = Math.max(-maxMove, Math.min(maxMove, pull[s] - (n > 0 ? around / n : 0)));
    line[s * 3] = pos[s * 3] + move * across[s * 3];
    line[s * 3 + 1] = pos[s * 3 + 1] + move * across[s * 3 + 1];
    line[s * 3 + 2] = pos[s * 3 + 2] + move * across[s * 3 + 2];
  }
  return { edgeLength, maxMove, eu, ev, eLeft, eRight, eFace, eAcross, slotA, slotB, line, across, along, stays, borderFace };
}

export function smoothBorderLines(
  adjacency: FaceAdjacency,
  triangles: MeshFaces,
  vertices: MeshPoints,
  groups: Int32Array,
  options: BorderLineOptions,
): number {
  const corners = flatCorners(triangles);
  const positions = flatPositions(vertices);
  const trace = traceBorderLine(adjacency, corners, positions, groups, options);
  if (!trace) return 0;
  const { offsets, neighbours, faceCount } = adjacency;
  const isProtected = (group: number) => options.protectedGroup[group] === 1;
  const { edgeLength, maxMove, eu, eLeft, eRight, eFace, eAcross, slotA, slotB, line, borderFace } = trace;
  const edgeCount = eu.length;

  // The stretches of line, with the normals of the two faces of the border edge each came from, in a grid of cells.
  const ax = new Float64Array(edgeCount * 3);
  const bx = new Float64Array(edgeCount * 3);
  const nx = new Float64Array(edgeCount * 3);
  const na = new Float64Array(edgeCount * 3);
  for (let e = 0; e < edgeCount; e++) {
    ax.set(line.subarray(slotA[e] * 3, slotA[e] * 3 + 3), e * 3);
    bx.set(line.subarray(slotB[e] * 3, slotB[e] * 3 + 3), e * 3);
    nx.set(faceNormalAt(corners, positions, eFace[e]), e * 3);
    na.set(faceNormalAt(corners, positions, eAcross[e]), e * 3);
  }
  // Faces change only this near the border: no further than a point of the line can move.
  const reach = maxMove + edgeLength;
  const cell = Math.max(1e-9, reach);
  const keyOf = (ix: number, iy: number, iz: number) => (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
  const grid = new Map<number, number[]>();
  const tiny = 1e-6 * edgeLength;
  for (let e = 0; e < edgeCount; e++) {
    const sx = bx[e * 3] - ax[e * 3];
    const sy = bx[e * 3 + 1] - ax[e * 3 + 1];
    const sz = bx[e * 3 + 2] - ax[e * 3 + 2];
    if (Math.hypot(sx, sy, sz) < tiny) continue; // no direction to tell sides by
    const lo = [0, 1, 2].map((c) => Math.floor(Math.min(ax[e * 3 + c], bx[e * 3 + c]) / cell));
    const hi = [0, 1, 2].map((c) => Math.floor(Math.max(ax[e * 3 + c], bx[e * 3 + c]) / cell));
    for (let ix = lo[0]; ix <= hi[0]; ix++)
      for (let iy = lo[1]; iy <= hi[1]; iy++)
        for (let iz = lo[2]; iz <= hi[2]; iz++) {
          const key = keyOf(ix, iy, iz);
          const list = grid.get(key);
          if (list) list.push(e);
          else grid.set(key, [e]);
        }
  }

  // 3) The faces near the border, measured against the line.
  const bandRings = Math.max(2, Math.ceil(maxMove / edgeLength) + 1);
  const ring = new Int16Array(faceCount).fill(-1);
  let frontier: number[] = [];
  for (let f = 0; f < faceCount; f++)
    if (borderFace[f]) {
      ring[f] = 0;
      frontier.push(f);
    }
  const band: number[] = [...frontier];
  for (let r = 1; r <= bandRings && frontier.length > 0; r++) {
    const grown: number[] = [];
    for (const f of frontier)
      for (let i = offsets[f]; i < offsets[f + 1]; i++) {
        const n = neighbours[i];
        if (ring[n] >= 0) continue;
        ring[n] = r;
        grown.push(n);
        band.push(n);
      }
    frontier = grown;
  }
  const tie = 0.05 * edgeLength;
  const decided = new Int32Array(band.length).fill(-1);
  band.forEach((f, index) => {
    const own = groups[f];
    if (isProtected(own)) return;
    const a = corners[f * 3] * 3;
    const b = corners[f * 3 + 1] * 3;
    const c = corners[f * 3 + 2] * 3;
    const cx = (positions[a] + positions[b] + positions[c]) / 3;
    const cy = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const ix = Math.floor(cx / cell);
    const iy = Math.floor(cy / cell);
    const iz = Math.floor(cz / cell);
    const [n0, n1, n2] = faceNormalAt(corners, positions, f);
    // The nearest stretches: the group each puts the face in.  The face is decided only
    // when it is one of their two groups and the near-equal ones agree.
    let bestDistance = Infinity;
    const candidates: Array<[number, number, number]> = []; // distance, group on the face's side, the other group
    const look = (list: number[] | undefined) => {
      if (!list) return;
      for (const e of list) {
        const sx = bx[e * 3] - ax[e * 3];
        const sy = bx[e * 3 + 1] - ax[e * 3 + 1];
        const sz = bx[e * 3 + 2] - ax[e * 3 + 2];
        const len2 = sx * sx + sy * sy + sz * sz;
        let tt = ((cx - ax[e * 3]) * sx + (cy - ax[e * 3 + 1]) * sy + (cz - ax[e * 3 + 2]) * sz) / len2;
        tt = Math.max(0, Math.min(1, tt));
        const qx = ax[e * 3] + sx * tt;
        const qy = ax[e * 3 + 1] + sy * tt;
        const qz = ax[e * 3 + 2] + sz * tt;
        const d = Math.hypot(cx - qx, cy - qy, cz - qz);
        if (d > reach || d > bestDistance + tie) continue;
        // A border on the other side of a thin wall: the face looks away from both its faces.
        if (n0 * nx[e * 3] + n1 * nx[e * 3 + 1] + n2 * nx[e * 3 + 2] < -THIN_WALL && n0 * na[e * 3] + n1 * na[e * 3 + 1] + n2 * na[e * 3 + 2] < -THIN_WALL) continue;
        // Left of the stretch, in the face's own surface: its normal × (b − a).  Not the
        // normal of the face the stretch came from: where the border runs along a fold,
        // that face can stand square to this one, and the side would be a guess.
        const side = (cx - qx) * (n1 * sz - n2 * sy) + (cy - qy) * (n2 * sx - n0 * sz) + (cz - qz) * (n0 * sy - n1 * sx);
        if (side === 0) continue;
        candidates.push(side > 0 ? [d, eLeft[e], eRight[e]] : [d, eRight[e], eLeft[e]]);
        if (d < bestDistance) bestDistance = d;
      }
    };
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) look(grid.get(keyOf(ix + dx, iy + dy, iz + dz)));
    let decision = -1;
    for (const [d, group, other] of candidates) {
      if (d > bestDistance + tie) continue;
      if (own !== group && own !== other) return; // a third colour is left alone
      if (decision < 0) decision = group;
      else if (group !== decision) return; // stretches as near disagree
    }
    if (decision >= 0 && decision !== own) decided[index] = decision;
  });
  // Taken nearest the border first, and only by a group already touching the face:
  // a change grows from the border, never as a strip of its own inside a part.
  const order = band.map((_, index) => index).filter((index) => decided[index] >= 0);
  order.sort((x, y) => ring[band[x]] - ring[band[y]]);
  let changed = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const index of order) {
      const f = band[index];
      const group = decided[index];
      if (group < 0 || groups[f] === group) continue;
      let touches = false;
      for (let i = offsets[f]; i < offsets[f + 1] && !touches; i++) touches = groups[neighbours[i]] === group;
      if (!touches) continue;
      groups[f] = group;
      decided[index] = -1;
      changed++;
    }
  }
  return changed;
}

/** A mesh's faces: as corner triples, or flat (3 vertex indices per face). */
export type MeshFaces = ArrayLike<Tri> | Int32Array;
/** A mesh's vertices: as points, or flat (x, y, z per vertex). */
export type MeshPoints = ArrayLike<Vec3> | Float64Array | Float32Array;

/** The faces' corners as one flat array (as given when they already are). */
export function flatCorners(triangles: MeshFaces): Int32Array {
  if (ArrayBuffer.isView(triangles)) return triangles as Int32Array;
  const list = triangles as ArrayLike<Tri>;
  const out = new Int32Array(list.length * 3);
  for (let f = 0; f < list.length; f++) {
    const t = list[f];
    out[f * 3] = t[0];
    out[f * 3 + 1] = t[1];
    out[f * 3 + 2] = t[2];
  }
  return out;
}

/** The vertices as one flat array (as given when they already are). */
export function flatPositions(vertices: MeshPoints): Float64Array | Float32Array {
  if (ArrayBuffer.isView(vertices)) return vertices as Float64Array | Float32Array;
  const list = vertices as ArrayLike<Vec3>;
  const out = new Float64Array(list.length * 3);
  for (let v = 0; v < list.length; v++) {
    const p = list[v];
    out[v * 3] = p[0];
    out[v * 3 + 1] = p[1];
    out[v * 3 + 2] = p[2];
  }
  return out;
}

/** The unit normal of face f. */
export function faceNormalAt(corners: ArrayLike<number>, positions: ArrayLike<number>, f: number): [number, number, number] {
  const a = corners[f * 3] * 3;
  const b = corners[f * 3 + 1] * 3;
  const c = corners[f * 3 + 2] * 3;
  const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
  const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
