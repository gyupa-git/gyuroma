import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { RGB } from "@core/types";
import type { ViewName } from "../engine/types";
import { srgbToLinear } from "../engine/mesh";
import { backgroundStyle, DEFAULT_BACKGROUND, type ViewBackground } from "./background";

export interface PickInfo {
  /** Second click on the same face within 400 ms. */
  double: boolean;
  /** Shift / Ctrl / Cmd held: add to or remove from the selection. */
  toggle: boolean;
  /** Which view the click came from (the other view re-centres on the patch). */
  source?: "3d" | "map";
  /** Alt held or eyedropper mode: sample the colour under the cursor instead of picking. */
  alt?: boolean;
}

export interface HighlightOverlay {
  id: string;
  /** Non-indexed face positions (3 corners each). */
  fill: Float32Array;
  /** Boundary line segments (2 points each). */
  edges: Float32Array;
  /** Smooth normals matching `fill`; without them the outline shell is skipped. */
  fillNormals?: Float32Array;
  /** Smooth normals matching `edges`; they lift the seam line just off the surface. */
  edgeNormals?: Float32Array;
  /** A point inside the patch for each segment of `edges` (one point each), so the seam is drawn on the outside. */
  edgeInside?: Float32Array;
  colour: string;
  /** Outline colour when it differs from the fill (a fill preview tinted in the new colour, outlined in white). */
  line?: string;
  /** A darker line just outside the outline, so a white selection reads on light colours too. */
  rim?: string;
  pulse?: boolean;
  opacity?: number;
  /**
   * Outline strength (default 0.9).  A patch of a few hundred thousand faces
   * has a boundary of tens of thousands of segments, and at full strength
   * that mat of lines reads as a solid block of the highlight colour instead
   * of a selection.
   */
  lineOpacity?: number;
}

export interface ViewerHit {
  faceIndex: number;
  point: [number, number, number];
  normal: [number, number, number];
}

export interface BrushCursor {
  point: [number, number, number];
  normal: [number, number, number];
  radius: number;
  /** Nothing would be painted here (outside the selection the brush is held to). */
  blocked?: boolean;
}

export interface MeshViewerHandle {
  /** Recolour faces in place (0..255 sRGB) without a React round trip. */
  setFaceColours(faces: ArrayLike<number>, rgb: RGB): void;
  /** The same with a colour per face: `rgbs` holds three bytes for each of `faces`. */
  setFaceColourList(faces: ArrayLike<number>, rgbs: Uint8Array): void;
  /** Show/hide the brush circle on the surface. */
  setBrushCursor(cursor: BrushCursor | null): void;
  /** Unit vector the camera looks along. */
  viewDirection(): [number, number, number];
  /** Pan so that `point` sits at the screen centre (orientation and distance unchanged). */
  focusOn(point: [number, number, number]): void;
  /** Where the camera is now, to draw the same view elsewhere; null without a model. */
  cameraPose(): CameraPose | null;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  /** Vertical field of view, degrees. */
  fov: number;
  /** Width / height of the view. */
  aspect: number;
  /** How much closer than the whole-model fit (1 = the fit, 3 = three times closer). */
  zoom: number;
}

export interface MeshViewerProps {
  positions: Float32Array | null;
  colours: Float32Array | null;
  view: ViewName;
  /** Bump to re-fit the camera to the current view. */
  fitNonce: number;
  overlays?: HighlightOverlay[];
  /** Called with the clicked face index (or null when nothing was hit). */
  onPick?: (faceIndex: number | null, info: PickInfo) => void;
  label?: string;
  /** Small controls beside the label (they take clicks; the label does not). */
  labelTools?: ReactNode;
  emptyLabel?: ReactNode;
  className?: string;
  /** Unlit rendering: face colours exactly as stored, no shading. */
  flat?: boolean;
  /** Brush mode: left-drag paints (rotate with the right button, zoom with the wheel). */
  brush?: boolean;
  /** Next click samples a colour instead of picking/painting. */
  eyedropper?: boolean;
  background?: ViewBackground;
  /**
   * The face under the pointer while it is not painting (null when it leaves
   * the model or starts a drag), so the patch a click would take can be shown
   * before clicking.
   */
  onHoverFace?: (faceIndex: number | null) => void;
  onBrushHover?: (hit: ViewerHit | null) => void;
  onBrushStart?: (hit: ViewerHit | null) => void;
  onBrushDrag?: (hit: ViewerHit | null) => void;
  onBrushEnd?: () => void;
  /**
   * How the highlighted faces are shown against the rest of the model:
   * "solo" hides everything else, "xray" turns everything else into a faint
   * veil the highlighted faces show through.  Nothing changes without a mask.
   */
  focus?: ViewerFocus;
  /**
   * Tags over picked patches: a dot where the patch was clicked and a leader
   * line out to its colour, share and extruder, drawn over everything so a
   * patch a few faces wide or behind another part can still be found.
   */
  callouts?: Callout[];
  /**
   * Layer preview: every point is drawn in the filament of the layer it falls
   * in, so a mix shows as the stripes it will print as.
   */
  layers?: LayerPreview | null;
  /**
   * Soft edges (default): colour borders and layer seams blended a little, as
   * a print looks; off = faces and layers exactly as assigned.  Display only.
   */
  softEdges?: boolean;
  /** The model vertex of each corner (3 per face, same order as `positions`), for soft colour borders. */
  cornerVertex?: Int32Array | null;
}

export interface LayerPreview {
  /** Which recipe each vertex's face prints with (3 per face, same order as the positions). */
  recipeOfVertex: Float32Array;
  /**
   * RGBA rows, two per recipe: texel k = layer k of the repeat (sRGB); the
   * last texel = the repeat's mean colour; alpha = the repeat length.  Rows
   * 0..height-1 hold each layer as it looks in the print (soft view), rows
   * height..2*height-1 each layer's own filament (sharp view).
   */
  table: Uint8Array;
  width: number;
  /** The number of recipes; the table has twice as many rows. */
  height: number;
  /** Bottom of the print in view space, and view units per layer. */
  zMin: number;
  layerUnits: number;
}

export type FocusMode = "normal" | "solo" | "xray";

/** A tag on the model: a dot where a patch was picked, a leader line, and what the patch is. */
export interface Callout {
  /** A tag (dot, leader, label), or just a pulsing ring that marks a small piece. */
  kind?: "tag" | "ring";
  /** View-space point the dot sits on. */
  point: [number, number, number];
  hex: string;
  title: string;
  value: string;
  /** Muted after the value, e.g. the whole colour's share when the patch is only part of it. */
  extra?: string;
  detail?: string;
}

interface PlacedCallout {
  point: THREE.Vector3;
  el: HTMLDivElement;
  /** The label beside the dot (none for a ring). */
  tag: HTMLElement | null;
  /** The leader's two strokes (dark outline, white line). */
  leaders: SVGPathElement[];
  /** Where the dot is on screen now (CSS px), and whether it is in front of the camera. */
  x: number;
  y: number;
  shown: boolean;
  /** The label's size, measured once it is laid out (0 = not yet). */
  w: number;
  h: number;
  /** What was last written, so an unchanged frame writes nothing. */
  at: string;
  lead: string;
  spot: string;
}

/** The label's distance from its dot: across to its near edge, and up (or down) to its middle. */
const LEAD_X = 40;
const LEAD_Y = 22;
/** Room (CSS px) above a dot before its label goes below it instead. */
const CALLOUT_ROOM_Y = 70;
/** Space kept between two labels, and around a dot. */
const CALLOUT_GAP = 4;
const DOT_ROOM = 6;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 + CALLOUT_GAP && b.x0 < a.x1 + CALLOUT_GAP && a.y0 < b.y1 + CALLOUT_GAP && b.y0 < a.y1 + CALLOUT_GAP;

/** Moves every tag to its dot after a frame: the camera may have turned or zoomed. */
function placeCallouts(state: ViewerState): void {
  if (state.callouts.length === 0) return;
  const canvas = state.renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const p = new THREE.Vector3();
  const tags: PlacedCallout[] = [];
  for (const callout of state.callouts) {
    p.copy(callout.point).project(state.camera);
    callout.shown = p.z > -1 && p.z < 1;
    callout.x = ((p.x + 1) / 2) * width;
    callout.y = ((1 - p.y) / 2) * height;
    // left/top rather than a transform: a transform would give each tag its own
    // layer, and every leader must sit under every label.
    const at = `${callout.x.toFixed(1)},${callout.y.toFixed(1)}`;
    if (at !== callout.at) {
      callout.at = at;
      callout.el.style.left = `${callout.x.toFixed(1)}px`;
      callout.el.style.top = `${callout.y.toFixed(1)}px`;
    }
    callout.el.style.visibility = callout.shown ? "visible" : "hidden";
    if (callout.tag && callout.w === 0) {
      callout.w = callout.tag.offsetWidth;
      callout.h = callout.tag.offsetHeight;
    }
    if (callout.tag && callout.shown) tags.push(callout);
  }
  layOutTags(tags, width, height);
}

type Segment = [number, number, number, number];

/** Whether a segment passes through a box (shrunk a little, so touching an edge does not count). */
function crosses([x0, y0, x1, y1]: Segment, box: Box): boolean {
  const bx0 = box.x0 + 1;
  const by0 = box.y0 + 1;
  const bx1 = box.x1 - 1;
  const by1 = box.y1 - 1;
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [
    [-dx, x0 - bx0],
    [dx, bx1 - x0],
    [-dy, y0 - by0],
    [dy, by1 - y0],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function meets([a, b, c, d]: Segment, [e, f, g, h]: Segment): boolean {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return side(a, b, c, d, e, f) * side(a, b, c, d, g, h) < 0 && side(e, f, g, h, a, b) * side(e, f, g, h, c, d) < 0;
}

/** The leader from a dot to its label: its path (relative to the dot) and its segments on screen. */
function leaderTo(c: PlacedCallout, box: Box): { d: string; segments: Segment[] } {
  const dy = (box.y0 + box.y1) / 2 - c.y;
  if (box.x0 - c.x >= 12 || c.x - box.x1 >= 12) {
    // Beside the dot: a diagonal up (or down) to the label's middle, then level into its near edge.
    const across = box.x0 > c.x ? box.x0 - c.x : box.x1 - c.x;
    const bend = Math.sign(across) * Math.min(Math.abs(dy), Math.abs(across) - 10);
    return {
      d: `M0 0 L${bend.toFixed(1)} ${dy.toFixed(1)} H${across.toFixed(1)}`,
      segments: [
        [c.x, c.y, c.x + bend, c.y + dy],
        [c.x + bend, c.y + dy, c.x + across, c.y + dy],
      ],
    };
  }
  // Slid over the dot (a narrow view): straight up or down to the label's edge.
  const end = dy < 0 ? box.y1 - c.y : box.y0 - c.y;
  return { d: `M0 0 V${end.toFixed(1)}`, segments: [[c.x, c.y, c.x, c.y + end]] };
}

/**
 * Labels that never cover one another.  Each goes beside its dot (right and
 * up, turning left near the right edge and down near the top), slid back
 * inside the view if it would run off it; one that would land on a label
 * already placed — or on a dot — steps past it, up or down, or goes to the
 * other side, whichever moves it least and keeps its leader off the other
 * labels and leaders.  The labels are placed top to bottom, so their order
 * follows the dots'; each leader runs to wherever its label ended up.
 */
function layOutTags(tags: PlacedCallout[], width: number, height: number): void {
  if (tags.length === 0) return;
  const taken: Box[] = tags.map((c) => ({ x0: c.x - DOT_ROOM, y0: c.y - DOT_ROOM, x1: c.x + DOT_ROOM, y1: c.y + DOT_ROOM }));
  const labels: Box[] = [];
  const leaders: Segment[] = [];
  const outside = (box: Box) => Math.max(0, 2 - box.y0) + Math.max(0, box.y1 - (height - 2)) + Math.max(0, 2 - box.x0) + Math.max(0, box.x1 - (width - 2));
  const order = [...tags].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const c of order) {
    const w = c.w || 200;
    const h = c.h || 24;
    const want = c.y + (c.y < CALLOUT_ROOM_Y ? LEAD_Y : -LEAD_Y);
    const right = c.x + LEAD_X + w > width && c.x > width - c.x ? -1 : 1;
    let best: { box: Box; lead: { d: string; segments: Segment[] }; cost: number } | null = null;
    for (const side of [right, -right])
      for (const step of [1, -1]) {
        const beside = side > 0 ? c.x + LEAD_X : c.x - LEAD_X - w;
        const x0 = w < width - 4 ? Math.min(Math.max(beside, 2), width - 2 - w) : beside;
        let cy = want;
        let box: Box = { x0, y0: cy - h / 2, x1: x0 + w, y1: cy + h / 2 };
        for (let k = 0; k < 2 * taken.length + 2; k++) {
          const hit = taken.find((other) => overlaps(box, other));
          if (!hit) break;
          cy = step > 0 ? hit.y1 + CALLOUT_GAP + h / 2 + 0.5 : hit.y0 - CALLOUT_GAP - h / 2 - 0.5;
          box = { x0, y0: cy - h / 2, x1: x0 + w, y1: cy + h / 2 };
        }
        const lead = leaderTo(c, box);
        let tangled = 0;
        for (const segment of lead.segments) {
          for (const label of labels) if (crosses(segment, label)) tangled += 3;
          for (const other of leaders) if (meets(segment, other)) tangled += 1;
        }
        for (const other of leaders) if (crosses(other, box)) tangled += 3;
        const cost =
          Math.abs(cy - want) + Math.abs(x0 - beside) * 0.5 + (side === right ? 0 : 60) + 40 * outside(box) + 70 * tangled + (taken.some((other) => overlaps(box, other)) ? 1e5 : 0);
        if (!best || cost < best.cost) best = { box, lead, cost };
      }
    if (!best) continue;
    const { box, lead } = best;
    taken.push(box);
    labels.push(box);
    leaders.push(...lead.segments);
    if (lead.d !== c.lead) {
      c.lead = lead.d;
      for (const path of c.leaders) path.setAttribute("d", lead.d);
    }
    const dy = (box.y0 + box.y1) / 2 - c.y;
    const spot = `${(box.x0 - c.x).toFixed(1)},${dy.toFixed(1)}`;
    if (spot !== c.spot && c.tag) {
      c.spot = spot;
      c.tag.style.left = `${(box.x0 - c.x).toFixed(1)}px`;
      c.tag.style.top = `${dy.toFixed(1)}px`;
    }
  }
}

export interface ViewerFocus {
  mask: Uint8Array | null;
  mode: FocusMode;
}

/** How much of the rest of the model is left in x-ray mode. */
const XRAY_OPACITY = 0.14;

/** The soft-edge strength, shared by every material of a viewer and changed in place. */
type SoftUniforms = Record<"uSoftEdges", { value: number }>;

function makeMeshMaterial(flat: boolean, layers?: LayerUniforms | null, soft?: SoftUniforms | null): THREE.Material {
  const material = flat
    ? new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  if (layers) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, layers);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float recipe;\nvarying float vRecipe;\nvarying float vHeight;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRecipe = recipe;\nvHeight = position.z;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${LAYER_FRAGMENT_HEAD}`)
        .replace("#include <color_fragment>", LAYER_FRAGMENT_BODY);
    };
    material.customProgramCacheKey = () => "layers";
  } else if (soft) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, soft);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 softColor;\nvarying vec3 vSoftColor;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSoftColor = softColor.rgb;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uSoftEdges;\nvarying vec3 vSoftColor;")
        .replace("#include <color_fragment>", SOFT_COLOUR_FRAGMENT);
    };
    material.customProgramCacheKey = () => "soft";
  }
  return material;
}

// Each face's colour eased toward the colour averaged at its corners: inside
// one colour nothing changes, across a border the two colours meet in a ramp
// one face wide instead of a cut along the triangles.
const SOFT_COLOUR_FRAGMENT = `
#ifdef USE_COLOR
  diffuseColor.rgb *= mix(vColor.rgb, vSoftColor, uSoftEdges);
#endif
`;

/** How far toward the corner-averaged colour the soft view goes (0 = faces as they are). */
const SOFT_EDGE_MIX = 1;

/** Corners of every vertex (a vertex → corners table), shared by the viewers of one model. */
interface VertexCorners {
  cornerVertex: Int32Array;
  offsets: Int32Array;
  corners: Int32Array;
}
const vertexCornersCache = new WeakMap<Int32Array, VertexCorners>();
function vertexCornersFor(cornerVertex: Int32Array): VertexCorners {
  const known = vertexCornersCache.get(cornerVertex);
  if (known) return known;
  let vertexCount = 0;
  for (let c = 0; c < cornerVertex.length; c++) if (cornerVertex[c] >= vertexCount) vertexCount = cornerVertex[c] + 1;
  const offsets = new Int32Array(vertexCount + 1);
  for (let c = 0; c < cornerVertex.length; c++) offsets[cornerVertex[c] + 1]++;
  for (let v = 0; v < vertexCount; v++) offsets[v + 1] += offsets[v];
  const next = offsets.slice(0, vertexCount);
  const corners = new Int32Array(cornerVertex.length);
  for (let c = 0; c < cornerVertex.length; c++) corners[next[cornerVertex[c]]++] = c;
  const table = { cornerVertex, offsets, corners };
  vertexCornersCache.set(cornerVertex, table);
  return table;
}

/**
 * Soft colours are 16-bit with 4 slots per corner (the 4th unused): 3 × 16-bit
 * is a 6-byte vertex format Metal cannot read, and the driver then converted
 * the whole buffer on every change, which made brush strokes stutter.
 */
const SOFT_STRIDE = 4;

/** Writes the mean colour of vertex v's faces into each of its corners (16-bit, 0..1). */
function softenVertex(table: VertexCorners, v: number, colours: Float32Array, out: Uint16Array): void {
  const start = table.offsets[v];
  const end = table.offsets[v + 1];
  if (end === start) return;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = start; i < end; i++) {
    const o = table.corners[i] * 3;
    r += colours[o];
    g += colours[o + 1];
    b += colours[o + 2];
  }
  const inv = 1 / (end - start);
  const qr = Math.round(Math.min(1, r * inv) * 65535);
  const qg = Math.round(Math.min(1, g * inv) * 65535);
  const qb = Math.round(Math.min(1, b * inv) * 65535);
  for (let i = start; i < end; i++) {
    const o = table.corners[i] * SOFT_STRIDE;
    out[o] = qr;
    out[o + 1] = qg;
    out[o + 2] = qb;
  }
}

function softenAll(table: VertexCorners, colours: Float32Array, out: Uint16Array): void {
  const vertexCount = table.offsets.length - 1;
  for (let v = 0; v < vertexCount; v++) softenVertex(table, v, colours, out);
}

/** The soft-edge uniforms when the model's mesh carries the corner-averaged colours. */
function meshSoft(state: ViewerState): SoftUniforms | null {
  return state.geometry?.getAttribute("softColor") ? state.softUniforms : null;
}

type LayerUniforms = Record<"uLayerTable" | "uLayerW" | "uLayerH" | "uZMin" | "uLayerUnits" | "uLayerSoft", { value: unknown }>;

/**
 * Half-width (in layers) of the window each point of a soft layer preview
 * averages over: real layers meet in a rounded seam, not a cut, and the
 * plastic carries a little light into the next layer, so stripes read
 * blended.  0.8 = a 1.6-layer window: on a layer's middle its own filament
 * is 62 %, the ones above and below 19 % each.
 */
const LAYER_SOFT_RADIUS = 0.8;

const LAYER_FRAGMENT_HEAD = `
uniform sampler2D uLayerTable;
uniform float uLayerW;
uniform float uLayerH;
uniform float uZMin;
uniform float uLayerUnits;
uniform float uLayerSoft;
varying float vRecipe;
varying float vHeight;
vec3 layerFilament(float k, float cycle, float rowY) {
  return texture2D(uLayerTable, vec2((mod(k, cycle) + 0.5) / uLayerW, rowY)).rgb;
}
`;
// The layer under this pixel picks a texel of the face's recipe row: the
// print's look when soft, the bare filaments when sharp.  Soft
// seams (uLayerSoft > 0) average the layers over a window around the point,
// never narrower than the pixel's own height so the edge is anti-aliased.  Where a
// layer is thinner than about a pixel the stripes would only alias, so the
// colour eases into the repeat's mean colour instead.
const LAYER_FRAGMENT_BODY = `
  float layerCoord = (vHeight - uZMin) / uLayerUnits;
  float row = floor(vRecipe + 0.5) + (uLayerSoft > 0.0 ? 0.0 : uLayerH);
  float rowY = (row + 0.5) / (2.0 * uLayerH);
  float cycle = max(1.0, floor(texture2D(uLayerTable, vec2(0.5 / uLayerW, rowY)).a * 255.0 + 0.5));
  float k = floor(layerCoord);
  float footprint = fwidth(layerCoord);
  vec3 layerColour = layerFilament(k, cycle, rowY);
  if (uLayerSoft > 0.0) {
    float radius = max(uLayerSoft, 0.5 * footprint);
    vec3 sum = vec3(0.0);
    for (int i = -2; i <= 2; i++) {
      float j = k + float(i);
      float w = max(0.0, min(layerCoord + radius, j + 1.0) - max(layerCoord - radius, j));
      sum += layerFilament(j, cycle, rowY) * w;
    }
    layerColour = sum / (2.0 * radius);
  }
  vec3 meanColour = texture2D(uLayerTable, vec2((uLayerW - 0.5) / uLayerW, rowY)).rgb;
  float blur = smoothstep(0.9, 1.8, footprint);
  diffuseColor.rgb *= mix(layerColour, meanColour, blur);
`;

/** Renders the face index as a colour so a single pixel read identifies the face under the cursor. */
function makePickMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float faceId;
      varying vec3 vId;
      void main() {
        float id = faceId;
        float r = mod(id, 256.0);
        float g = mod(floor(id / 256.0), 256.0);
        float b = floor(id / 65536.0);
        vId = vec3(r, g, b) / 255.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vId;
      void main() { gl_FragColor = vec4(vId, 1.0); }
    `,
  });
}

interface OverlayObjects {
  /** The highlight it was built from: one that is passed again stays as it is. */
  source: HighlightOverlay;
  geometry: OverlayGeometry;
  /** The highlighted faces, tinted for the opening flash. */
  mesh: THREE.Mesh;
  /**
   * The outline: the same faces pushed outward along their smooth normals by a
   * few pixels and drawn back-face only — the cel-shading "inverted hull".
   * Where a face looks at the camera its pushed copy is culled; where the
   * surface turns away, the copy pokes out past the silhouette and that rim is
   * the line.  It is plain geometry drawn every frame, so it follows the
   * camera by construction and is hidden wherever the model is in front.
   */
  hull: THREE.Mesh | null;
  /** A slightly thicker dark shell drawn just before the hull: the rim around a white outline. */
  rimHull: THREE.Mesh | null;
  rimMaterial: THREE.ShaderMaterial | null;
  /** The seam where highlighted faces meet the rest: a band a few pixels wide on screen, lifted off the surface. */
  lines: THREE.Mesh;
  fillMaterial: THREE.MeshBasicMaterial;
  hullMaterial: THREE.ShaderMaterial | null;
  lineMaterial: THREE.ShaderMaterial;
  baseOpacity: number;
  lineOpacity: number;
  pulse: boolean;
  /** When this highlight appeared, for the opening flash. */
  startedAt: number;
}

/** A highlight shape uploaded to the GPU: the faces (fill, hull and rim share them) and the seam. */
interface OverlayGeometry {
  fill: THREE.BufferGeometry;
  /** The seam as one quad per segment (instanced: the segments' own arrays, no copies). */
  lines: THREE.InstancedBufferGeometry;
  /** Highlights showing it right now; only unused shapes are let go. */
  users: number;
  bytes: number;
}

/** GPU memory (bytes) for shapes out of view, so hovering back to a colour does not upload it again. */
const SPARE_OVERLAY_BYTES = 48 * 1024 * 1024;

/**
 * One set per highlight id ("hover", "selected", …), kept as long as the
 * viewer: disposing them let three.js drop the compiled shader programs, and
 * every hover compiled them again.
 */
interface OverlayMaterials {
  fill: THREE.MeshBasicMaterial;
  rim: THREE.ShaderMaterial;
  hull: THREE.ShaderMaterial;
  line: THREE.ShaderMaterial;
}

/** Pixels the outline shell stands off the surface, how far the seam is lifted, and how wide it is on screen. */
const HULL_THICKNESS_PX = 2.5;
const SEAM_LIFT_PX = 0.8;
const SEAM_WIDTH_PX = 3;
/** How far the dark rim stands out past the outline. */
const RIM_EXTRA_PX = 1.5;

/**
 * Moves a vertex along its normal by a fixed number of screen pixels, whatever
 * the distance to the camera: world units per pixel at depth d are
 * 2·d / (P[1][1] · viewportHeight), with P[1][1] = 1 / tan(fov / 2).
 */
const OFFSET_VERTEX_SHADER = `
  uniform float uOffsetPx;
  uniform float uViewportHeight;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    float dist = max(-mv.z, 0.0001);
    float worldPerPixel = 2.0 * dist / (projectionMatrix[1][1] * uViewportHeight);
    mv.xyz += n * worldPerPixel * uOffsetPx;
    gl_Position = projectionMatrix * mv;
  }
`;
/**
 * The seam as a band of fixed width on screen, whatever the patch's size or
 * slope: WebGL draws lines one pixel wide, so a patch lying flat towards the
 * camera (where the shell shows nothing) had only a hairline round it.  Each
 * segment is a quad: its two ends are lifted off the surface, projected, and
 * spread on screen — outwards only, away from the segment's inside corner, so
 * a thin patch (a mouth line) is not covered by its own outline — and a
 * little past the ends, so corners close.  position.x is the end (0 start,
 * 1 end), position.y the edge (-1) or the outer side (1) of the band.
 */
const SEAM_VERTEX_SHADER = `
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute vec3 aNormalStart;
  attribute vec3 aNormalEnd;
  attribute vec3 aInside;
  uniform float uOutside;
  uniform float uLiftPx;
  uniform float uWidthPx;
  uniform float uViewportHeight;
  uniform float uAspect;
  // How far inside the patch the band starts.  Lifted along the surface
  // normal by less than a pixel: on a slope the lift slides the edge sideways
  // by up to as much, and the band starts that much inside, so no hairline of
  // the colour underneath shows between the band and the patch.
  const float SEAM_INSET = 0.8;
  vec4 lifted(vec3 p, vec3 normal) {
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    if (dot(normal, normal) > 0.0) {
      float worldPerPixel = 2.0 * max(-mv.z, 0.0001) / (projectionMatrix[1][1] * uViewportHeight);
      mv.xyz += normalize(normalMatrix * normal) * worldPerPixel * uLiftPx;
    }
    return projectionMatrix * mv;
  }
  void main() {
    vec4 a = lifted(aStart, aNormalStart);
    vec4 b = lifted(aEnd, aNormalEnd);
    vec2 pixels = vec2(uViewportHeight * uAspect, uViewportHeight);
    vec2 along = (b.xy / b.w - a.xy / a.w) * pixels;
    float span = max(length(along), 0.0001);
    vec2 dir = along / span;
    vec2 side = vec2(-dir.y, dir.x);
    vec4 clip = position.x < 0.5 ? a : b;
    vec2 across;
    if (uOutside > 0.5) {
      vec4 c = projectionMatrix * modelViewMatrix * vec4(aInside, 1.0);
      vec2 toInside = (c.xy / c.w - a.xy / a.w) * pixels;
      vec2 outward = (dir.x * toInside.y - dir.y * toInside.x) >= 0.0 ? -side : side;
      across = outward * mix(-SEAM_INSET, uWidthPx, (position.y + 1.0) * 0.5);
    } else {
      across = side * position.y * uWidthPx * 0.5;
    }
    vec2 push = across + dir * (position.x * 2.0 - 1.0) * (uWidthPx * 0.5);
    clip.xy += push / pixels * 2.0 * clip.w;
    gl_Position = clip;
  }
`;

function seamGeometry(edges: Float32Array, normals: Float32Array, inside: Float32Array): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3));
  geometry.setIndex([0, 2, 1, 2, 3, 1]);
  const ends = new THREE.InstancedInterleavedBuffer(edges, 6);
  geometry.setAttribute("aStart", new THREE.InterleavedBufferAttribute(ends, 3, 0));
  geometry.setAttribute("aEnd", new THREE.InterleavedBufferAttribute(ends, 3, 3));
  const lifts = new THREE.InstancedInterleavedBuffer(normals, 6);
  geometry.setAttribute("aNormalStart", new THREE.InterleavedBufferAttribute(lifts, 3, 0));
  geometry.setAttribute("aNormalEnd", new THREE.InterleavedBufferAttribute(lifts, 3, 3));
  geometry.setAttribute("aInside", new THREE.InstancedBufferAttribute(inside, 3));
  geometry.instanceCount = Math.floor(edges.length / 6);
  return geometry;
}

function seamMaterial(colour: THREE.Color, opacity: number, viewport: { value: number }, aspect: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SEAM_VERTEX_SHADER,
    fragmentShader: FLAT_FRAGMENT_SHADER,
    uniforms: {
      uColour: { value: colour.clone() },
      uOpacity: { value: opacity },
      uLiftPx: { value: SEAM_LIFT_PX },
      uOutside: { value: 1 },
      uWidthPx: { value: SEAM_WIDTH_PX },
      uViewportHeight: viewport,
      uAspect: aspect,
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// The colour goes out the way the built-in materials' does (sRGB), so a
// highlight colour shows as written: without it #9aa0ff came out as #525aff.
const FLAT_FRAGMENT_SHADER = `
  uniform vec3 uColour;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColour, uOpacity);
    #include <colorspace_fragment>
  }
`;

function offsetMaterial(
  colour: THREE.Color,
  opacity: number,
  offsetPx: number,
  viewport: { value: number },
  side: THREE.Side,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: OFFSET_VERTEX_SHADER,
    fragmentShader: FLAT_FRAGMENT_SHADER,
    uniforms: {
      uColour: { value: colour.clone() },
      uOpacity: { value: opacity },
      uOffsetPx: { value: offsetPx },
      uViewportHeight: viewport,
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side,
  });
}

interface ViewerState {
  /** Uniforms of the layer preview while it is on (shared by the material, updated in place). */
  layerUniforms: LayerUniforms | null;
  softUniforms: SoftUniforms;
  /** Vertex → corners of the model shown, when the soft colour borders are available. */
  softTable: VertexCorners | null;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: THREE.Mesh | null;
  geometry: THREE.BufferGeometry | null;
  faceCount: number;
  overlayGroup: THREE.Group;
  overlays: OverlayObjects[];
  /** Uploaded shapes by their face array, most recently used last. */
  overlayShapes: Map<Float32Array, OverlayGeometry>;
  overlayMaterials: Map<string, OverlayMaterials>;
  /** The highlighted faces drawn on their own (solo / x-ray), or null. */
  focusMesh: THREE.Mesh | null;
  /** Faces of the focus mesh, while it is shown. */
  focusMask: Uint8Array | null;
  /** Faces painted since the colours last arrived, drawn over the model. */
  stroke: StrokePreview | null;
  /** Tags over picked patches, placed after every frame. */
  callouts: PlacedCallout[];
  cursorGroup: THREE.Group;
  cursorLine: THREE.LineLoop;
  pickMaterial: THREE.ShaderMaterial;
  pickTarget: THREE.WebGLRenderTarget | null;
  /** Viewport height in CSS pixels, shared by every outline material. */
  outlineViewport: { value: number };
  /** Width / height of the view, shared by the seam materials. */
  outlineAspect: { value: number };
  needsRender: boolean;
  raf: number | null;
  pulseRaf: number | null;
  bounds: { center: THREE.Vector3; radius: number } | null;
}

export const VIEW_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  iso: [-0.72, -1.0, 0.68],
};

/**
 * Faces painted in a stroke, as a small mesh of their own drawn over the model
 * until the new colours arrive as a whole.  Writing them into the model's own
 * buffers (a million faces) mid-stroke kept the GPU busy copying those buffers,
 * and the pick after every move waited 30–160 ms for it: the brush stuttered.
 */
interface StrokePreview {
  mesh: THREE.Mesh;
  /** Preview slot + 1 of every model face (0 = not in the preview). */
  slotOf: Int32Array;
  count: number;
  capacity: number;
}

const STROKE_PREVIEW_START = 8192;

/** Room for `capacity` faces of every attribute the model's mesh has, keeping the first `count` of `old`. */
function strokePreviewGeometry(source: THREE.BufferGeometry, capacity: number, old: THREE.BufferGeometry | null, count: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name === "faceId") continue;
    const { itemSize, normalized } = attribute as THREE.BufferAttribute;
    const Typed = attribute.array.constructor as Float32ArrayConstructor;
    const array = new Typed(capacity * 3 * itemSize);
    const previous = old?.getAttribute(name);
    if (previous && count > 0) array.set((previous.array as Float32Array).subarray(0, count * 3 * itemSize));
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized));
  }
  geometry.setDrawRange(0, count * 3);
  return geometry;
}

/** Copies faces (their new colours already in the model's arrays) into the stroke preview. */
function addToStrokePreview(state: ViewerState, faces: ArrayLike<number>): void {
  const source = state.geometry;
  if (!source || !state.mesh) return;
  let preview = state.stroke;
  if (!preview) {
    const mesh = new THREE.Mesh(strokePreviewGeometry(source, STROKE_PREVIEW_START, null, 0), state.mesh.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    state.scene.add(mesh);
    preview = { mesh, slotOf: new Int32Array(state.faceCount), count: 0, capacity: STROKE_PREVIEW_START };
    state.stroke = preview;
  }
  // Solo / x-ray: only the faces drawn on their own show the paint.
  const shown = state.focusMask;
  let added = 0;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (f < state.faceCount && preview.slotOf[f] === 0 && (!shown || shown[f])) added++;
  }
  if (preview.count + added > preview.capacity) {
    const capacity = Math.max(preview.count + added, preview.capacity * 2);
    const old = preview.mesh.geometry;
    preview.mesh.geometry = strokePreviewGeometry(source, capacity, old, preview.count);
    old.dispose();
    preview.capacity = capacity;
  }
  const geometry = preview.mesh.geometry;
  const pairs = Object.keys(geometry.attributes).map((name) => ({
    from: source.getAttribute(name) as THREE.BufferAttribute,
    to: geometry.getAttribute(name) as THREE.BufferAttribute,
  }));
  const start = preview.count;
  for (const { to } of pairs) to.clearUpdateRanges();
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (f >= state.faceCount || (shown && !shown[f])) continue;
    let slot = preview.slotOf[f] - 1;
    const fresh = slot < 0;
    if (fresh) {
      slot = preview.count++;
      preview.slotOf[f] = slot + 1;
    }
    for (const { from, to } of pairs) {
      const size = 3 * to.itemSize;
      (to.array as Float32Array).set((from.array as Float32Array).subarray(f * size, (f + 1) * size), slot * size);
      if (!fresh) to.addUpdateRange(slot * size, size);
    }
  }
  for (const { to } of pairs) {
    if (preview.count > start) to.addUpdateRange(start * 3 * to.itemSize, (preview.count - start) * 3 * to.itemSize);
    to.needsUpdate = true;
  }
  geometry.setDrawRange(0, preview.count * 3);
}

/**
 * Removes the stroke preview.  With `flush` the model's own colour buffers are
 * sent again (they hold the painted colours already) — for when the preview
 * goes without new colours to replace it.
 */
function dropStrokePreview(state: ViewerState, flush: boolean): void {
  const preview = state.stroke;
  if (!preview) return;
  state.scene.remove(preview.mesh);
  preview.mesh.geometry.dispose();
  state.stroke = null;
  if (!flush || !state.geometry) return;
  for (const name of ["color", "softColor"]) {
    const attribute = state.geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!attribute) continue;
    attribute.clearUpdateRanges();
    attribute.needsUpdate = true;
  }
}

function requestRender(state: ViewerState): void {
  state.needsRender = true;
  if (state.raf !== null) return;
  state.raf = window.requestAnimationFrame(() => {
    state.raf = null;
    if (!state.needsRender) return;
    state.needsRender = false;
    // The paint is drawn with whatever material shows those faces now.
    const under = state.focusMesh ?? state.mesh;
    if (state.stroke && under) state.stroke.mesh.material = under.material;
    state.renderer.render(state.scene, state.camera);
    placeCallouts(state);
    // Camera position, readable from outside (debugging / tests).
    const p = state.camera.position;
    state.renderer.domElement.dataset.camera = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
  });
}

function fitCamera(state: ViewerState, view: ViewName): void {
  const bounds = state.bounds;
  if (!bounds) return;
  const dir = new THREE.Vector3(...VIEW_DIRECTIONS[view]);
  // A camera exactly on the orbit pole (straight top/bottom view with Z up) cannot be tilted by
  // dragging: OrbitControls clamps the polar angle there. Nudge those views 2° towards the front.
  if (Math.abs(dir.z) > 0.999 * dir.length()) dir.y -= 0.035 * dir.length();
  dir.normalize();
  const fov = (state.camera.fov * Math.PI) / 180;
  const distance = (bounds.radius / Math.sin(fov / 2)) * 1.12;
  state.camera.position.copy(bounds.center).addScaledVector(dir, distance);
  state.camera.up.set(0, 0, 1);
  state.controls.target.copy(bounds.center);
  state.controls.update();
  fitClipPlanes(state);
  requestRender(state);
}

/**
 * Near and far planes around the model, from where the camera is now.  They
 * used to be set once at the fitted distance, so zooming out pushed the back
 * of the model past the far plane and it was cut away as if by a wall.
 */
function fitClipPlanes(state: ViewerState): void {
  const bounds = state.bounds;
  if (!bounds) return;
  const distance = state.camera.position.distanceTo(bounds.center);
  const near = Math.max(bounds.radius * 0.002, distance - bounds.radius * 2);
  const far = distance + bounds.radius * 2;
  if (near === state.camera.near && far === state.camera.far) return;
  state.camera.near = near;
  state.camera.far = far;
  state.camera.updateProjectionMatrix();
}

function overlayShapeFor(state: ViewerState, overlay: HighlightOverlay): OverlayGeometry {
  const known = state.overlayShapes.get(overlay.fill);
  if (known) {
    state.overlayShapes.delete(overlay.fill);
    state.overlayShapes.set(overlay.fill, known);
    known.users++;
    return known;
  }
  const fill = new THREE.BufferGeometry();
  fill.setAttribute("position", new THREE.BufferAttribute(overlay.fill, 3));
  // The outline shell needs normals; a highlight built without them gets the seam line only.
  if (overlay.fillNormals && overlay.fillNormals.length === overlay.fill.length) fill.setAttribute("normal", new THREE.BufferAttribute(overlay.fillNormals, 3));
  const edgeNormals =
    overlay.edgeNormals && overlay.edgeNormals.length === overlay.edges.length ? overlay.edgeNormals : new Float32Array(overlay.edges.length);
  const knowsInside = Boolean(overlay.edgeInside && overlay.edgeInside.length * 2 === overlay.edges.length);
  const lines = seamGeometry(overlay.edges, edgeNormals, knowsInside ? (overlay.edgeInside as Float32Array) : new Float32Array(overlay.edges.length / 2));
  lines.userData.outside = knowsInside;
  // three.js sorts see-through objects by their bounding sphere and would work
  // it out over every corner of the shape; the highlight lies on the model, so
  // the model's sphere does.
  if (state.geometry) {
    if (!state.geometry.boundingSphere) state.geometry.computeBoundingSphere();
    fill.boundingSphere = state.geometry.boundingSphere?.clone() ?? null;
    lines.boundingSphere = fill.boundingSphere?.clone() ?? null;
  }
  const shape = { fill, lines, users: 1, bytes: overlay.fill.byteLength * 2 + overlay.edges.byteLength * 2 };
  state.overlayShapes.set(overlay.fill, shape);
  return shape;
}

function trimOverlayShapes(state: ViewerState, keepBytes: number): void {
  let spare = 0;
  for (const shape of state.overlayShapes.values()) if (shape.users === 0) spare += shape.bytes;
  for (const [key, shape] of state.overlayShapes) {
    if (spare <= keepBytes) break;
    if (shape.users > 0) continue;
    shape.fill.dispose();
    shape.lines.dispose();
    state.overlayShapes.delete(key);
    spare -= shape.bytes;
  }
}

function overlayMaterialsFor(state: ViewerState, id: string): OverlayMaterials {
  let materials = state.overlayMaterials.get(id);
  if (!materials) {
    const fill = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    fill.toneMapped = false;
    const white = new THREE.Color(0xffffff);
    materials = {
      fill,
      // Drawn first and a little thicker, so it shows only outside the outline.
      rim: offsetMaterial(white, 1, HULL_THICKNESS_PX + RIM_EXTRA_PX, state.outlineViewport, THREE.BackSide),
      hull: offsetMaterial(white, 1, HULL_THICKNESS_PX, state.outlineViewport, THREE.BackSide),
      line: seamMaterial(white, 1, state.outlineViewport, state.outlineAspect),
    };
    state.overlayMaterials.set(id, materials);
  }
  return materials;
}

function buildOverlay(state: ViewerState, overlay: HighlightOverlay): OverlayObjects {
  const geometry = overlayShapeFor(state, overlay);
  const materials = overlayMaterialsFor(state, overlay.id);
  const colour = new THREE.Color(overlay.colour);
  const lineColour = overlay.line ? new THREE.Color(overlay.line) : colour;
  const baseOpacity = overlay.opacity ?? 0.5;
  const lineOpacity = overlay.lineOpacity ?? 0.9;
  materials.fill.color.copy(colour);
  materials.fill.opacity = baseOpacity;
  const mesh = new THREE.Mesh(geometry.fill, materials.fill);
  mesh.renderOrder = 2;
  let hull: THREE.Mesh | null = null;
  let rimHull: THREE.Mesh | null = null;
  if (geometry.fill.getAttribute("normal")) {
    if (overlay.rim) {
      materials.rim.uniforms.uColour.value.set(overlay.rim);
      materials.rim.uniforms.uOpacity.value = lineOpacity * 0.8;
      rimHull = new THREE.Mesh(geometry.fill, materials.rim);
      rimHull.renderOrder = 2.5;
    }
    materials.hull.uniforms.uColour.value.copy(lineColour);
    materials.hull.uniforms.uOpacity.value = lineOpacity;
    hull = new THREE.Mesh(geometry.fill, materials.hull);
    hull.renderOrder = 3;
  }
  materials.line.uniforms.uColour.value.copy(lineColour);
  materials.line.uniforms.uOpacity.value = lineOpacity;
  materials.line.uniforms.uOutside.value = geometry.lines.userData.outside ? 1 : 0;
  const lines = new THREE.Mesh(geometry.lines, materials.line);
  lines.renderOrder = 4;
  for (const object of [rimHull, hull, mesh, lines]) {
    if (!object) continue;
    // It lies on the model, which is always in view.
    object.frustumCulled = false;
    state.overlayGroup.add(object);
  }
  return {
    source: overlay,
    geometry,
    mesh,
    hull,
    rimHull,
    rimMaterial: rimHull ? materials.rim : null,
    lines,
    fillMaterial: materials.fill,
    hullMaterial: hull ? materials.hull : null,
    lineMaterial: materials.line,
    baseOpacity,
    lineOpacity,
    pulse: overlay.pulse !== false,
    startedAt: performance.now(),
  };
}

function removeOverlay(state: ViewerState, overlay: OverlayObjects): void {
  state.overlayGroup.remove(overlay.mesh, overlay.lines);
  if (overlay.hull) state.overlayGroup.remove(overlay.hull);
  if (overlay.rimHull) state.overlayGroup.remove(overlay.rimHull);
  overlay.geometry.users--;
}

function disposeOverlays(state: ViewerState): void {
  for (const overlay of state.overlays) removeOverlay(state, overlay);
  state.overlays = [];
  trimOverlayShapes(state, 0);
  for (const materials of state.overlayMaterials.values()) {
    materials.fill.dispose();
    materials.rim.dispose();
    materials.hull.dispose();
    materials.line.dispose();
  }
  state.overlayMaterials.clear();
  if (state.pulseRaf !== null) {
    window.cancelAnimationFrame(state.pulseRaf);
    state.pulseRaf = null;
  }
}

/**
 * A highlight opens with two full flashes of the whole area — down to nothing
 * each time, so the colour underneath is plain to see — and then leaves the
 * area clear and keeps only the outline breathing.  A tint that never lifts
 * hides the very colour the highlight is pointing at.
 */
const FLASH_PERIOD_MS = 620;
const FLASH_COUNT = 2;

/**
 * Runs only while a highlight is flashing.  Once the flashes are over the
 * outline is set to its resting strength and the loop stops: a loop that
 * kept "breathing" re-rendered a million-triangle scene sixty times a second
 * in every viewer, and that is what made rotating choppy with a selection on.
 * From then on the viewer draws only when something actually changes.
 */
function startPulse(state: ViewerState): void {
  if (state.pulseRaf !== null) return;
  const tick = (time: number) => {
    state.pulseRaf = null;
    const pulsing = state.overlays.filter((overlay) => overlay.pulse);
    if (pulsing.length === 0) return;
    let stillFlashing = false;
    for (const overlay of pulsing) {
      const elapsed = time - overlay.startedAt;
      const flashing = elapsed < FLASH_PERIOD_MS * FLASH_COUNT;
      if (flashing) stillFlashing = true;
      const fill = flashing
        ? overlay.baseOpacity * (0.5 - 0.5 * Math.cos((elapsed / FLASH_PERIOD_MS) * Math.PI * 2))
        : 0;
      overlay.fillMaterial.opacity = fill;
      overlay.mesh.visible = fill > 0.004;
      // The outline fades in over the first flash and then holds.
      const outline = overlay.lineOpacity * Math.min(1, 0.4 + (0.6 * elapsed) / FLASH_PERIOD_MS);
      overlay.lineMaterial.uniforms.uOpacity.value = outline;
      if (overlay.hullMaterial) overlay.hullMaterial.uniforms.uOpacity.value = outline;
      if (overlay.rimMaterial) overlay.rimMaterial.uniforms.uOpacity.value = outline * 0.8;
    }
    requestRender(state);
    if (stillFlashing) state.pulseRaf = window.requestAnimationFrame(tick);
  };
  state.pulseRaf = window.requestAnimationFrame(tick);
}

/** Face under a client-space point via an id render pass, plus the exact surface point. */
function gpuPick(state: ViewerState, clientX: number, clientY: number): ViewerHit | null {
  const { renderer, mesh, geometry, camera } = state;
  if (!mesh || !geometry) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const dpr = renderer.getPixelRatio();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  const x = Math.floor((clientX - rect.left) * dpr);
  const y = Math.floor((rect.bottom - clientY) * dpr);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  if (!state.pickTarget || state.pickTarget.width !== width || state.pickTarget.height !== height) {
    state.pickTarget?.dispose();
    state.pickTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, stencilBuffer: false });
    state.pickTarget.scissorTest = true;
  }
  // Only the pixel under the pointer is cleared and drawn: picking now runs on
  // every pointer move (to show what a click would take), not just on clicks.
  state.pickTarget.scissor.set(x, y, 1, 1);
  const previousMaterial = mesh.material;
  const previousClear = renderer.getClearColor(new THREE.Color());
  const previousAlpha = renderer.getClearAlpha();
  mesh.material = state.pickMaterial;
  // Solo shows only the focus mesh: its faces carry their ids in the model, so
  // it is picked with the same material.  (Drawn as it looks, its colours
  // read as face ids, and solo picked — and painted — the wrong faces.)
  // X-ray picks the model as usual, the faces in front.
  const focus = state.focusMesh;
  const focusMaterial = focus?.material;
  const solo = focus !== null && !mesh.visible;
  if (focus) {
    if (solo) focus.material = state.pickMaterial;
    else focus.visible = false;
  }
  state.overlayGroup.visible = false;
  state.cursorGroup.visible = false;
  if (state.stroke) state.stroke.mesh.visible = false;
  renderer.setRenderTarget(state.pickTarget);
  renderer.setClearColor(0xffffff, 1);
  renderer.clear();
  renderer.render(state.scene, camera);
  const pixel = new Uint8Array(4);
  renderer.readRenderTargetPixels(state.pickTarget, x, y, 1, 1, pixel);
  renderer.setRenderTarget(null);
  renderer.setClearColor(previousClear, previousAlpha);
  mesh.material = previousMaterial;
  if (focus && focusMaterial) {
    focus.material = focusMaterial;
    focus.visible = true;
  }
  state.overlayGroup.visible = true;
  state.cursorGroup.visible = true;
  if (state.stroke) state.stroke.mesh.visible = true;
  const id = pixel[0] + pixel[1] * 256 + pixel[2] * 65536;
  if (id === 0xffffff || id >= state.faceCount) return null;

  const positions = (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const o = id * 9;
  const a = new THREE.Vector3(positions[o], positions[o + 1], positions[o + 2]);
  const b = new THREE.Vector3(positions[o + 3], positions[o + 4], positions[o + 5]);
  const c = new THREE.Vector3(positions[o + 6], positions[o + 7], positions[o + 8]);
  const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
  const point = raycaster.ray.intersectTriangle(a, b, c, false, new THREE.Vector3()) ?? a.clone().add(b).add(c).multiplyScalar(1 / 3);
  return { faceIndex: id, point: [point.x, point.y, point.z], normal: [normal.x, normal.y, normal.z] };
}

function makeCursorLine(): THREE.LineLoop {
  const segments = 64;
  const points = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points[i * 3] = Math.cos(angle);
    points[i * 3 + 1] = Math.sin(angle);
    points[i * 3 + 2] = 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color: 0x9aa0ff, transparent: true, opacity: 0.95, depthTest: false });
  material.toneMapped = false;
  const line = new THREE.LineLoop(geometry, material);
  line.renderOrder = 20;
  line.visible = false;
  return line;
}

export const MeshViewer = forwardRef<MeshViewerHandle, MeshViewerProps>(function MeshViewer(
  { positions, colours, view, fitNonce, overlays, onPick, label, labelTools, emptyLabel, className, flat = false, brush = false, eyedropper = false, background = DEFAULT_BACKGROUND, onHoverFace, onBrushHover, onBrushStart, onBrushDrag, onBrushEnd, focus, callouts, layers, softEdges = true, cornerVertex = null },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const calloutLayerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<ViewerState | null>(null);
  const callbacksRef = useRef({ onPick, onHoverFace, onBrushHover, onBrushStart, onBrushDrag, onBrushEnd });
  callbacksRef.current = { onPick, onHoverFace, onBrushHover, onBrushStart, onBrushDrag, onBrushEnd };
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const softEdgesRef = useRef(softEdges);
  softEdgesRef.current = softEdges;
  const cornerVertexRef = useRef(cornerVertex);
  cornerVertexRef.current = cornerVertex;
  const layersRef = useRef(layers ?? null);
  layersRef.current = layers ?? null;
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const eyedropperRef = useRef(eyedropper);
  eyedropperRef.current = eyedropper;

  /**
   * Recolour faces in place, `colourOf(i)` giving face `faces[i]` its linear
   * colour.  Into the model's arrays (so a later full upload carries the
   * paint) but not sent to the GPU: the stroke preview shows these faces until
   * the new colours arrive.
   */
  function paintFaces(faces: ArrayLike<number>, colourOf: (i: number) => number[]): void {
    const state = stateRef.current;
    if (!state?.geometry) return;
    const attribute = state.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!attribute) return;
    const array = attribute.array as Float32Array;
    for (let i = 0; i < faces.length; i++) {
      const o = faces[i] * 9;
      if (o + 9 > array.length) continue;
      const [r, g, b] = colourOf(i);
      for (let k = 0; k < 3; k++) {
        array[o + k * 3] = r;
        array[o + k * 3 + 1] = g;
        array[o + k * 3 + 2] = b;
      }
    }
    // The soft borders around the paint, worked out again for the corners
    // it touches; the faces on the other side of those corners join the
    // preview, so the paint shows with its soft edge while it is laid.
    const soft = state.geometry.getAttribute("softColor") as THREE.BufferAttribute | undefined;
    const table = state.softTable;
    let shown: ArrayLike<number> = faces;
    if (soft && table) {
      const out = soft.array as Uint16Array;
      const vertices = new Set<number>();
      for (let i = 0; i < faces.length; i++) {
        const c = faces[i] * 3;
        if (c + 3 > table.cornerVertex.length) continue;
        vertices.add(table.cornerVertex[c]);
        vertices.add(table.cornerVertex[c + 1]);
        vertices.add(table.cornerVertex[c + 2]);
      }
      const around = new Set<number>();
      for (const v of vertices) {
        softenVertex(table, v, array, out);
        for (let j = table.offsets[v]; j < table.offsets[v + 1]; j++) around.add((table.corners[j] / 3) | 0);
      }
      shown = Int32Array.from(around);
    }
    addToStrokePreview(state, shown);
    requestRender(state);
  }

  useImperativeHandle(
    ref,
    () => ({
      setFaceColours(faces, rgb) {
        const linear = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
        paintFaces(faces, () => linear);
      },
      setFaceColourList(faces, rgbs) {
        const linear = [0, 0, 0];
        paintFaces(faces, (i) => {
          linear[0] = srgbToLinear(rgbs[i * 3]);
          linear[1] = srgbToLinear(rgbs[i * 3 + 1]);
          linear[2] = srgbToLinear(rgbs[i * 3 + 2]);
          return linear;
        });
      },
      setBrushCursor(cursor) {
        const state = stateRef.current;
        if (!state) return;
        const line = state.cursorLine;
        if (!cursor) {
          if (line.visible) {
            line.visible = false;
            requestRender(state);
          }
          return;
        }
        // Red circle where the stroke would do nothing, so a brush held to a
        // selection says so at the cursor instead of in the status bar.
        (line.material as THREE.LineBasicMaterial).color.set(cursor.blocked ? 0xef6f6f : 0x9aa0ff);
        const normal = new THREE.Vector3(...cursor.normal);
        if (normal.lengthSq() === 0) normal.set(0, 0, 1);
        normal.normalize();
        line.position.set(cursor.point[0], cursor.point[1], cursor.point[2]).addScaledVector(normal, cursor.radius * 0.02);
        line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        line.scale.setScalar(Math.max(1e-6, cursor.radius));
        line.visible = true;
        requestRender(state);
      },
      viewDirection() {
        const state = stateRef.current;
        if (!state) return [0, 0, -1];
        const dir = new THREE.Vector3();
        state.camera.getWorldDirection(dir);
        return [dir.x, dir.y, dir.z];
      },
      cameraPose() {
        const state = stateRef.current;
        if (!state?.bounds) return null;
        const { camera, controls } = state;
        const fit = (state.bounds.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.12;
        const distance = camera.position.distanceTo(controls.target);
        return {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
          up: [camera.up.x, camera.up.y, camera.up.z],
          fov: camera.fov,
          aspect: camera.aspect,
          zoom: distance > 0 ? fit / distance : 1,
        };
      },
      focusOn(point) {
        const state = stateRef.current;
        if (!state) return;
        const target = new THREE.Vector3(point[0], point[1], point[2]);
        const delta = target.clone().sub(state.controls.target);
        state.camera.position.add(delta);
        state.controls.target.copy(target);
        state.controls.update();
        requestRender(state);
      },
    }),
    [],
  );

  // Create the renderer once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Transparent canvas: the host element behind it carries the (checkerboard) background.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-1.2, -2.0, 2.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(2.0, 1.5, -1.0);
    scene.add(fill);
    const overlayGroup = new THREE.Group();
    scene.add(overlayGroup);
    const cursorGroup = new THREE.Group();
    const cursorLine = makeCursorLine();
    cursorGroup.add(cursorLine);
    scene.add(cursorGroup);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;

    const state: ViewerState = {
      renderer,
      scene,
      camera,
      controls,
      mesh: null,
      geometry: null,
      faceCount: 0,
      overlayGroup,
      overlays: [],
      overlayShapes: new Map(),
      overlayMaterials: new Map(),
      focusMesh: null,
      focusMask: null,
      stroke: null,
      callouts: [],
      cursorGroup,
      cursorLine,
      pickMaterial: makePickMaterial(),
      pickTarget: null,
      outlineViewport: { value: 1 },
      outlineAspect: { value: 1 },
      needsRender: false,
      raf: null,
      pulseRaf: null,
      bounds: null,
      layerUniforms: null,
      softUniforms: { uSoftEdges: { value: softEdgesRef.current ? SOFT_EDGE_MIX : 0 } },
      softTable: null,
    };
    stateRef.current = state;
    controls.addEventListener("change", () => {
      fitClipPlanes(state);
      requestRender(state);
    });

    // Click = pick (when the pointer did not move); brush mode = paint while the left button is down.
    let down: { x: number; y: number; time: number } | null = null;
    let lastClick: { face: number | null; time: number } | null = null;
    let brushDown = false;
    let pendingMove: { x: number; y: number; drag: boolean } | null = null;
    let moveRaf: number | null = null;
    // Outside the brush the pointer reports the face under it, at most once a
    // frame and only when it changes; a drag (rotating) reports null once.
    let hoverFace: number | null = null;
    const reportHover = (face: number | null) => {
      if (face === hoverFace) return;
      hoverFace = face;
      callbacksRef.current.onHoverFace?.(face);
    };
    const flushMove = () => {
      moveRaf = null;
      const move = pendingMove;
      pendingMove = null;
      if (!move) return;
      const hit = gpuPick(state, move.x, move.y);
      if (!brushRef.current) {
        reportHover(hit ? hit.faceIndex : null);
        return;
      }
      hoverFace = null;
      // Only the brush circle is shown while the pointer is on the surface.
      if (!eyedropperRef.current) renderer.domElement.style.cursor = hit ? "none" : "crosshair";
      if (move.drag) callbacksRef.current.onBrushDrag?.(hit);
      else callbacksRef.current.onBrushHover?.(hit);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (brushRef.current && event.button === 0 && !event.altKey && !eyedropperRef.current) {
        brushDown = true;
        renderer.domElement.setPointerCapture(event.pointerId);
        callbacksRef.current.onBrushStart?.(gpuPick(state, event.clientX, event.clientY));
        return;
      }
      down = { x: event.clientX, y: event.clientY, time: performance.now() };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!brushRef.current) {
        if (!callbacksRef.current.onHoverFace || !state.mesh) return;
        if (event.buttons !== 0) {
          pendingMove = null;
          reportHover(null);
          return;
        }
      }
      pendingMove = { x: event.clientX, y: event.clientY, drag: brushDown };
      if (moveRaf === null) moveRaf = window.requestAnimationFrame(flushMove);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (brushDown && event.button === 0) {
        brushDown = false;
        pendingMove = null;
        callbacksRef.current.onBrushEnd?.();
        return;
      }
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      const elapsed = performance.now() - down.time;
      down = null;
      if (moved > 5 || elapsed > 600 || event.button !== 0) return;
      const handler = callbacksRef.current.onPick;
      if (!handler || !state.mesh) return;
      const hit = gpuPick(state, event.clientX, event.clientY);
      const face = hit ? hit.faceIndex : null;
      const now = performance.now();
      const double = face !== null && lastClick !== null && lastClick.face === face && now - lastClick.time < 400;
      lastClick = double ? null : { face, time: now };
      handler(face, { double, toggle: event.shiftKey || event.ctrlKey || event.metaKey, alt: event.altKey || eyedropperRef.current, source: "3d" });
    };
    const onPointerLeave = () => {
      pendingMove = null;
      reportHover(null);
      if (brushRef.current) {
        callbacksRef.current.onBrushHover?.(null);
        if (!eyedropperRef.current) renderer.domElement.style.cursor = "crosshair";
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      // A hidden viewer (another step's) keeps its size, and an unchanged size
      // is left alone: each setSize makes a new drawing buffer, a sixth of a
      // second on a big canvas, and step changes used to do it twice per viewer.
      if (width === 0 || height === 0) return;
      const current = renderer.getSize(new THREE.Vector2());
      if (current.x !== width || current.y !== height) {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        state.outlineViewport.value = height;
        state.outlineAspect.value = width / height;
      }
      requestRender(state);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      observer.disconnect();
      if (moveRaf !== null) window.cancelAnimationFrame(moveRaf);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      disposeOverlays(state);
      dropStrokePreview(state, false);
      controls.dispose();
      state.geometry?.dispose();
      (state.mesh?.material as THREE.Material | undefined)?.dispose();
      state.pickMaterial.dispose();
      state.pickTarget?.dispose();
      cursorLine.geometry.dispose();
      (cursorLine.material as THREE.Material).dispose();
      if (state.focusMesh) {
        state.focusMesh.geometry.dispose();
        (state.focusMesh.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, []);

  // Brush mode: the left button paints, so rotate with the right button instead.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.controls.mouseButtons = brush
      ? { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    state.renderer.domElement.style.cursor = eyedropper ? "cell" : brush ? "crosshair" : "";
    if (!brush && state.cursorLine.visible) {
      state.cursorLine.visible = false;
      requestRender(state);
    }
  }, [brush, eyedropper]);

  // Geometry from positions.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    dropStrokePreview(state, false);
    if (state.mesh) {
      state.scene.remove(state.mesh);
      state.geometry?.dispose();
      (state.mesh.material as THREE.Material).dispose();
      state.mesh = null;
      state.geometry = null;
      state.faceCount = 0;
      state.bounds = null;
      state.softTable = null;
    }
    if (!positions || positions.length === 0) {
      requestRender(state);
      return;
    }
    const faceCount = positions.length / 9;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    // A copy: later colour changes are written into this array in place, and it
    // must not be the caller's own buffer (that would overwrite, say, the
    // palette colours with a drag preview and leave them that way).
    const colourArray = colours && colours.length === positions.length ? colours.slice() : new Float32Array(positions.length).fill(0.6);
    geometry.setAttribute("color", new THREE.BufferAttribute(colourArray, 3));
    const ids = new Float32Array(faceCount * 3);
    for (let i = 0; i < faceCount; i++) {
      ids[i * 3] = i;
      ids[i * 3 + 1] = i;
      ids[i * 3 + 2] = i;
    }
    geometry.setAttribute("faceId", new THREE.BufferAttribute(ids, 1));
    const corners = cornerVertexRef.current;
    state.softTable = corners && corners.length * 3 === positions.length ? vertexCornersFor(corners) : null;
    if (state.softTable) {
      const soft = new Uint16Array((positions.length / 3) * SOFT_STRIDE);
      softenAll(state.softTable, colourArray, soft);
      geometry.setAttribute("softColor", new THREE.BufferAttribute(soft, SOFT_STRIDE, true));
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    state.bounds = sphere ? { center: sphere.center.clone(), radius: Math.max(1e-3, sphere.radius) } : null;
    const material = makeMeshMaterial(flatRef.current, state.layerUniforms, state.softTable ? state.softUniforms : null);
    const mesh = new THREE.Mesh(geometry, material);
    state.scene.add(mesh);
    state.mesh = mesh;
    state.geometry = geometry;
    state.faceCount = faceCount;
    fitCamera(state, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  // Layer preview: the recipe of every face as a vertex attribute and the
  // recipes as a small texture; the material switches when it turns on or off.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    // The preview's copy of the recipes would go stale.
    dropStrokePreview(state, true);
    const geometry = state.geometry;
    const wasOn = state.layerUniforms !== null;
    const usable = layers && geometry && layers.recipeOfVertex.length * 3 === (geometry.getAttribute("position")?.array.length ?? -1);
    if (usable && layers && geometry) {
      geometry.setAttribute("recipe", new THREE.BufferAttribute(layers.recipeOfVertex, 1));
      const texture = new THREE.DataTexture(layers.table, layers.width, layers.height * 2, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      if (state.layerUniforms) {
        (state.layerUniforms.uLayerTable.value as THREE.Texture | null)?.dispose();
        state.layerUniforms.uLayerTable.value = texture;
        state.layerUniforms.uLayerW.value = layers.width;
        state.layerUniforms.uLayerH.value = layers.height;
        state.layerUniforms.uZMin.value = layers.zMin;
        state.layerUniforms.uLayerUnits.value = layers.layerUnits;
      } else {
        state.layerUniforms = {
          uLayerTable: { value: texture },
          uLayerW: { value: layers.width },
          uLayerH: { value: layers.height },
          uZMin: { value: layers.zMin },
          uLayerUnits: { value: layers.layerUnits },
          uLayerSoft: { value: softEdgesRef.current ? LAYER_SOFT_RADIUS : 0 },
        };
      }
    } else if (state.layerUniforms) {
      (state.layerUniforms.uLayerTable.value as THREE.Texture | null)?.dispose();
      state.layerUniforms = null;
      geometry?.deleteAttribute("recipe");
    }
    if (state.mesh && wasOn !== (state.layerUniforms !== null)) {
      const old = state.mesh.material as THREE.Material;
      state.mesh.material = makeMeshMaterial(flatRef.current, state.layerUniforms, meshSoft(state));
      old.dispose();
    }
    requestRender(state);
  }, [layers, positions]);

  // Soft or sharp edges: uniforms, no new material.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.softUniforms.uSoftEdges.value = softEdges ? SOFT_EDGE_MIX : 0;
    if (state.layerUniforms) state.layerUniforms.uLayerSoft.value = softEdges ? LAYER_SOFT_RADIUS : 0;
    requestRender(state);
  }, [softEdges]);

  // Flat (unlit) vs shaded material.
  useEffect(() => {
    const state = stateRef.current;
    if (!state?.mesh) return;
    const old = state.mesh.material as THREE.Material;
    state.mesh.material = makeMeshMaterial(flat, state.layerUniforms, meshSoft(state));
    old.dispose();
    requestRender(state);
  }, [flat]);

  // Solo / x-ray: the highlighted faces as their own mesh, the rest hidden or veiled.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    if (state.focusMesh) {
      state.scene.remove(state.focusMesh);
      state.focusMesh.geometry.dispose();
      (state.focusMesh.material as THREE.Material).dispose();
      state.focusMesh = null;
    }
    const mesh = state.mesh;
    const mode = focus?.mode ?? "normal";
    const mask = focus?.mask ?? null;
    const active = mode !== "normal" && !!mask && !!positions && !!mesh && mask.length * 9 === positions.length;
    state.focusMask = active ? mask : null;
    if (mesh) {
      mesh.visible = !(active && mode === "solo");
      const material = mesh.material as THREE.Material;
      const veiled = active && mode === "xray";
      material.transparent = veiled;
      material.opacity = veiled ? XRAY_OPACITY : 1;
      // No depth from the veil, so the highlighted faces show through it.
      material.depthWrite = !veiled;
      material.needsUpdate = true;
    }
    if (active && mask && positions) {
      let count = 0;
      for (let f = 0; f < mask.length; f++) if (mask[f]) count++;
      const pos = new Float32Array(count * 9);
      const col = new Float32Array(count * 9);
      const ids = new Float32Array(count * 3);
      const source = colours && colours.length === positions.length ? colours : null;
      const softSource = (state.geometry?.getAttribute("softColor") as THREE.BufferAttribute | undefined)?.array as Uint16Array | undefined;
      const softCol = softSource && softSource.length === (positions.length / 3) * SOFT_STRIDE ? new Uint16Array(count * 3 * SOFT_STRIDE) : null;
      let p = 0;
      for (let f = 0; f < mask.length; f++) {
        if (!mask[f]) continue;
        const o = f * 9;
        for (let k = 0; k < 9; k++) {
          pos[p + k] = positions[o + k];
          col[p + k] = source ? source[o + k] : 0.6;
        }
        if (softCol && softSource) softCol.set(softSource.subarray((o / 9) * 3 * SOFT_STRIDE, (o / 9 + 1) * 3 * SOFT_STRIDE), (p / 9) * 3 * SOFT_STRIDE);
        ids.fill(f, p / 3, p / 3 + 3);
        p += 9;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geometry.setAttribute("faceId", new THREE.BufferAttribute(ids, 1));
      if (softCol) geometry.setAttribute("softColor", new THREE.BufferAttribute(softCol, SOFT_STRIDE, true));
      geometry.computeVertexNormals();
      const focusMesh = new THREE.Mesh(geometry, makeMeshMaterial(flat, null, softCol ? state.softUniforms : null));
      focusMesh.renderOrder = 1;
      state.scene.add(focusMesh);
      state.focusMesh = focusMesh;
    }
    requestRender(state);
  }, [focus, positions, colours, flat]);

  // Tags over picked patches: plain HTML over the canvas, moved after every
  // frame.  (After the renderer exists, so tags present at mount are placed too.)
  useEffect(() => {
    const state = stateRef.current;
    const layer = calloutLayerRef.current;
    if (!state || !layer) return;
    const elements = [...layer.querySelectorAll<HTMLDivElement>(".callout")];
    state.callouts = (callouts ?? [])
      .map((callout, i) => ({ point: new THREE.Vector3(...callout.point), el: elements[i] }))
      .filter(({ el }) => el !== undefined)
      .map(({ point, el }) => ({
        point,
        el,
        tag: el.querySelector<HTMLElement>(".callout-tag"),
        leaders: [...el.querySelectorAll<SVGPathElement>(".callout-mark path")],
        x: 0,
        y: 0,
        shown: false,
        w: 0,
        h: 0,
        at: "",
        lead: "",
        spot: "",
      }));
    placeCallouts(state);
    requestRender(state);
  }, [callouts]);

  // Colour updates without rebuilding the geometry.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !state.geometry || !colours) return;
    // The new colours carry any paint the preview showed.
    dropStrokePreview(state, false);
    const attribute = state.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (attribute && attribute.array.length === colours.length) {
      (attribute.array as Float32Array).set(colours);
      attribute.clearUpdateRanges();
      attribute.needsUpdate = true;
    } else {
      state.geometry.setAttribute("color", new THREE.BufferAttribute(colours.slice(), 3));
    }
    const soft = state.geometry.getAttribute("softColor") as THREE.BufferAttribute | undefined;
    if (soft && state.softTable && soft.array.length === (colours.length / 3) * SOFT_STRIDE) {
      softenAll(state.softTable, colours, soft.array as Uint16Array);
      soft.clearUpdateRanges();
      soft.needsUpdate = true;
    }
    requestRender(state);
  }, [colours]);

  // Highlight overlays.  A highlight passed again (the same object) stays as
  // it is: rebuilding all of them on every hover re-uploaded a selection of
  // hundreds of thousands of faces and made it flash again.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const wanted = (overlays ?? []).filter((overlay) => overlay.fill.length > 0);
    const kept: OverlayObjects[] = [];
    for (const shown of state.overlays) {
      if (wanted.includes(shown.source)) kept.push(shown);
      else removeOverlay(state, shown);
    }
    state.overlays = kept;
    let added = false;
    for (const overlay of wanted) {
      if (kept.some((shown) => shown.source === overlay)) continue;
      state.overlays.push(buildOverlay(state, overlay));
      added = true;
    }
    trimOverlayShapes(state, SPARE_OVERLAY_BYTES);
    requestRender(state);
    if (added && state.overlays.some((o) => o.pulse)) startPulse(state);
  }, [overlays]);

  // View changes.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    fitCamera(state, view);
  }, [view, fitNonce]);

  return (
    <div className={`mesh-viewer${className ? ` ${className}` : ""}${brush ? " brushing" : ""}`}>
      {(label || labelTools) && (
        <div className="mesh-viewer-label">
          {label}
          {labelTools}
        </div>
      )}
      <div className="mesh-viewer-host" ref={hostRef} style={backgroundStyle(background)} />
      <div className="callout-layer" ref={calloutLayerRef} aria-hidden="true">
        {(callouts ?? []).map((callout, i) =>
          callout.kind === "ring" ? (
            <div key={`${i}-${callout.hex}-ring`} className="callout ring" style={{ visibility: "hidden" }}>
              <span className="callout-ring" />
            </div>
          ) : (
          <div key={`${i}-${callout.hex}`} className="callout" style={{ visibility: "hidden" }}>
            {/* the dot and its leader as one stroke: a dark outline under, white over (the leader is drawn where the label lands) */}
            <svg className="callout-mark" width="1" height="1" aria-hidden="true">
              <path d="M0 0 L22 -22 H40" className="edge" />
              <circle r="4" className="edge-dot" />
              <path d="M0 0 L22 -22 H40" className="line" />
              <circle r="2.6" className="dot" />
            </svg>
            <div className="callout-tag">
              <span className="sw" style={{ background: callout.hex }} />
              <b className="mono">{callout.title}</b>
              <span className="mono value">{callout.value}</span>
              <span className="mono extra">{callout.extra}</span>
              {callout.detail && <span className="detail">{callout.detail}</span>}
            </div>
          </div>
          ),
        )}
      </div>
      {(!positions || positions.length === 0) && (
        <div className="mesh-viewer-empty">{emptyLabel ?? "Load a model to see it here."}</div>
      )}
    </div>
  );
});
