import type { FaceAdjacency } from "@core/meshAdjacency";

/**
 * The faces round a pick, out to `reach` (model units, face to face over the surface, not straight through
 * the air): what the colour map unfolds with the pick when its neighbours are wanted too, so the pick's edge
 * can be painted out past or back in on the map (11-05, the owner: "고른 조각과 붙어 있는 다른 색 면도 같이
 * 나오게 해 줘 — 지금은 그 조각 안에 묶여서 면적을 넓힐 수도, 수정을 할 수도 없어").
 *
 * The picked faces always come; past them the nearest first, at most `maxFaces` in all.  A small neighbour
 * (the eye inside its rim) comes whole, a big one (the face round the eye) as a band round the pick.
 */
export function facesAround(adjacency: FaceAdjacency, centroids: Float32Array, picked: ArrayLike<number>, reach: number, maxFaces: number): Int32Array {
  const n = adjacency.faceCount;
  const dist = new Float64Array(n).fill(Infinity);
  const out: number[] = [];
  const heap = new Heap();
  for (let i = 0; i < picked.length; i++) {
    const f = picked[i];
    if (dist[f] === 0) continue;
    dist[f] = 0;
    out.push(f);
  }
  for (const f of out) heap.push(0, f);
  const done = new Uint8Array(n);
  const { offsets, neighbours } = adjacency;
  while (heap.size > 0 && out.length < maxFaces) {
    const d = heap.topKey();
    const f = heap.pop();
    if (done[f] || d > dist[f]) continue;
    done[f] = 1;
    if (d > 0) out.push(f);
    const fx = centroids[f * 3], fy = centroids[f * 3 + 1], fz = centroids[f * 3 + 2];
    for (let k = offsets[f]; k < offsets[f + 1]; k++) {
      const g = neighbours[k];
      if (done[g]) continue;
      const step = Math.hypot(centroids[g * 3] - fx, centroids[g * 3 + 1] - fy, centroids[g * 3 + 2] - fz);
      const next = d + step;
      if (next > reach || next >= dist[g]) continue;
      dist[g] = next;
      heap.push(next, g);
    }
  }
  return Int32Array.from(out.length > maxFaces ? out.slice(0, maxFaces) : out);
}

/** A binary min-heap of (key, face). */
class Heap {
  private keys = new Float64Array(1024);
  private values = new Int32Array(1024);
  size = 0;

  push(key: number, value: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
      const values = new Int32Array(this.size * 2);
      values.set(this.values);
      this.values = values;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.values[i] = this.values[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.values[i] = value;
  }

  topKey(): number {
    return this.keys[0];
  }

  pop(): number {
    const top = this.values[0];
    const key = this.keys[--this.size];
    const value = this.values[this.size];
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= key) break;
      this.keys[i] = this.keys[child];
      this.values[i] = this.values[child];
      i = child;
    }
    this.keys[i] = key;
    this.values[i] = value;
    return top;
  }
}
