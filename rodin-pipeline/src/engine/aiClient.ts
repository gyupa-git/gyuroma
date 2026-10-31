import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

/**
 * Claude for the consult, two ways:
 * - "local": the app's own server (vite.ai.mjs) runs the claude CLI logged in
 *   on this computer.  Only there when the app runs from the launcher here.
 * - "key": the person's own Anthropic API key, kept in this browser only and
 *   sent to api.anthropic.com only (never through the app's server).  For
 *   everyone else: a Claude login is for its owner's own use, so other people
 *   bring their own key and pay for their own use.
 */
export type AiRoute = "local" | "key";

/** The consult's model on the key route (the local route lets the CLI pick "opus"). */
export const API_MODEL = "claude-opus-5-5";

const KEY_STORAGE = "rodin-pipeline-anthropic-key";
const USAGE_STORAGE = "rodin-pipeline-anthropic-usage";

export async function aiStatus(): Promise<boolean> {
  try {
    const res = await fetch(new URL("__rodin/ai/status", document.baseURI).toString(), { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return false;
    const body = (await res.json()) as { available?: boolean };
    return Boolean(body.available);
  } catch {
    return false;
  }
}

export function loadApiKey(): string | null {
  try {
    const key = window.localStorage.getItem(KEY_STORAGE)?.trim();
    return key ? key : null;
  } catch {
    return null;
  }
}

export function saveApiKey(key: string | null): void {
  try {
    if (key) window.localStorage.setItem(KEY_STORAGE, key.trim());
    else window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage may be unavailable (private mode): the key then lasts this page only.
  }
}

/** "sk-ant-…a1b2": enough to tell keys apart, not enough to use one. */
export function maskKey(key: string): string {
  return key.length > 14 ? `${key.slice(0, 7)}…${key.slice(-4)}` : "…";
}

/** What the key route has used in this browser: requests and an estimate in dollars. */
export interface KeyUsage {
  calls: number;
  usd: number;
}

export function loadKeyUsage(): KeyUsage {
  try {
    const stored = JSON.parse(window.localStorage.getItem(USAGE_STORAGE) ?? "null") as Partial<KeyUsage> | null;
    return { calls: Number(stored?.calls) || 0, usd: Number(stored?.usd) || 0 };
  } catch {
    return { calls: 0, usd: 0 };
  }
}

/**
 * Claude Opus 5.5 list prices per million tokens: input $4, output $20, cache
 * reads $0.20, cache writes with the one-hour lifetime twice the input price.
 * An estimate for the person's own records; the bill is Anthropic's.
 */
function estimateUsd(usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): number {
  return (usage.input_tokens * 4 + usage.output_tokens * 20 + (usage.cache_read_input_tokens ?? 0) * 0.2 + (usage.cache_creation_input_tokens ?? 0) * 8) / 1e6;
}

function addKeyUsage(usd: number): void {
  const now = loadKeyUsage();
  try {
    window.localStorage.setItem(USAGE_STORAGE, JSON.stringify({ calls: now.calls + 1, usd: now.usd + usd }));
  } catch {
    // ignore
  }
}

export interface AiAskRequest {
  /** Same every turn of a conversation (cached for an hour). */
  stable: string;
  stableImages: string[];
  images: string[];
  text: string;
  schema: object;
  tag: string;
}

export type AiAnswer = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

export async function aiAsk(request: AiAskRequest, signal: AbortSignal, route: AiRoute = "local"): Promise<AiAnswer> {
  if (route === "key") {
    const key = loadApiKey();
    if (!key) return { ok: false, error: "API 키가 없어요 — 상의 칸 아래 'AI 연결'에서 넣어 주세요" };
    return askWithKey(request, signal, key);
  }
  const res = await fetch(new URL("__rodin/ai/ask", document.baseURI).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) return { ok: false, error: `서버가 ${res.status} 로 답했어요` };
  return (await res.json()) as AiAnswer;
}

/** The same instruction the local route appends (vite.ai.mjs): one JSON object, nothing else. */
function withSchema(text: string, schema: object): string {
  return `${text}\n\n★ 출력 형식 (엄수)\n아래 스키마에 맞는 JSON 객체 하나만 출력한다. 인사·설명·코드펜스 금지. 첫 글자 { 마지막 글자 }.\n스키마:\n${JSON.stringify(schema)}`;
}

/** The first balanced {...} in the answer (as vite.ai.mjs reads it). */
function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("JSON 이 없습니다");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        // Raw line breaks inside long strings would break JSON.parse.
        const slice = text.slice(start, i + 1).replace(/"(?:[^"\\]|\\.)*"/g, (s) => s.replace(/\n/g, "\\n").replace(/\r/g, ""));
        return JSON.parse(slice) as Record<string, unknown>;
      }
    }
  }
  throw new Error("JSON 이 끝나지 않았습니다");
}

function imageBlock(dataUrl: string): BetaContentBlockParam {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("사진 형식을 읽지 못했어요");
  return { type: "image", source: { type: "base64", media_type: match[1] as "image/jpeg", data: match[2] } };
}

async function askWithKey(request: AiAskRequest, signal: AbortSignal, key: string): Promise<AiAnswer> {
  // Loaded on first use: most sessions never take this route.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  // Same order as the local route: the pictures and rules that stay the same
  // (one cache mark, an hour), then this turn's pictures and words.
  const content: BetaContentBlockParam[] = [
    ...request.stableImages.map(imageBlock),
    { type: "text", text: request.stable, cache_control: { type: "ephemeral", ttl: "1h" } },
    ...request.images.map(imageBlock),
    { type: "text", text: withSchema(request.text, request.schema) },
  ];
  try {
    const response = await client.beta.messages.create(
      {
        model: API_MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        // When a safety check declines, the API answers with another model in the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content }],
      },
      { signal },
    );
    addKeyUsage(estimateUsd(response.usage));
    if (response.stop_reason === "refusal") return { ok: false, error: "Claude 가 이 요청에는 답하지 않았어요 (안전 기준). 말을 바꿔 다시 해 보세요" };
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    try {
      return { ok: true, result: extractJson(text) };
    } catch {
      return { ok: false, error: "답을 읽지 못했어요 (형식이 깨짐). 다시 보내 주세요" };
    }
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) throw new DOMException("stopped", "AbortError");
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: "API 키가 맞지 않아요 — 'AI 연결'에서 키를 다시 넣어 주세요" };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, error: `이 키로는 쓸 수 없어요: ${err.message}` };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: "사용 한도에 걸렸어요. 잠시 뒤 다시 해 보세요" };
    if (err instanceof Anthropic.BadRequestError) return { ok: false, error: `요청이 거절됐어요 (크레딧이 모자라면 Anthropic 콘솔에서 충전): ${err.message}` };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, error: "Anthropic 에 연결하지 못했어요 — 인터넷을 확인해 주세요" };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `Anthropic 오류 ${err.status ?? ""}: ${err.message}` };
    throw err;
  }
}
