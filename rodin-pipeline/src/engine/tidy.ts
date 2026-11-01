import type { MixSettings } from "./types";

/**
 * Auto tidy: presets (rules, instant) and the AI consult share one shape of
 * change.  "clean" is step 02 (how many colours, islands, jagged edges,
 * protected and merged groups), "mix" is step 03's mixing settings.
 */
export type TidyScope = "clean" | "mix" | "both";

export type TidyMixChanges = Partial<
  Pick<MixSettings, "assignmentMode" | "maxComponents" | "recipeResolution" | "accentProtection" | "mappingStrategy" | "mixPriority" | "autoPhysicalDirect" | "physicalDirectDeltaE">
>;

export interface TidyChanges {
  /** Target colour count (02), 2..64. */
  target?: number;
  /** Islands smaller than this many faces are absorbed by their surroundings. */
  minBlob?: number;
  /** Rounds of smoothing along colour borders (jagged edges). */
  smoothing?: number;
  /** Protected colours (eyes, mouth lines) are smoothed too, without being cut or erased. */
  smoothProtected?: boolean;
  /** Rounds of trimming triangles that stick out of borders (teeth), 0 = off. */
  trimTeeth?: number;
  /** Straightening border lines: stairs shorter than this many border edges go (a gentle line through them), 0 = off. */
  lineSmooth?: number;
  /** Palette colours (hex) to protect from being absorbed / to stop protecting. */
  protect?: string[];
  unprotect?: string[];
  /** Palette colour `from` is merged into `into`. */
  merge?: Array<{ from: string; into: string }>;
  /** Preset only: after laying the colours out again, protect the small vivid ones. */
  protectAccents?: boolean;
  mix?: TidyMixChanges;
}

/** One group of the current palette, as the AI and the presets see it. */
export interface TidyColour {
  hex: string;
  /** Share of the surface, 0..100. */
  areaPct: number;
  family: string;
  /** How many source colours the group holds. */
  shades: number;
  protected: boolean;
  /** Where it prints (E2, VE14 …), when step 03 has a plan. */
  output?: string;
}

export interface TidyMixScore {
  components: number;
  resolution: MixSettings["recipeResolution"];
  fidelity: number;
  meanError: number;
  cycleLayers: number;
  lost: number;
  recommended: boolean;
}

export interface TidyContext {
  modelName: string;
  faces: number;
  /** Source colours the strip is laid out from (53,490 for a raw Rodin model, a few dozen after a tidy). */
  sourceColours: number;
  target: number;
  minBlob: number;
  smoothing: number;
  smoothProtected: boolean;
  trimTeeth: number;
  lineSmooth: number;
  palette: TidyColour[];
  slots: Array<{ label: string; hex: string; name: string }>;
  mix: MixSettings;
  mixScores: TidyMixScore[] | null;
  layerHeight: number | null;
}

export interface TidyPreset {
  id: "crisp" | "gradient" | "solid" | "detail" | "trim" | "line";
  icon: string;
}

/** Requests to the consult that come ready-made (the text goes to Claude as the owner's words). */
export interface TidyConsultPreset {
  id: "face";
  icon: string;
  /** Pictures of the view as it is on screen go along (zoomed in on what it is about). */
  closeUp: boolean;
}

export const TIDY_CONSULT_PRESETS: TidyConsultPreset[] = [{ id: "face", icon: "😊", closeUp: true }];

export const TIDY_PRESETS: TidyPreset[] = [
  { id: "crisp", icon: "▣" },
  { id: "gradient", icon: "◐" },
  { id: "solid", icon: "■" },
  { id: "detail", icon: "✦" },
  { id: "trim", icon: "◇" },
  { id: "line", icon: "〰" },
];

const RESOLUTIONS: MixSettings["recipeResolution"][] = ["thirds", "half-thirds", "grid25", "grid20", "grid10", "grid5"];
const MAPPINGS: MixSettings["mappingStrategy"][] = ["closest", "smooth", "preserve-hue", "preserve-accent", "warm-neutral"];
const PRIORITIES: MixSettings["mixPriority"][] = ["accurate", "preserve-hue", "avoid-muddy"];
const ACCENTS: MixSettings["accentProtection"][] = ["off", "balanced", "strong"];

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * What each preset changes.  The numbers, and why:
 * - crisp: 6 smoothing rounds (twice the default 3) straighten borders; islands under 300 faces
 *   (default 150) go, so a border is not peppered with specks.  Mixing: 2 filaments in thirds —
 *   the shortest repeat, so a mixed area shows the fewest layer stripes at its edge.
 * - gradient: at least 32 colours (64 at most) so a shading keeps its steps; 1 smoothing round
 *   and 40-face islands, so the steps are not ironed flat.  Mixing: 3 filaments at 25 % — finer
 *   in-between colours at a still short repeat; "smooth" mapping keeps neighbours in order.
 * - solid: about 1.5 groups per colour family that covers at least 0.5 % (6..16 in all); 8
 *   smoothing rounds and 600-face islands for clean flat areas.  Mixing: thirds, and any colour
 *   within ΔE 10 of a loaded filament prints as that filament, not as a mix.
 * - detail: islands down to 20 faces are kept and only 2 smoothing rounds, small vivid colours
 *   are protected.  Mixing: accents kept (balanced) and mapped by accent.
 * - trim: 3 rounds of trimming the triangles that stick out of borders, so a border runs as
 *   evenly as its triangles allow — three rounds take teeth up to three faces deep, more
 *   would start rounding off real points.  Colours only; the mixing stays.
 * - line: the border lines redrawn as gentle lines through their stairs — stairs and bends
 *   shorter than 16 border edges straighten, longer curves (the shape of a part) stay — then
 *   the teeth trim (3) for what still sticks out.  Colours only; the mixing stays.
 */
export function presetChanges(id: TidyPreset["id"], context: TidyContext, scope: TidyScope): TidyChanges {
  const clean = scope !== "mix";
  const mix = scope !== "clean";
  const out: TidyChanges = {};
  if (id === "crisp") {
    if (clean) Object.assign(out, { smoothing: 6, minBlob: 300 });
    if (mix) out.mix = { assignmentMode: "physical-and-virtual", maxComponents: 2, recipeResolution: "thirds", mappingStrategy: "closest" };
  } else if (id === "gradient") {
    if (clean) Object.assign(out, { target: clampInt(Math.max(context.target, 32), 2, 64), smoothing: 1, minBlob: 40 });
    if (mix) out.mix = { assignmentMode: "physical-and-virtual", maxComponents: 3, recipeResolution: "grid25", mappingStrategy: "smooth" };
  } else if (id === "solid") {
    const families = new Map<string, number>();
    for (const colour of context.palette) families.set(colour.family, (families.get(colour.family) ?? 0) + colour.areaPct);
    const big = [...families.values()].filter((pct) => pct >= 0.5).length;
    if (clean) Object.assign(out, { target: clampInt(big * 1.5, 6, 16), smoothing: 8, minBlob: 600 });
    if (mix) out.mix = { assignmentMode: "physical-and-virtual", maxComponents: 2, recipeResolution: "thirds", autoPhysicalDirect: true, physicalDirectDeltaE: 10 };
  } else if (id === "detail") {
    if (clean) Object.assign(out, { smoothing: 2, minBlob: 20, protectAccents: true });
    if (mix) out.mix = { accentProtection: "balanced", mappingStrategy: "preserve-accent" };
  } else if (id === "trim") {
    if (clean) out.trimTeeth = 3;
  } else if (id === "line") {
    if (clean) Object.assign(out, { lineSmooth: 16, trimTeeth: 3 });
  }
  return out;
}

/** Keeps only what the scope allows and what is valid; says what was left out. */
export function sanitizeChanges(raw: unknown, context: TidyContext, scope: TidyScope): { changes: TidyChanges; dropped: string[] } {
  const dropped: string[] = [];
  const changes: TidyChanges = {};
  if (!raw || typeof raw !== "object") return { changes, dropped };
  const r = raw as Record<string, unknown>;
  const hexes = new Set(context.palette.map((c) => c.hex));
  const hexList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((v) => String(v).toUpperCase()).filter((hex) => /^#[0-9A-F]{6}$/.test(hex)) : [];
  const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const clean = scope !== "mix";
  const mix = scope !== "clean";

  const cleanKeys = ["target", "minBlob", "smoothing", "smoothProtected", "trimTeeth", "lineSmooth", "protect", "unprotect", "merge"];
  if (!clean && cleanKeys.some((k) => r[k] !== undefined)) dropped.push("색정리 칸 (지금 범위는 혼합만)");
  if (clean) {
    const target = num(r.target);
    if (target !== null) changes.target = clampInt(target, 2, 64);
    const minBlob = num(r.minBlob);
    if (minBlob !== null) changes.minBlob = clampInt(minBlob, 0, 5000);
    const smoothing = num(r.smoothing);
    if (smoothing !== null) changes.smoothing = clampInt(smoothing, 0, 20);
    if (typeof r.smoothProtected === "boolean") changes.smoothProtected = r.smoothProtected;
    const trimTeeth = num(r.trimTeeth);
    if (trimTeeth !== null) changes.trimTeeth = clampInt(trimTeeth, 0, 10);
    const lineSmooth = num(r.lineSmooth);
    if (lineSmooth !== null) changes.lineSmooth = clampInt(lineSmooth, 0, 40);
    // Colours are named by the palette as it is now; a new target lays the palette out
    // again, so the names would point at colours that no longer exist.
    const relayout = changes.target !== undefined && changes.target !== context.target;
    const protect = hexList(r.protect);
    const unprotect = hexList(r.unprotect);
    const merge = Array.isArray(r.merge)
      ? (r.merge as unknown[])
          .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : {}))
          .map((m) => ({ from: String(m.from ?? "").toUpperCase(), into: String(m.into ?? "").toUpperCase() }))
          .filter((m) => m.from !== m.into)
      : [];
    if (relayout && (protect.length || unprotect.length || merge.length)) {
      dropped.push("색 지정(보호·합치기) — 목표 색 수가 바뀌면 색이 새로 나뉘어서, 다음 말에서 다시 정합니다");
    } else {
      const known = (hex: string) => hexes.has(hex);
      const unknown = [...protect, ...unprotect, ...merge.flatMap((m) => [m.from, m.into])].filter((hex) => !known(hex));
      if (unknown.length) dropped.push(`지금 팔레트에 없는 색 ${[...new Set(unknown)].join(", ")}`);
      if (protect.some(known)) changes.protect = protect.filter(known);
      if (unprotect.some(known)) changes.unprotect = unprotect.filter(known);
      const merges = merge.filter((m) => known(m.from) && known(m.into));
      if (merges.length) changes.merge = merges;
    }
  }
  const rawMix = r.mix && typeof r.mix === "object" ? (r.mix as Record<string, unknown>) : null;
  if (rawMix && !mix) dropped.push("혼합 칸 (지금 범위는 색정리만)");
  if (rawMix && mix) {
    const m: TidyMixChanges = {};
    if (rawMix.assignmentMode === "physical-only" || rawMix.assignmentMode === "physical-and-virtual") m.assignmentMode = rawMix.assignmentMode;
    if (rawMix.maxComponents === 2 || rawMix.maxComponents === 3) m.maxComponents = rawMix.maxComponents;
    if (RESOLUTIONS.includes(rawMix.recipeResolution as MixSettings["recipeResolution"])) m.recipeResolution = rawMix.recipeResolution as MixSettings["recipeResolution"];
    if (ACCENTS.includes(rawMix.accentProtection as MixSettings["accentProtection"])) m.accentProtection = rawMix.accentProtection as MixSettings["accentProtection"];
    if (MAPPINGS.includes(rawMix.mappingStrategy as MixSettings["mappingStrategy"])) m.mappingStrategy = rawMix.mappingStrategy as MixSettings["mappingStrategy"];
    if (PRIORITIES.includes(rawMix.mixPriority as MixSettings["mixPriority"])) m.mixPriority = rawMix.mixPriority as MixSettings["mixPriority"];
    if (typeof rawMix.autoPhysicalDirect === "boolean") m.autoPhysicalDirect = rawMix.autoPhysicalDirect;
    const de = num(rawMix.physicalDirectDeltaE);
    if (de !== null) m.physicalDirectDeltaE = Math.max(0, Math.min(30, Math.round(de * 10) / 10));
    if (Object.keys(m).length) changes.mix = m;
  }
  return { changes, dropped };
}

export interface ChangeLine {
  /** Which field (for the highlight on the panel): target, minBlob, smoothing, protect, merge, mix.<key>. */
  key: string;
  label: string;
  from: string;
  to: string;
}

const MIX_LABEL: Record<keyof TidyMixChanges, string> = {
  assignmentMode: "출력 방식",
  maxComponents: "섞는 필라멘트 수",
  recipeResolution: "혼합 비율 단위",
  accentProtection: "포인트 색 보존",
  mappingStrategy: "색 짝짓기",
  mixPriority: "혼합 우선",
  autoPhysicalDirect: "가까우면 실물로",
  physicalDirectDeltaE: "실물로 보낼 거리(ΔE)",
};

function mixValue(key: keyof TidyMixChanges, value: unknown): string {
  if (key === "assignmentMode") return value === "physical-only" ? "실물만" : "실물 + 가상 혼합";
  if (key === "recipeResolution") {
    const v = String(value);
    return v === "thirds" ? "1/3" : v === "half-thirds" ? "50% + 1/3" : `${v.replace("grid", "")}% + 1/3`;
  }
  if (key === "autoPhysicalDirect") return value ? "켬" : "끔";
  if (key === "maxComponents") return `${value}개까지`;
  return String(value);
}

/** Before → after, one line per field that really changes. */
export function describeChanges(changes: TidyChanges, context: TidyContext): ChangeLine[] {
  const lines: ChangeLine[] = [];
  if (changes.target !== undefined && changes.target !== context.target)
    lines.push({ key: "target", label: "목표 색 수", from: String(context.target), to: String(changes.target) });
  if (changes.minBlob !== undefined && changes.minBlob !== context.minBlob)
    lines.push({ key: "minBlob", label: "작은 조각 흡수", from: `${context.minBlob}면`, to: `${changes.minBlob}면` });
  if (changes.smoothing !== undefined && changes.smoothing !== context.smoothing)
    lines.push({ key: "smoothing", label: "경계 톱니 다듬기", from: `${context.smoothing}회`, to: `${changes.smoothing}회` });
  if (changes.smoothProtected !== undefined && changes.smoothProtected !== context.smoothProtected)
    lines.push({ key: "smoothProtected", label: "보호한 색도 경계 다듬기", from: context.smoothProtected ? "켬" : "끔", to: changes.smoothProtected ? "켬" : "끔" });
  if (changes.trimTeeth !== undefined && changes.trimTeeth !== context.trimTeeth)
    lines.push({ key: "trimTeeth", label: "톱니 깎기", from: `${context.trimTeeth}회`, to: `${changes.trimTeeth}회` });
  if (changes.lineSmooth !== undefined && changes.lineSmooth !== context.lineSmooth)
    lines.push({ key: "lineSmooth", label: "경계 선 펴기", from: `${context.lineSmooth}칸`, to: `${changes.lineSmooth}칸` });
  const isProtected = new Map(context.palette.map((c) => [c.hex, c.protected]));
  for (const hex of changes.protect ?? []) if (!isProtected.get(hex)) lines.push({ key: "protect", label: `보호 ${hex}`, from: "안 함", to: "보호" });
  for (const hex of changes.unprotect ?? []) if (isProtected.get(hex)) lines.push({ key: "protect", label: `보호 ${hex}`, from: "보호", to: "안 함" });
  for (const m of changes.merge ?? []) lines.push({ key: "merge", label: "합치기", from: m.from, to: m.into });
  if (changes.protectAccents) lines.push({ key: "protect", label: "작은 선명한 색", from: "자동", to: "보호" });
  for (const [key, value] of Object.entries(changes.mix ?? {}) as Array<[keyof TidyMixChanges, unknown]>) {
    const now = context.mix[key];
    if (now === value) continue;
    lines.push({ key: `mix.${key}`, label: MIX_LABEL[key], from: mixValue(key, now), to: mixValue(key, value) });
  }
  return lines;
}

export function hasCleanChanges(changes: TidyChanges): boolean {
  return (
    changes.target !== undefined ||
    changes.minBlob !== undefined ||
    changes.smoothing !== undefined ||
    changes.smoothProtected !== undefined ||
    changes.trimTeeth !== undefined ||
    changes.lineSmooth !== undefined ||
    Boolean(changes.protect?.length || changes.unprotect?.length || changes.merge?.length || changes.protectAccents)
  );
}

export interface TidyLogEntry {
  id: string;
  role: "user" | "ai" | "sys";
  text: string;
  /** ISO time. */
  at: string;
  model: string;
  scope: TidyScope;
  observations?: string[];
  /** What was changed (applied) or proposed (suggested). */
  changes?: TidyChanges;
  lines?: ChangeLine[];
  status?: "applied" | "suggested" | "undone" | "none";
  dropped?: string[];
}

export const SCOPE_LABEL: Record<TidyScope, string> = { clean: "색정리(02)", mix: "혼합(03)", both: "색정리 + 혼합" };

export const TIDY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "규파에게 하는 말(한국어, 4문장 안). 무엇을 왜 바꾸는지(또는 제안하는지)만 — 사진에서 본 자세한 것은 observations 에. changes 에 넣은 것만 실제로 바뀐다" },
    asked_to_change: { type: "boolean", description: "규파가 이번 말에서 무엇을 바꾸라고 분명히 요청했나(…해 줘·바꿔·정리해·줄여·늘려·그렇게 해). 묻기·의견 구하기·'추천해 줘'·'어때?'면 false" },
    observations: { type: "array", items: { type: "string" }, description: "사진에서 본 것 2~5줄, 줄마다 한 문장 — 부위(얼굴·머리·옷 …)와 문제(톱니·얼룩·작은 점·뭉개진 그라데이션 …)" },
    changes: {
      type: "object",
      description: "바꿀 칸만. asked_to_change 가 false 면 '제안'(규파가 [이대로 적용]을 눌러야 바뀐다). 바꿀 게 없으면 {}",
      properties: {
        target: { type: "integer", minimum: 2, maximum: 64, description: "목표 색 수(02)" },
        minBlob: { type: "integer", minimum: 0, maximum: 5000, description: "이 면 수보다 작은 조각은 주변 색으로 흡수" },
        smoothing: { type: "integer", minimum: 0, maximum: 20, description: "경계 톱니 다듬기 횟수" },
        smoothProtected: { type: "boolean", description: "보호한 색(눈·입·꽃술 같은 작은 선)도 경계 톱니를 편다" },
        trimTeeth: { type: "integer", minimum: 0, maximum: 10, description: "경계에서 삐죽 튀어나온 삼각형(톱니) 깎기 횟수, 0 = 끔" },
        lineSmooth: { type: "integer", minimum: 0, maximum: 40, description: "경계 선 펴기 길이(삼각형 변 몇 칸): 이보다 짧은 계단·지그재그를 지나는 완만한 선으로 경계를 다시 긋기, 0 = 끔" },
        protect: { type: "array", items: { type: "string" }, description: "흡수·합치기에서 지킬 지금 팔레트 색(hex)" },
        unprotect: { type: "array", items: { type: "string" } },
        merge: { type: "array", items: { type: "object", properties: { from: { type: "string" }, into: { type: "string" } } }, description: "지금 팔레트 색 from 을 into 로 합치기" },
        mix: {
          type: "object",
          properties: {
            assignmentMode: { enum: ["physical-and-virtual", "physical-only"] },
            maxComponents: { enum: [2, 3] },
            recipeResolution: { enum: RESOLUTIONS },
            accentProtection: { enum: ACCENTS },
            mappingStrategy: { enum: MAPPINGS },
            mixPriority: { enum: PRIORITIES },
            autoPhysicalDirect: { type: "boolean" },
            physicalDirectDeltaE: { type: "number" },
          },
        },
      },
    },
  },
  required: ["reply", "asked_to_change", "changes"],
};

/** The same-every-time part of the consult (rules and the model as loaded): cached for an hour. */
export function tidyStablePrompt(context: Pick<TidyContext, "modelName" | "faces">): string {
  return `너는 규로마(GYUROMA) 앱의 '자동 정돈' 상의 담당이다. 규파(3D 조형 작가)가 AI 로 만든 3D 모델(면마다 색)을 PrusaSlicer 컬러 믹스(층마다 필라멘트를 바꿔 섞는 방식)로 출력하려고 색을 정리한다.
사진을 여러 각도로 보고, 아래 손잡이를 어떻게 돌리면 규파가 원하는 모습이 되는지 판단해 직접 고치거나 제안한다.

■ 02 색정리 손잡이 (범위에 색정리가 있을 때만)
- target(목표 색 수 2~64): 비슷한 색을 이 개수의 그룹으로 묶는다. 적을수록 단색처럼 깔끔, 많을수록 음영·그라데이션이 남는다.
- minBlob(작은 조각 흡수, 면 수): 이보다 작은 같은 색 조각은 주변 색이 된다. 얼룩·점이 많으면 키우고(300~800), 눈·입·작은 무늬가 사라지면 줄인다(20~60).
- smoothing(경계 톱니 다듬기 횟수 0~20): 색 경계의 삼각형 톱니를 펴 준다. 경계가 지저분하면 5~8, 그라데이션을 살릴 땐 0~2.
- protect / unprotect: 지금 팔레트 색(hex)을 흡수·합치기에서 지킨다(작은 포인트 색 — 눈·입·꽃술 등). 보호한 색은 경계 다듬기에서도 그대로 얼려 둔다 — 그래서 눈·입 같은 보호 색의 경계만 톱니로 남는다.
- smoothProtected(true/false): 보호한 색도 경계 톱니를 편다. 삐죽 나온 삼각형만 주변 색으로 돌리고, 선을 끊는 면·홀로 선 점은 건드리지 않는다(한 면 굵기 선도 남는다, 선 끝은 한두 면 닳을 수 있음). 흡수로 사라지지도 않는다. 눈·코·입 경계가 터덜터덜하면 이것을 켜고 smoothing 4~8. 눈·입 색을 unprotect 해서 다듬으면 가는 선이 끊기거나 지워지니 그러지 않는다.
- trimTeeth(톱니 깎기 0~10회): 두 변 이상이 다른 색에 닿은 삼각형(경계에서 가늘게 삐죽 나온 톱니)을 더 길게 맞닿은 색으로 깎는다. smoothing 이 표가 갈려 못 펴는 가는 가시를 잡는다. 한 번에 한 면 깊이, 보통 2~3. 많이 하면 일부러 뾰족한 끝(머리카락 끝·별 끝)도 둥글어진다. 보호한 색은 그대로.
- lineSmooth(경계 선 펴기 0~40칸): 경계의 계단·지그재그 한가운데로 완만한 선을 다시 긋고(이 길이보다 짧은 계단·굴곡이 펴진다), 경계 근처 삼각형은 중심이 그 선의 어느 쪽에 있는지로 색을 정한다. 톱니 깎기보다 경계 전체가 고르게 정리된다. 보통 16, 계단이 크면 24~32. 크게 하면 일부러 꺾인 모서리도 둥글어진다. 보호한 색 경계·세 색이 만나는 점은 그대로, 가는 선은 양쪽 경계가 따로 펴져 남는다.
- 한계: 색은 삼각형 단위로 칠해지고 경계는 삼각형 모서리를 따라간다. 선 굵기가 삼각형 서너 개뿐이면(얼굴의 작은 입선·눈선이 흔히 그렇다) 다듬어도 지그재그가 남는다 — 그럴 땐 그렇다고 말하고, 할 수 있는 것(경계에 낀 다른 색 조각 merge, 작은 점 minBlob 등)만 한다. 다 매끄러워진다고 약속하지 않는다.
- merge [{from, into}]: 지금 팔레트의 from 색을 into 색으로 합친다(같은 부위인데 두 색으로 갈라져 얼룩진 곳).
- 목표 색 수를 바꾸면 팔레트가 새로 나뉘므로 같은 답에서 protect·merge 는 쓰지 않는다(다음 말에서).
- 적용하면 앱이 '정리 실행'(면 색 확정 + 다듬기 + 흡수)까지 한다. 같은 상의 안에서 다시 바꾸면 정리 전 색에서 다시 시작한다.

■ 03 혼합 손잡이 (범위에 혼합이 있을 때만, mix 안에)
- assignmentMode: physical-and-virtual(실물 + 가상 혼합) | physical-only(실물 필라멘트 색만).
- maxComponents 2|3: 한 색에 섞는 필라멘트 수. 3이면 중간색이 풍부, 2면 단순.
- recipeResolution: thirds(1/3, 주기 짧음·줄무늬 적음) < half-thirds < grid25 < grid20 < grid10 < grid5(5%, 색은 정확하지만 주기가 길어 줄무늬가 보임).
- accentProtection off|balanced|strong · mappingStrategy closest|smooth|preserve-hue|preserve-accent|warm-neutral · mixPriority accurate|preserve-hue|avoid-muddy.
- autoPhysicalDirect + physicalDirectDeltaE: 실물 필라멘트와 이 ΔE 안이면 섞지 않고 실물로 찍는다(단색 면이 깨끗해짐).
- 점수표(있으면): fidelity 높을수록 원래 색에 가깝고, cycleLayers 가 길수록 층 줄무늬가 눈에 띈다.

■ 프리셋(규파가 버튼으로 이미 쓸 수 있는 것 — 참고)
경계 또렷하게: smoothing 6·minBlob 300 / 혼합 2개·1/3 · 그라데이션 살리기: 색 32+·smoothing 1·minBlob 40 / 혼합 3개·25% · 단색 깔끔: 계열당 1.5그룹(6~16)·smoothing 8·minBlob 600 / 혼합 1/3·ΔE 10 안 실물 · 디테일 지키기: minBlob 20·smoothing 2·작은 선명한 색 보호 · 톱니 깎기: trimTeeth 3 · 경계 매끈하게: lineSmooth 16·trimTeeth 3.

■ 규칙
- 사진은 회색 배경에 조명을 받은 모습이다. '원본' 사진은 정리 전 색, '결과' 사진은 지금 상태다. '지금 화면' 사진은 규파가 화면에서 확대해 보고 있는 곳이다 — 말이 가리키는 곳일 가능성이 크다. 부위(얼굴·머리카락·옷·소품)를 짚어 말한다.
- changes 에 넣은 것만 실제로 바뀐다. 바꿨다고 말하려면 넣어라. 넣지 않은 걸 바꿨다고 말하지 않는다.
- 규파가 묻거나 추천을 청하면(asked_to_change=false) changes 는 '제안'이다 — 규파가 [이대로 적용]을 눌러야 바뀐다.
- 사진에 안 보이는 것을 지어내지 않는다. 확실하지 않으면 그렇다고 말한다.
- 숫자를 바꿀 땐 왜 그 값인지 짧게 말한다. reply 는 4문장 안, 한국어. 같은 말을 reply 와 observations 에 되풀이하지 않는다.

■ 모델
이름: ${context.modelName} · 면 ${context.faces.toLocaleString()}개`;
}

function mixLine(mix: MixSettings): string {
  return `출력 방식 ${mix.assignmentMode} · 섞는 수 ${mix.maxComponents} · 비율 ${mix.recipeResolution} · 포인트 ${mix.accentProtection} · 짝짓기 ${mix.mappingStrategy} · 우선 ${mix.mixPriority} · 가까우면 실물 ${mix.autoPhysicalDirect ? `켬(ΔE ${mix.physicalDirectDeltaE})` : "끔"}`;
}

/** The part that changes every turn: the state now, the conversation so far and the new message. */
export function tidyTurnPrompt(context: TidyContext, scope: TidyScope, history: TidyLogEntry[], message: string, pictures: string[]): string {
  const palette = [...context.palette]
    .sort((a, b) => b.areaPct - a.areaPct)
    .map((c) => `${c.hex} ${c.areaPct.toFixed(2)}% ${c.family}${c.shades > 1 ? ` 명암${c.shades}` : ""}${c.protected ? " 보호" : ""}${c.output ? ` →${c.output}` : ""}`)
    .join("\n");
  const scores = context.mixScores?.length
    ? context.mixScores
        .map((s) => `${s.components}개·${s.resolution}: fidelity ${s.fidelity.toFixed(0)} · 평균오차 ${s.meanError.toFixed(1)} · 주기 ${s.cycleLayers}층${s.lost ? ` · 잃는 색 ${s.lost}` : ""}${s.recommended ? " ★" : ""}`)
        .join("\n")
    : "(점수표 없음)";
  const slots = context.slots.map((s) => `${s.label} ${s.hex} ${s.name}`).join(" · ");
  const past = history
    .slice(-16)
    .map((h) => {
      if (h.role === "user") return `규파: ${h.text}`;
      if (h.role === "sys") return `(기록) ${h.text}`;
      const what = h.lines?.length ? ` [${h.status === "applied" ? "바꿈" : h.status === "undone" ? "바꿨다가 되돌림" : "제안"}: ${h.lines.map((l) => `${l.label} ${l.from}→${l.to}`).join(", ")}]` : "";
      return `너: ${h.text}${what}`;
    })
    .join("\n");
  return `■ 지금 상태 (범위: ${SCOPE_LABEL[scope]})
원본 색 ${context.sourceColours.toLocaleString()}가지 · 목표 색 수 ${context.target} · 작은 조각 흡수 ${context.minBlob}면 · 경계 다듬기 ${context.smoothing}회 · 보호한 색도 다듬기 ${context.smoothProtected ? "켬" : "끔"} · 톱니 깎기 ${context.trimTeeth}회 · 경계 선 펴기 ${context.lineSmooth}칸
팔레트(면적순, hex 면적 계열 [보호] [→출력]):
${palette}

필라멘트 슬롯: ${slots || "(없음)"}${context.layerHeight ? ` · 층 높이 ${context.layerHeight}mm` : ""}
혼합 설정: ${mixLine(context.mix)}
혼합 점수표:
${scores}

■ 사진 (이 순서로 붙어 있음)
${pictures.map((p, i) => `${i + 1}. ${p}`).join("\n")}

■ 지금까지 주고받은 말
${past || "(처음)"}

■ 규파의 말
${message}`;
}
