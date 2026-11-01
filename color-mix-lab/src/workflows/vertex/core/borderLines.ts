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
 *    it is on gives its group (only between the two groups of that stretch — a
 *    third colour is left alone; a face as near to stretches that disagree is
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
}

/** Below this, the edges walked around a point (their directions summed, over their length) turn back on themselves. */
const FOLD = 0.35;

export function smoothBorderLines(
  adjacency: FaceAdjacency,
  triangles: ArrayLike<Tri>,
  vertices: ArrayLike<Vec3>,
  groups: Int32Array,
  options: BorderLineOptions,
): number {
  const span = Math.max(0, options.span);
  if (span === 0) return 0;
  const { offsets, neighbours, faceCount } = adjacency;
  const isProtected = (group: number) => options.protectedGroup[group] === 1;

  // 1) Border edges.
  const eu: number[] = [];
  const ev: number[] = [];
  const eLeft: number[] = [];
  const eRight: number[] = [];
  const eFace: number[] = [];
  const borderFace = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const own = groups[f];
    let foreign = false;
    for (let i = offsets[f]; i < offsets[f + 1] && !foreign; i++) foreign = groups[neighbours[i]] !== own;
    if (!foreign) continue;
    const t = triangles[f];
    for (let k = 0; k < 3; k++) {
      const u = t[k];
      const v = t[(k + 1) % 3];
      let across = -1;
      for (let i = offsets[f]; i < offsets[f + 1]; i++) {
        const n = neighbours[i];
        const s = triangles[n];
        if ((s[0] === u || s[1] === u || s[2] === u) && (s[0] === v || s[1] === v || s[2] === v)) {
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
    }
  }
  const edgeCount = eu.length;
  if (edgeCount === 0) return 0;

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
    const p = vertices[eu[e]];
    const q = vertices[ev[e]];
    lengthOf[e] = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    edgeLength += lengthOf[e];
  }
  edgeLength /= edgeCount;
  const half = (span * edgeLength) / 2;
  const maxMove = Math.max(2, span / 4) * edgeLength;

  // A point moves when its border edges are all of one unprotected pair and as many come in as go out.
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
    if (balance === 0 && one && !isProtected(Math.floor(p0 / 65536)) && !isProtected(p0 % 65536)) moves[s] = 1;
  }
  const pos = new Float64Array(count * 3);
  for (let s = 0; s < count; s++) pos.set(vertices[at[s]], s * 3);
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
          const p = vertices[eu[e]];
          const q = vertices[ev[e]];
          vx += q[0] - p[0];
          vy += q[1] - p[1];
          vz += q[2] - p[2];
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
      const t = triangles[eFace[edgeList[k]]];
      const n = faceNormal(vertices[t[0]], vertices[t[1]], vertices[t[2]]);
      normalAt[s * 3] += n[0];
      normalAt[s * 3 + 1] += n[1];
      normalAt[s * 3 + 2] += n[2];
    }
  }
  // Across the border at each point, in the surface, towards the lower group: the
  // normal × the way the border runs over the whole window (not just the edges at the
  // point — at the corner of a tooth those point every way).
  const across = new Float64Array(count * 3);
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

  // The stretches of line, with the normal of the face each came from, in a grid of cells.
  const ax = new Float64Array(edgeCount * 3);
  const bx = new Float64Array(edgeCount * 3);
  const nx = new Float64Array(edgeCount * 3);
  for (let e = 0; e < edgeCount; e++) {
    ax.set(line.subarray(slotA[e] * 3, slotA[e] * 3 + 3), e * 3);
    bx.set(line.subarray(slotB[e] * 3, slotB[e] * 3 + 3), e * 3);
    const t = triangles[eFace[e]];
    nx.set(faceNormal(vertices[t[0]], vertices[t[1]], vertices[t[2]]), e * 3);
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
    const t = triangles[f];
    const p = vertices[t[0]];
    const q = vertices[t[1]];
    const r = vertices[t[2]];
    const cx = (p[0] + q[0] + r[0]) / 3;
    const cy = (p[1] + q[1] + r[1]) / 3;
    const cz = (p[2] + q[2] + r[2]) / 3;
    const ix = Math.floor(cx / cell);
    const iy = Math.floor(cy / cell);
    const iz = Math.floor(cz / cell);
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
        // Left of the stretch = across the normal from its direction: n × (b − a).
        const n0 = nx[e * 3];
        const n1 = nx[e * 3 + 1];
        const n2 = nx[e * 3 + 2];
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

function faceNormal(a: Vec3, b: Vec3, c: Vec3): [number, number, number] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
