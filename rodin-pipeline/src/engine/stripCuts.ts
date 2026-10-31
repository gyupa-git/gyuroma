import type { ColourStripData, StripCuts } from "@core/colourStrip";

/**
 * Cuts that keep every colour in the group it was in, as nearly as one band
 * per group allows.  A band is a run of the family, light to dark, so groups
 * whose colours now overlap in lightness (a group made lighter until it
 * reaches the next) cannot each keep all of theirs: the groups go in the
 * order their colours sit, and each boundary falls where the fewest colours
 * (by area) end up in another group.  Groups that do not overlap come out
 * cut exactly where they meet.  Colours with no group go to whichever side
 * they fall on.
 */
export function cutsKeepingGroups(strip: ColourStripData, groupOfKey: Map<number, string>): StripCuts {
  const cuts: StripCuts = {};
  for (const family of strip.families) {
    const n = family.colours.length;
    const share = new Float64Array(n);
    const ids = new Int32Array(n).fill(-1);
    const names = new Map<string, number>();
    const centre: number[] = [];
    const mass: number[] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const colour = family.colours[i];
      const s = family.weight > 0 ? colour.weight / family.weight : 0;
      share[i] = s;
      const name = groupOfKey.get(colour.key);
      if (name !== undefined) {
        let id = names.get(name);
        if (id === undefined) {
          id = names.size;
          names.set(name, id);
          centre.push(0);
          mass.push(0);
        }
        ids[i] = id;
        centre[id] += (acc + s / 2) * s;
        mass[id] += s;
      }
      acc += s;
    }
    const k = names.size;
    if (k <= 1) continue;
    // The groups in the order their colours sit along the family.
    const order = Array.from({ length: k }, (_, id) => id).sort((a, b) => centre[a] / (mass[a] || 1) - centre[b] / (mass[b] || 1));

    // best[p]: the most area kept with the groups so far laid over colours [0, p).
    let best = new Float64Array(n + 1).fill(-Infinity);
    best[0] = 0;
    const starts: Int32Array[] = [];
    for (let j = 0; j < k; j++) {
      const id = order[j];
      const next = new Float64Array(n + 1);
      const start = new Int32Array(n + 1);
      let run = -Infinity;
      let runAt = 0;
      let own = 0; // area of this group's colours in [0, p)
      for (let p = 0; p <= n; p++) {
        if (p > 0 && ids[p - 1] === id) own += share[p - 1];
        const v = best[p] - own;
        if (v > run) {
          run = v;
          runAt = p;
        }
        next[p] = own + run;
        start[p] = runAt;
      }
      starts.push(start);
      best = next;
    }
    const bounds: number[] = [];
    let p = n;
    for (let j = k - 1; j >= 1; j--) {
      p = starts[j][p];
      bounds.push(p);
    }
    bounds.reverse();
    const before = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) before[i + 1] = before[i] + share[i];
    const at: number[] = [];
    for (const b of bounds) {
      const q = before[b];
      // A group left with nothing (wholly inside another) has no band of its own.
      if (q > 1e-9 && q < 1 - 1e-9 && (at.length === 0 || q > at[at.length - 1] + 1e-12)) at.push(q);
    }
    if (at.length > 0) cuts[family.family] = at;
  }
  return cuts;
}
