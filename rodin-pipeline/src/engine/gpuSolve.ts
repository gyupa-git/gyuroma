/**
 * The colour map's long solves on the graphics card (WebGPU) — 11-05, the owner: "GPU를 활용해서 더빨리" and "아무리
 * 줄었다고 하지만 조각하나 펴는데 70초면 누가 사용하겠어" (Tkc's hair, 1.1 M faces).  The solves are unfold.ts's own
 * (lscmSystem and arapSystem set them up on the processor); what runs here are their thousands of conjugate-gradient
 * steps, each the same few sums over every triangle and every vertex — work a graphics card does for a million at once.
 *
 * A step is a handful of compute passes: the operator (per triangle, then gathered per vertex — no atomics), two dot
 * products (per-workgroup partial sums, then one workgroup that also works out the step's α or β), and the vector
 * updates.  The scalars stay on the card; how far the solve has come is read back once every CHUNK steps.  Numbers are
 * 32-bit there (64-bit on the processor) — plenty for a layout drawn a few thousand pixels across.
 *
 * Small solves stay on the processor (setting the card up costs more than it saves), and any solve the card fails on
 * (no device, out of memory, a lost device) is done again on the processor.
 */
import { arapSystem, cpuSolver, lscmSystem, type Solver } from "./unfold";

/** WebGPU's buffer usages and map mode (the spec's values; the type library declares the names but not the values). */
const USAGE = { MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, UNIFORM: 0x0040, STORAGE: 0x0080 } as const;
const MAP_READ_MODE = 0x0001;

/** Below this many triangles a solve stays on the processor. */
const GPU_FROM_TRIANGLES = 20_000;
/** Steps between looks at how far a solve has come (each look waits for the card). */
const CHUNK = 50;
/** Workgroups whose partial sums a dot product leaves (each 256 invocations, the vector strided over them). */
const PARTIALS = 256;

const HEAD = /* wgsl */ `
struct Params { m: u32, t: u32, n: u32, flag: u32 };
@group(0) @binding(0) var<uniform> P: Params;
`;

/** The conformal error's A·p, per triangle (two residuals each). */
const LSCM_TRI = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> vecIn: array<f32>;
@group(0) @binding(2) var<storage, read> F: array<u32>;
@group(0) @binding(3) var<storage, read> ca: array<f32>;
@group(0) @binding(4) var<storage, read> cb: array<f32>;
@group(0) @binding(5) var<storage, read_write> R: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let t = id.x;
  if (t >= P.t) { return; }
  var r1 = 0.0;
  var r2 = 0.0;
  for (var k = 0u; k < 3u; k = k + 1u) {
    let o = t * 3u + k;
    let j = F[o];
    let a = ca[o];
    let b = cb[o];
    let pu = vecIn[j];
    let pv = vecIn[P.m + j];
    r1 = r1 + a * pu - b * pv;
    r2 = r2 + b * pu + a * pv;
  }
  R[t * 2u] = r1;
  R[t * 2u + 1u] = r2;
}`;

/** Aᵀ of the residuals, gathered per vertex over the triangles it is a corner of; fixed entries 0. */
const LSCM_VERT = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> R: array<f32>;
@group(0) @binding(2) var<storage, read> incStart: array<u32>;
@group(0) @binding(3) var<storage, read> incList: array<u32>;
@group(0) @binding(4) var<storage, read> ca: array<f32>;
@group(0) @binding(5) var<storage, read> cb: array<f32>;
@group(0) @binding(6) var<storage, read> mask: array<f32>;
@group(0) @binding(7) var<storage, read_write> outVec: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let j = id.x;
  if (j >= P.m) { return; }
  var su = 0.0;
  var sv = 0.0;
  for (var e = incStart[j]; e < incStart[j + 1u]; e = e + 1u) {
    let o = incList[e];
    let t = o / 3u;
    let a = ca[o];
    let b = cb[o];
    let r1 = R[t * 2u];
    let r2 = R[t * 2u + 1u];
    su = su + a * r1 + b * r2;
    sv = sv - b * r1 + a * r2;
  }
  outVec[j] = su * mask[j];
  outVec[P.m + j] = sv * mask[P.m + j];
}`;

/** The cotangent Laplacian's L·p, per vertex over its edges. */
const LAPLACE = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> vecIn: array<f32>;
@group(0) @binding(2) var<storage, read> nbStart: array<u32>;
@group(0) @binding(3) var<storage, read> nbIdx: array<u32>;
@group(0) @binding(4) var<storage, read> nbW: array<f32>;
@group(0) @binding(5) var<storage, read_write> outVec: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let j = id.x;
  if (j >= P.m) { return; }
  let pu = vecIn[j];
  let pv = vecIn[P.m + j];
  var du = 0.0;
  var dv = 0.0;
  for (var e = nbStart[j]; e < nbStart[j + 1u]; e = e + 1u) {
    let q = nbIdx[e];
    let w = nbW[e];
    du = du + w * (pu - vecIn[q]);
    dv = dv + w * (pv - vecIn[P.m + q]);
  }
  outVec[j] = du;
  outVec[P.m + j] = dv;
}`;

/** ARAP's local step: each triangle's best turn onto its own flat shape, and what it adds to each corner's right side. */
const ARAP_LOCAL = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read> F: array<u32>;
@group(0) @binding(3) var<storage, read> qx: array<f32>;
@group(0) @binding(4) var<storage, read> qy: array<f32>;
@group(0) @binding(5) var<storage, read> w: array<f32>;
@group(0) @binding(6) var<storage, read_write> contrib: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let t = id.x;
  if (t >= P.t) { return; }
  let o = t * 3u;
  var s00 = 0.0;
  var s01 = 0.0;
  var s10 = 0.0;
  var s11 = 0.0;
  for (var k = 0u; k < 3u; k = k + 1u) {
    let wk = w[o + k];
    if (wk == 0.0) { continue; }
    let ka = (k + 1u) % 3u;
    let kb = (k + 2u) % 3u;
    let a = F[o + ka];
    let b = F[o + kb];
    let du = x[a] - x[b];
    let dv = x[P.m + a] - x[P.m + b];
    let ex = qx[o + ka] - qx[o + kb];
    let ey = qy[o + ka] - qy[o + kb];
    s00 = s00 + wk * du * ex;
    s01 = s01 + wk * du * ey;
    s10 = s10 + wk * dv * ex;
    s11 = s11 + wk * dv * ey;
  }
  let ang = atan2(s10 - s01, s00 + s11);
  let c = cos(ang);
  let s = sin(ang);
  var cu = array<f32, 3>(0.0, 0.0, 0.0);
  var cv = array<f32, 3>(0.0, 0.0, 0.0);
  for (var k = 0u; k < 3u; k = k + 1u) {
    let wk = w[o + k];
    if (wk == 0.0) { continue; }
    let ka = (k + 1u) % 3u;
    let kb = (k + 2u) % 3u;
    let ex = qx[o + ka] - qx[o + kb];
    let ey = qy[o + ka] - qy[o + kb];
    let ru = wk * (c * ex - s * ey);
    let rv = wk * (s * ex + c * ey);
    cu[ka] = cu[ka] + ru;
    cv[ka] = cv[ka] + rv;
    cu[kb] = cu[kb] - ru;
    cv[kb] = cv[kb] - rv;
  }
  for (var k = 0u; k < 3u; k = k + 1u) {
    contrib[(o + k) * 2u] = cu[k];
    contrib[(o + k) * 2u + 1u] = cv[k];
  }
}`;

/** ARAP's right side, gathered per vertex. */
const ARAP_RHS = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> contrib: array<f32>;
@group(0) @binding(2) var<storage, read> incStart: array<u32>;
@group(0) @binding(3) var<storage, read> incList: array<u32>;
@group(0) @binding(4) var<storage, read_write> outVec: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let j = id.x;
  if (j >= P.m) { return; }
  var su = 0.0;
  var sv = 0.0;
  for (var e = incStart[j]; e < incStart[j + 1u]; e = e + 1u) {
    let o = incList[e];
    su = su + contrib[o * 2u];
    sv = sv + contrib[o * 2u + 1u];
  }
  outVec[j] = su;
  outVec[P.m + j] = sv;
}`;

/** The start of conjugate gradients: r = b − A·x (b = 0 unless flag), z = M⁻¹r, p = z. */
const CG_INIT = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read> q: array<f32>;
@group(0) @binding(3) var<storage, read> pre: array<f32>;
@group(0) @binding(4) var<storage, read_write> r: array<f32>;
@group(0) @binding(5) var<storage, read_write> z: array<f32>;
@group(0) @binding(6) var<storage, read_write> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= P.n) { return; }
  let rr = select(0.0, b[i], P.flag == 1u) - q[i];
  r[i] = rr;
  let zz = pre[i] * rr;
  z[i] = zz;
  p[i] = zz;
}`;

/** Partial sums of a·b (times wgt when flag), one per workgroup, the vector strided over them. */
const DOT = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> a: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read> wgt: array<f32>;
@group(0) @binding(4) var<storage, read_write> partials: array<f32>;
var<workgroup> sh: array<f32, 256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let stride = nw.x * 256u;
  var sum = 0.0;
  var i = wid.x * 256u + lid.x;
  loop {
    if (i >= P.n) { break; }
    var v = a[i] * b[i];
    if (P.flag == 1u) { v = v * wgt[i]; }
    sum = sum + v;
    i = i + stride;
  }
  sh[lid.x] = sum;
  workgroupBarrier();
  var s = 128u;
  loop {
    if (s == 0u) { break; }
    if (lid.x < s) { sh[lid.x] = sh[lid.x] + sh[lid.x + s]; }
    workgroupBarrier();
    s = s >> 1u;
  }
  if (lid.x == 0u) { partials[wid.x] = sh[0]; }
}`;

/**
 * The partial sums added up, and what follows from the total (flag): 0 = p·q → α (0 and stop when p·q ≤ 0),
 * 1 = new r·z → β, 2 = first r·z, 3 = the right side's size.  Scalars: rz, α, β, pq, rz0, bb, stop.
 */
const FINISH = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> partials: array<f32>;
@group(0) @binding(2) var<storage, read_write> scal: array<f32>;
var<workgroup> sh: array<f32, 256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_id) lid: vec3<u32>) {
  sh[lid.x] = partials[lid.x];
  workgroupBarrier();
  var s = 128u;
  loop {
    if (s == 0u) { break; }
    if (lid.x < s) { sh[lid.x] = sh[lid.x] + sh[lid.x + s]; }
    workgroupBarrier();
    s = s >> 1u;
  }
  if (lid.x != 0u) { return; }
  let total = sh[0];
  if (P.flag == 0u) {
    scal[3] = total;
    if (scal[6] > 0.5 || !(total > 0.0)) {
      scal[1] = 0.0;
      scal[6] = 1.0;
    } else {
      scal[1] = scal[0] / total;
    }
  } else if (P.flag == 1u) {
    if (scal[6] > 0.5 || !(scal[0] > 0.0)) { scal[2] = 0.0; } else { scal[2] = total / scal[0]; }
    scal[0] = total;
  } else if (P.flag == 2u) {
    scal[0] = total;
    scal[4] = total;
    scal[6] = 0.0;
  } else {
    scal[5] = total;
  }
}`;

/** x += αp, r −= αq, z = M⁻¹r. */
const UPDATE_X = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> scal: array<f32>;
@group(0) @binding(2) var<storage, read_write> x: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<f32>;
@group(0) @binding(4) var<storage, read> q: array<f32>;
@group(0) @binding(5) var<storage, read_write> r: array<f32>;
@group(0) @binding(6) var<storage, read_write> z: array<f32>;
@group(0) @binding(7) var<storage, read> pre: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= P.n) { return; }
  let al = scal[1];
  x[i] = x[i] + al * p[i];
  let rr = r[i] - al * q[i];
  r[i] = rr;
  z[i] = pre[i] * rr;
}`;

/** p = z + βp. */
const UPDATE_P = HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> scal: array<f32>;
@group(0) @binding(2) var<storage, read> z: array<f32>;
@group(0) @binding(3) var<storage, read_write> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= P.n) { return; }
  p[i] = z[i] + scal[2] * p[i];
}`;

type Kernel = "lscmTri" | "lscmVert" | "laplace" | "arapLocal" | "arapRhs" | "init" | "dot" | "finish" | "updateX" | "updateP";

const SOURCES: Record<Kernel, string> = {
  lscmTri: LSCM_TRI,
  lscmVert: LSCM_VERT,
  laplace: LAPLACE,
  arapLocal: ARAP_LOCAL,
  arapRhs: ARAP_RHS,
  init: CG_INIT,
  dot: DOT,
  finish: FINISH,
  updateX: UPDATE_X,
  updateP: UPDATE_P,
};

interface Card {
  device: GPUDevice;
  pipelines: Record<Kernel, GPUComputePipeline>;
}

/** The vertices each triangle corner belongs to, as lists per vertex of corner indices t·3+k (CSR). */
function cornersByVertex(F: Int32Array, m: number): { start: Uint32Array; list: Uint32Array } {
  const start = new Uint32Array(m + 1);
  for (let o = 0; o < F.length; o++) start[F[o] + 1]++;
  for (let j = 0; j < m; j++) start[j + 1] += start[j];
  const fill = start.slice(0, m);
  const list = new Uint32Array(F.length);
  for (let o = 0; o < F.length; o++) list[fill[F[o]]++] = o;
  return { start, list };
}

/** Each vertex's edges and their weights (CSR), from the edges once each. */
function neighbourList(eA: Int32Array, eB: Int32Array, eW: Float64Array, m: number): { start: Uint32Array; idx: Uint32Array; w: Float32Array } {
  const start = new Uint32Array(m + 1);
  for (let e = 0; e < eA.length; e++) {
    start[eA[e] + 1]++;
    start[eB[e] + 1]++;
  }
  for (let j = 0; j < m; j++) start[j + 1] += start[j];
  const fill = start.slice(0, m);
  const idx = new Uint32Array(eA.length * 2);
  const w = new Float32Array(eA.length * 2);
  for (let e = 0; e < eA.length; e++) {
    const a = eA[e], b = eB[e];
    idx[fill[a]] = b;
    w[fill[a]++] = eW[e];
    idx[fill[b]] = a;
    w[fill[b]++] = eW[e];
  }
  return { start, idx, w };
}

/** One solve's buffers on the card, freed together. */
class Buffers {
  private all: GPUBuffer[] = [];
  constructor(private device: GPUDevice) {}
  /** A storage buffer holding `data` (or `bytes` of zeros). */
  storage(data: Float32Array | Uint32Array | null, bytes = 0): GPUBuffer {
    const size = Math.max(16, Math.ceil((data ? data.byteLength : bytes) / 4) * 4);
    const buffer = this.device.createBuffer({ size, usage: USAGE.STORAGE | USAGE.COPY_SRC | USAGE.COPY_DST });
    if (data && data.byteLength) this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    this.all.push(buffer);
    return buffer;
  }
  uniform(m: number, t: number, n: number, flag: number): GPUBuffer {
    const buffer = this.device.createBuffer({ size: 16, usage: USAGE.UNIFORM | USAGE.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, new Uint32Array([m, t, n, flag]));
    this.all.push(buffer);
    return buffer;
  }
  readable(size: number): GPUBuffer {
    const buffer = this.device.createBuffer({ size: Math.max(16, size), usage: USAGE.MAP_READ | USAGE.COPY_DST });
    this.all.push(buffer);
    return buffer;
  }
  free(): void {
    for (const buffer of this.all) buffer.destroy();
    this.all = [];
  }
}

/** Reads `size` bytes of `source` back from the card. */
async function readBack(device: GPUDevice, buffers: Buffers, source: GPUBuffer, size: number): Promise<Float32Array> {
  const staging = buffers.readable(size);
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(MAP_READ_MODE, 0, size);
  const out = new Float32Array(staging.getMappedRange(0, size).slice(0));
  staging.unmap();
  return out;
}

/** The conjugate-gradient machinery shared by both solves: vectors, scalars and the passes of a step. */
class Cg {
  readonly r: GPUBuffer;
  readonly z: GPUBuffer;
  readonly p: GPUBuffer;
  readonly q: GPUBuffer;
  readonly pre: GPUBuffer;
  readonly partials: GPUBuffer;
  readonly scal: GPUBuffer;
  private readonly n: number;
  private readonly groups: Record<string, GPUBindGroup> = {};
  private readonly card: Card;
  private readonly flagged: GPUBuffer[];

  constructor(card: Card, buffers: Buffers, readonly x: GPUBuffer, pre: Float32Array, m: number, t: number) {
    this.card = card;
    this.n = 2 * m;
    this.r = buffers.storage(null, this.n * 4);
    this.z = buffers.storage(null, this.n * 4);
    this.p = buffers.storage(null, this.n * 4);
    this.q = buffers.storage(null, this.n * 4);
    this.pre = buffers.storage(pre);
    this.partials = buffers.storage(null, PARTIALS * 4);
    this.scal = buffers.storage(null, 8 * 4);
    this.flagged = [0, 1, 2, 3].map((flag) => buffers.uniform(m, t, this.n, flag));
  }

  /** A bind group for kernel `k` (binding 0 the uniform with `flag`, then `resources` in order), made once by `key`. */
  group(key: string, k: Kernel, flag: number, resources: GPUBuffer[]): GPUBindGroup {
    let g = this.groups[key];
    if (!g) {
      g = this.card.device.createBindGroup({
        layout: this.card.pipelines[k].getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.flagged[flag] } }, ...resources.map((buffer, i) => ({ binding: i + 1, resource: { buffer } }))],
      });
      this.groups[key] = g;
    }
    return g;
  }

  run(pass: GPUComputePassEncoder, k: Kernel, group: GPUBindGroup, count: number): void {
    pass.setPipeline(this.card.pipelines[k]);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(count / 256));
  }

  /** Σ a·b (·wgt), and what the total sets (FINISH's flag). */
  dot(pass: GPUComputePassEncoder, key: string, a: GPUBuffer, b: GPUBuffer, wgt: GPUBuffer | null, finish: number): void {
    pass.setPipeline(this.card.pipelines.dot);
    pass.setBindGroup(0, this.group(`dot-${key}`, "dot", wgt ? 1 : 0, [a, b, wgt ?? a, this.partials]));
    pass.dispatchWorkgroups(PARTIALS);
    pass.setPipeline(this.card.pipelines.finish);
    pass.setBindGroup(0, this.group(`finish-${finish}`, "finish", finish, [this.partials, this.scal]));
    pass.dispatchWorkgroups(1);
  }

  /** r = b − (A·x already in q), z, p, and r·z. */
  start(pass: GPUComputePassEncoder, b: GPUBuffer | null): void {
    this.run(pass, "init", this.group(b ? "init-b" : "init", "init", b ? 1 : 0, [b ?? this.q, this.q, this.pre, this.r, this.z, this.p]), this.n);
    this.dot(pass, "rz", this.r, this.z, null, 2);
  }

  /** The rest of a step once A·p is in q. */
  step(pass: GPUComputePassEncoder): void {
    this.dot(pass, "pq", this.p, this.q, null, 0);
    this.run(pass, "updateX", this.group("updateX", "updateX", 0, [this.scal, this.x, this.p, this.q, this.r, this.z, this.pre]), this.n);
    this.dot(pass, "rz", this.r, this.z, null, 1);
    this.run(pass, "updateP", this.group("updateP", "updateP", 0, [this.scal, this.z, this.p]), this.n);
  }
}

/**
 * Runs `setUp` (the buffers made and the first passes sent) inside the card's error scopes, and throws what the card
 * reports — out of memory, a pass it would not take — so that the solve is done on the processor instead.
 */
async function checked(device: GPUDevice, setUp: () => void): Promise<void> {
  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("validation");
  let thrown: unknown = null;
  try {
    setUp();
  } catch (error) {
    thrown = error;
  }
  const validation = await device.popErrorScope();
  const memory = await device.popErrorScope();
  if (thrown) throw thrown;
  const failed = validation ?? memory;
  if (failed) throw new Error(failed.message);
}

/** The conformal error made small on the card (as unfold.ts solveLevel). */
async function cardLevel(card: Card, P: Float64Array, F: Int32Array, m: number, x: Float64Array, maxIterations: number, tolerance: number, onProgress?: (done: number, total: number) => void, held?: Uint8Array): Promise<void> {
  const { device } = card;
  const T = F.length / 3;
  const n = 2 * m;
  const { ca, cb, diag, free } = lscmSystem(P, F, m, x, held);
  const pre = new Float32Array(n);
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mask[i] = free[i];
    pre[i] = free[i] && diag[i % m] > 0 ? 1 / diag[i % m] : 0;
  }
  const corners = cornersByVertex(F, m);
  const buffers = new Buffers(device);
  try {
    let xBuf!: GPUBuffer;
    let cg!: Cg;
    let steps!: (count: number) => void;
    await checked(device, () => {
      xBuf = buffers.storage(Float32Array.from(x));
      const fBuf = buffers.storage(Uint32Array.from(F));
      const caBuf = buffers.storage(Float32Array.from(ca));
      const cbBuf = buffers.storage(Float32Array.from(cb));
      const incStart = buffers.storage(corners.start);
      const incList = buffers.storage(corners.list);
      const maskBuf = buffers.storage(mask);
      const residuals = buffers.storage(null, T * 2 * 4);
      cg = new Cg(card, buffers, xBuf, pre, m, T);
      const apply = (pass: GPUComputePassEncoder, from: GPUBuffer, key: string) => {
        cg.run(pass, "lscmTri", cg.group(`tri-${key}`, "lscmTri", 0, [from, fBuf, caBuf, cbBuf, residuals]), T);
        cg.run(pass, "lscmVert", cg.group("vert", "lscmVert", 0, [residuals, incStart, incList, caBuf, cbBuf, maskBuf, cg.q]), m);
      };
      steps = (count: number) => {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        for (let k = 0; k < count; k++) {
          apply(pass, cg.p, "p");
          cg.step(pass);
        }
        pass.end();
        device.queue.submit([encoder.finish()]);
      };
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      apply(pass, xBuf, "x");
      cg.start(pass, null);
      pass.end();
      device.queue.submit([encoder.finish()]);
      steps(Math.min(CHUNK, maxIterations));
    });
    let done = Math.min(CHUNK, maxIterations);
    let first = 0;
    for (;;) {
      const s = await readBack(device, buffers, cg.scal, 32);
      if (!first) first = Math.sqrt(Math.abs(s[4])) || 1;
      onProgress?.(done, maxIterations);
      if (done >= maxIterations || s[6] > 0.5 || !Number.isFinite(s[0]) || Math.sqrt(Math.abs(s[0])) <= tolerance * first) break;
      const count = Math.min(CHUNK, maxIterations - done);
      steps(count);
      done += count;
    }
    const out = await readBack(device, buffers, xBuf, n * 4);
    for (let i = 0; i < n; i++) if (Number.isFinite(out[i])) x[i] = out[i];
  } finally {
    buffers.free();
  }
}

/** The layout made as rigid as possible on the card (as unfold.ts rigid). */
async function cardRigid(card: Card, P: Float64Array, F: Int32Array, m: number, x: Float64Array, rounds: number, steps: number, onProgress?: (share: number) => void, held?: Uint8Array): Promise<void> {
  const { device } = card;
  const T = F.length / 3;
  const n = 2 * m;
  const { qx, qy, w, pre, eA, eB, eW } = arapSystem(P, F, m, held);
  const corners = cornersByVertex(F, m);
  const near = neighbourList(eA, eB, eW, m);
  const buffers = new Buffers(device);
  try {
    let xBuf!: GPUBuffer;
    let cg!: Cg;
    let startRound!: () => void;
    let solveSteps!: (count: number) => void;
    await checked(device, () => {
      xBuf = buffers.storage(Float32Array.from(x));
      const fBuf = buffers.storage(Uint32Array.from(F));
      const qxBuf = buffers.storage(Float32Array.from(qx));
      const qyBuf = buffers.storage(Float32Array.from(qy));
      const wBuf = buffers.storage(Float32Array.from(w));
      const contrib = buffers.storage(null, T * 6 * 4);
      const incStart = buffers.storage(corners.start);
      const incList = buffers.storage(corners.list);
      const nbStart = buffers.storage(near.start);
      const nbIdx = buffers.storage(near.idx);
      const nbW = buffers.storage(near.w);
      const rhs = buffers.storage(null, n * 4);
      cg = new Cg(card, buffers, xBuf, Float32Array.from(pre), m, T);
      const laplace = (pass: GPUComputePassEncoder, from: GPUBuffer, key: string) =>
        cg.run(pass, "laplace", cg.group(`lap-${key}`, "laplace", 0, [from, nbStart, nbIdx, nbW, cg.q]), m);
      // Local (each triangle's turn), the right side, then the global solve's start from where the layout is.
      startRound = () => {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        cg.run(pass, "arapLocal", cg.group("local", "arapLocal", 0, [xBuf, fBuf, qxBuf, qyBuf, wBuf, contrib]), T);
        cg.run(pass, "arapRhs", cg.group("rhs", "arapRhs", 0, [contrib, incStart, incList, rhs]), m);
        laplace(pass, xBuf, "x");
        cg.start(pass, rhs);
        cg.dot(pass, "bb", rhs, rhs, cg.pre, 3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      };
      solveSteps = (count: number) => {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        for (let k = 0; k < count; k++) {
          laplace(pass, cg.p, "p");
          cg.step(pass);
        }
        pass.end();
        device.queue.submit([encoder.finish()]);
      };
      startRound();
      solveSteps(Math.min(CHUNK, steps));
    });
    for (let round = 0; round < rounds; round++) {
      let done = Math.min(CHUNK, steps);
      if (round > 0) {
        startRound();
        solveSteps(done);
      }
      for (;;) {
        const s = await readBack(device, buffers, cg.scal, 32);
        if (done >= steps || s[6] > 0.5 || !Number.isFinite(s[0]) || s[0] <= 1e-10 * s[5]) break;
        const count = Math.min(CHUNK, steps - done);
        solveSteps(count);
        done += count;
      }
      onProgress?.((round + 1) / rounds);
    }
    const out = await readBack(device, buffers, xBuf, n * 4);
    for (let i = 0; i < n; i++) if (Number.isFinite(out[i])) x[i] = out[i];
  } finally {
    buffers.free();
  }
}

/**
 * A solver that hands big solves to the graphics card, or null when there is none (no WebGPU, no adapter).  `onUse`
 * hears which did each big solve.
 */
export async function cardSolver(onUse?: (onCard: boolean) => void): Promise<Solver | null> {
  const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return null;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  let lost = false;
  void device.lost.then(() => {
    lost = true;
  });
  const pipelines = {} as Record<Kernel, GPUComputePipeline>;
  for (const k of Object.keys(SOURCES) as Kernel[]) {
    pipelines[k] = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: SOURCES[k] }), entryPoint: "main" } });
  }
  const card: Card = { device, pipelines };
  const big = (F: Int32Array) => !lost && F.length / 3 >= GPU_FROM_TRIANGLES;
  return {
    async level(P, F, m, x, maxIterations, tolerance, onProgress, held) {
      if (big(F)) {
        try {
          await cardLevel(card, P, F, m, x, maxIterations, tolerance, onProgress, held);
          onUse?.(true);
          return;
        } catch {
          onUse?.(false);
        }
      }
      await cpuSolver.level(P, F, m, x, maxIterations, tolerance, onProgress, held);
    },
    async rigid(P, F, m, x, rounds, steps, onProgress, held) {
      if (big(F)) {
        try {
          await cardRigid(card, P, F, m, x, rounds, steps, onProgress, held);
          onUse?.(true);
          return;
        } catch {
          onUse?.(false);
        }
      }
      await cpuSolver.rigid(P, F, m, x, rounds, steps, onProgress, held);
    },
  };
}
